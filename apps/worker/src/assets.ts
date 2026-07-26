import type { AssetSummary, SessionUser } from "../../../packages/shared/src/schemas";
import { randomId } from "./crypto";
import { errorResponse, json, readJson, requireSameOrigin } from "./http";
import {
  audit,
  mediaTypeForMime,
  optionalString,
  parseBodyRecord,
  requiredString,
  sanitizeFileName,
  ValidationError
} from "./platform";

interface AssetRow {
  id: string;
  offer_id: string | null;
  object_key: string;
  original_name: string;
  media_type: "image" | "video" | "document";
  mime_type: string;
  extension: string;
  byte_size: number;
  upload_status: "pending" | "uploading" | "ready" | "failed" | "deleting";
  multipart_upload_id: string | null;
  created_at: string;
}

interface PartRow {
  part_number: number;
  etag: string;
}

function mapAsset(row: AssetRow): AssetSummary {
  return {
    id: row.id,
    offerId: row.offer_id,
    originalName: row.original_name,
    mediaType: row.media_type,
    mimeType: row.mime_type,
    extension: row.extension,
    byteSize: Number(row.byte_size),
    uploadStatus: row.upload_status,
    createdAt: row.created_at,
    url: row.upload_status === "ready" ? `/media/${row.id}` : null
  };
}

async function findAsset(env: Env, id: string): Promise<AssetRow | null> {
  return env.DB.prepare(
    `SELECT id, offer_id, object_key, original_name, media_type, mime_type, extension,
     byte_size, upload_status, multipart_upload_id, created_at
     FROM assets WHERE id = ? AND deleted_at IS NULL`
  ).bind(id).first<AssetRow>();
}

async function listAssets(env: Env): Promise<AssetSummary[]> {
  const result = await env.DB.prepare(
    `SELECT id, offer_id, object_key, original_name, media_type, mime_type, extension,
     byte_size, upload_status, multipart_upload_id, created_at
     FROM assets WHERE deleted_at IS NULL ORDER BY created_at DESC`
  ).all<AssetRow>();
  return result.results.map(mapAsset);
}

async function initiate(
  request: Request,
  env: Env,
  user: SessionUser
): Promise<Response> {
  const body = parseBodyRecord(await readJson(request, 64_000));
  const originalName = requiredString(body.fileName, "Nome do arquivo", 180);
  const mime = requiredString(body.mimeType, "Tipo do arquivo", 120).toLowerCase();
  const byteSize = Number(body.byteSize);
  const maxFile = Number(env.MAX_FILE_BYTES) || 524_288_000;
  if (!Number.isSafeInteger(byteSize) || byteSize <= 0 || byteSize > maxFile) {
    throw new ValidationError(`O arquivo deve ter até ${Math.round(maxFile / 1024 / 1024)} MB.`);
  }
  const allowed =
    /^(video\/(mp4|webm)|image\/(jpeg|png|webp|gif)|application\/pdf)$/.test(mime);
  if (!allowed) {
    throw new ValidationError("Formato permitido: MP4, WebM, JPG, PNG, WebP, GIF ou PDF.");
  }
  const used =
    (await env.DB.prepare(
      "SELECT COALESCE(SUM(byte_size), 0) AS value FROM assets WHERE upload_status = 'ready' AND deleted_at IS NULL"
    ).first<number>("value")) ?? 0;
  const maxStorage = Number(env.MAX_STORAGE_BYTES) || 10_737_418_240;
  if (env.FREE_ONLY === "true" && used + byteSize > maxStorage) {
    return errorResponse(
      409,
      "FREE_ONLY_STORAGE_LIMIT",
      "Este upload ultrapassaria o limite de proteção configurado."
    );
  }
  const id = randomId();
  const extension = (originalName.split(".").pop() ?? "bin").toLowerCase().slice(0, 12);
  const objectKey = `assets/${new Date().toISOString().slice(0, 10)}/${id}-${sanitizeFileName(originalName)}`;
  const multipart = await env.MEDIA.createMultipartUpload(objectKey, {
    httpMetadata: { contentType: mime },
    customMetadata: { assetId: id, originalName: sanitizeFileName(originalName) }
  });
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO assets(
        id, offer_id, object_key, original_name, media_type, mime_type, extension,
        byte_size, sha256, upload_status, multipart_upload_id, created_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploading', ?, ?)`
    ).bind(
      id,
      optionalString(body.offerId, 100),
      objectKey,
      originalName,
      mediaTypeForMime(mime),
      mime,
      extension,
      byteSize,
      optionalString(body.sha256, 128),
      multipart.uploadId,
      user.id
    ),
    audit(env, user.id, "asset.upload_started", "asset", id, { byteSize, mime })
  ]);
  return json(
    {
      assetId: id,
      uploadId: multipart.uploadId,
      partSize: 8 * 1024 * 1024,
      maxFileBytes: maxFile
    },
    { status: 201 }
  );
}

async function uploadPart(
  request: Request,
  env: Env,
  id: string,
  partNumber: number
): Promise<Response> {
  const asset = await findAsset(env, id);
  if (!asset?.multipart_upload_id || asset.upload_status !== "uploading") {
    return errorResponse(404, "UPLOAD_NOT_FOUND", "Upload não encontrado ou já finalizado.");
  }
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) {
    throw new ValidationError("Número da parte inválido.");
  }
  const length = Number(request.headers.get("Content-Length") ?? 0);
  if (length <= 0 || length > 16 * 1024 * 1024) {
    throw new ValidationError("Parte vazia ou maior que 16 MB.");
  }
  if (!request.body) throw new ValidationError("Parte vazia.");
  const upload = env.MEDIA.resumeMultipartUpload(asset.object_key, asset.multipart_upload_id);
  const uploaded = await upload.uploadPart(partNumber, request.body);
  await env.DB.prepare(
    `INSERT INTO asset_upload_parts(asset_id, part_number, etag, byte_size)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(asset_id, part_number) DO UPDATE SET
       etag = excluded.etag, byte_size = excluded.byte_size, created_at = datetime('now')`
  ).bind(id, partNumber, uploaded.etag, length).run();
  return json({ partNumber, etag: uploaded.etag });
}

async function complete(env: Env, user: SessionUser, id: string): Promise<Response> {
  const asset = await findAsset(env, id);
  if (!asset?.multipart_upload_id || asset.upload_status !== "uploading") {
    return errorResponse(404, "UPLOAD_NOT_FOUND", "Upload não encontrado ou já finalizado.");
  }
  const rows = await env.DB.prepare(
    "SELECT part_number, etag FROM asset_upload_parts WHERE asset_id = ? ORDER BY part_number"
  ).bind(id).all<PartRow>();
  if (!rows.results.length) throw new ValidationError("Nenhuma parte foi enviada.");
  const upload = env.MEDIA.resumeMultipartUpload(asset.object_key, asset.multipart_upload_id);
  const object = await upload.complete(
    rows.results.map((part) => ({ partNumber: part.part_number, etag: part.etag }))
  );
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE assets SET upload_status = 'ready', byte_size = ?, multipart_upload_id = NULL,
       updated_at = datetime('now') WHERE id = ?`
    ).bind(object.size, id),
    env.DB.prepare("DELETE FROM asset_upload_parts WHERE asset_id = ?").bind(id),
    audit(env, user.id, "asset.upload_completed", "asset", id, { byteSize: object.size })
  ]);
  return json({ asset: mapAsset((await findAsset(env, id))!) });
}

async function abort(env: Env, user: SessionUser, id: string): Promise<Response> {
  const asset = await findAsset(env, id);
  if (!asset) return errorResponse(404, "NOT_FOUND", "Arquivo não encontrado.");
  if (asset.multipart_upload_id) {
    await env.MEDIA.resumeMultipartUpload(asset.object_key, asset.multipart_upload_id).abort();
  } else if (asset.upload_status === "ready") {
    await env.MEDIA.delete(asset.object_key);
  }
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE assets SET upload_status = 'deleting', deleted_at = datetime('now') WHERE id = ?"
    ).bind(id),
    env.DB.prepare("DELETE FROM asset_upload_parts WHERE asset_id = ?").bind(id),
    audit(env, user.id, "asset.deleted", "asset", id)
  ]);
  return json({ ok: true });
}

async function rename(
  request: Request,
  env: Env,
  user: SessionUser,
  id: string
): Promise<Response> {
  const body = parseBodyRecord(await readJson(request, 16_000));
  const name = requiredString(body.name, "Nome", 180);
  const result = await env.DB.prepare(
    "UPDATE assets SET original_name = ?, updated_at = datetime('now') WHERE id = ? AND deleted_at IS NULL"
  ).bind(name, id).run();
  if (!result.meta.changes) return errorResponse(404, "NOT_FOUND", "Arquivo não encontrado.");
  await audit(env, user.id, "asset.renamed", "asset", id).run();
  return json({ asset: mapAsset((await findAsset(env, id))!) });
}

export async function handleAssetsApi(
  request: Request,
  env: Env,
  user: SessionUser,
  url: URL
): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/assets")) return null;
  if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method) && !requireSameOrigin(request)) {
    return errorResponse(403, "ORIGIN_INVALID", "Origem inválida.");
  }
  try {
    if (url.pathname === "/api/assets" && request.method === "GET") {
      return json({ assets: await listAssets(env) });
    }
    if (url.pathname === "/api/assets/multipart" && request.method === "POST") {
      return initiate(request, env, user);
    }
    const part = url.pathname.match(/^\/api\/assets\/([^/]+)\/parts\/(\d+)$/);
    if (part && request.method === "PUT") {
      return uploadPart(request, env, part[1], Number(part[2]));
    }
    const completeMatch = url.pathname.match(/^\/api\/assets\/([^/]+)\/complete$/);
    if (completeMatch && request.method === "POST") {
      return complete(env, user, completeMatch[1]);
    }
    const assetMatch = url.pathname.match(/^\/api\/assets\/([^/]+)$/);
    if (assetMatch && request.method === "PATCH") {
      return rename(request, env, user, assetMatch[1]);
    }
    if (assetMatch && request.method === "DELETE") {
      return abort(env, user, assetMatch[1]);
    }
    return errorResponse(404, "NOT_FOUND", "Rota de mídia não encontrada.");
  } catch (error) {
    if (error instanceof ValidationError) {
      return errorResponse(400, "VALIDATION_ERROR", error.message);
    }
    throw error;
  }
}

export async function serveMedia(request: Request, env: Env, url: URL): Promise<Response> {
  const id = url.pathname.slice("/media/".length).split("/")[0];
  const asset = await findAsset(env, id);
  if (!asset || asset.upload_status !== "ready") {
    return new Response("Mídia não encontrada.", { status: 404 });
  }
  const referer = request.headers.get("Referer");
  if (referer) {
    try {
      if (new URL(referer).origin !== url.origin) {
        return new Response("Hotlink bloqueado.", { status: 403 });
      }
    } catch {
      return new Response("Referência inválida.", { status: 403 });
    }
  }
  const object = await env.MEDIA.get(asset.object_key, {
    range: request.headers,
    onlyIf: request.headers
  });
  if (!object) return new Response("Mídia não encontrada.", { status: 404 });
  if (!("body" in object)) return new Response(null, { status: 304 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", asset.mime_type);
  headers.set("Accept-Ranges", "bytes");
  headers.set("ETag", object.httpEtag);
  headers.set("Cache-Control", "public, max-age=86400, immutable");
  let status = 200;
  if (object.range) {
    status = 206;
    if (
      "offset" in object.range &&
      typeof object.range.offset === "number" &&
      typeof object.range.length === "number"
    ) {
      headers.set(
        "Content-Range",
        `bytes ${object.range.offset}-${object.range.offset + object.range.length - 1}/${object.size}`
      );
      headers.set("Content-Length", String(object.range.length));
    }
  } else {
    headers.set("Content-Length", String(object.size));
  }
  return new Response(object.body, { status, headers });
}
