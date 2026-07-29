import type {
  AssetSummary,
  PlayerConfig,
  SessionUser,
  VideoMetrics
} from "../../../packages/shared/src/schemas";
import { randomId } from "./crypto";
import { errorResponse, json, readJson, requireSameOrigin } from "./http";
import {
  audit,
  mediaTypeForMime,
  optionalString,
  parseBodyRecord,
  requiredString,
  safeJson,
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
  player_config_json: string;
  created_at: string;
}

interface PartRow {
  part_number: number;
  etag: string;
  byte_size: number;
}

export interface MultipartPartDescriptor {
  partNumber: number;
  byteSize: number;
}

export type MultipartValidationResult =
  | { ok: true; totalBytes: number }
  | {
      ok: false;
      totalBytes: number;
      code: "EMPTY" | "SEQUENCE" | "PART_SIZE" | "TOTAL_SIZE";
    };

const MAX_MULTIPART_PART_BYTES = 16 * 1024 * 1024;
const MIN_NON_FINAL_PART_BYTES = 5 * 1024 * 1024;

function mediaBinding(env: Env): R2Bucket | null {
  return (env as Env & { MEDIA?: R2Bucket }).MEDIA ?? null;
}

function requireMediaBinding(env: Env): R2Bucket {
  const media = mediaBinding(env);
  if (!media) throw new ValidationError("Ative o módulo Hospedagem de VSL para usar a biblioteca de mídia.");
  return media;
}

export function validateMultipartParts(
  declaredBytes: number,
  parts: MultipartPartDescriptor[],
  maxFileBytes: number
): MultipartValidationResult {
  if (!parts.length) return { ok: false, totalBytes: 0, code: "EMPTY" };
  let totalBytes = 0;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part.partNumber !== index + 1) {
      return { ok: false, totalBytes, code: "SEQUENCE" };
    }
    const finalPart = index === parts.length - 1;
    if (
      !Number.isSafeInteger(part.byteSize) ||
      part.byteSize <= 0 ||
      part.byteSize > MAX_MULTIPART_PART_BYTES ||
      (!finalPart && part.byteSize < MIN_NON_FINAL_PART_BYTES)
    ) {
      return { ok: false, totalBytes, code: "PART_SIZE" };
    }
    totalBytes += part.byteSize;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > maxFileBytes) {
      return { ok: false, totalBytes, code: "TOTAL_SIZE" };
    }
  }
  if (
    !Number.isSafeInteger(declaredBytes) ||
    declaredBytes <= 0 ||
    declaredBytes > maxFileBytes ||
    totalBytes !== declaredBytes
  ) {
    return { ok: false, totalBytes, code: "TOTAL_SIZE" };
  }
  return { ok: true, totalBytes };
}

export const DEFAULT_PLAYER_CONFIG: PlayerConfig = {
  showControls: true,
  showBigPlay: true,
  showVolume: true,
  showTime: true,
  showFullscreen: true,
  timelineStyle: "real",
  allowSeek: true,
  rewindSeconds: 0,
  forwardSeconds: 0,
  resumePlayback: true,
  resumeMessage: "Você já começou a assistir este vídeo",
  resumeContinueLabel: "Continuar assistindo",
  resumeRestartLabel: "Assistir do início",
  showSpeed: false,
  showQuality: false,
  autoplayMuted: false,
  autoplayMessage: "Seu vídeo já começou. Clique para ouvir.",
  clickToPause: true,
  protectVideo: true,
  watermark: "",
  primaryColor: "#f00000",
  backgroundColor: "#000000",
  borderRadius: 18,
  smartProgress: false,
  smartProgressHeight: 6,
  playbackRate: 1,
  loop: false,
  headlineText: "",
  headlineStartSeconds: 0,
  headlineEndSeconds: 0,
  miniHookText: "",
  miniHookStartSeconds: 0,
  miniHookEndSeconds: 0,
  ctaAtSeconds: 0,
  ctaEndSeconds: 0,
  ctaText: "Quero acessar agora",
  ctaUrl: "",
  ctaNewTab: false,
  ctaPulse: true,
  allowedDomains: [],
  posterAssetId: "",
  posterTestAssetId: "",
  qualitySources: []
};

export function normalizePlayerConfig(value: unknown): PlayerConfig {
  const input =
    value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  const qualitySources = Array.isArray(input.qualitySources)
    ? input.qualitySources
        .slice(0, 3)
        .map((item) =>
          item && typeof item === "object" && !Array.isArray(item)
            ? item as Record<string, unknown>
            : {}
        )
        .filter(
          (item) =>
            ["360p", "720p", "1080p"].includes(String(item.label)) &&
            typeof item.assetId === "string" &&
            /^[a-zA-Z0-9-]{8,100}$/.test(item.assetId)
        )
        .map((item) => ({
          label: String(item.label) as "360p" | "720p" | "1080p",
          assetId: String(item.assetId)
        }))
    : [];
  const timelineStyle = ["real", "minimal", "hidden"].includes(String(input.timelineStyle))
    ? String(input.timelineStyle) as PlayerConfig["timelineStyle"]
    : DEFAULT_PLAYER_CONFIG.timelineStyle;
  const number = (key: string, fallback: number, minimum: number, maximum: number) => {
    const parsed = Number(input[key]);
    return Math.min(Math.max(Number.isFinite(parsed) ? parsed : fallback, minimum), maximum);
  };
  const text = (key: string, fallback: string, maximum: number) =>
    typeof input[key] === "string" ? String(input[key]).trim().slice(0, maximum) : fallback;
  const color = (key: string, fallback: string) =>
    typeof input[key] === "string" && /^#[0-9a-fA-F]{6}$/.test(String(input[key]))
      ? String(input[key]).toLowerCase()
      : fallback;
  const jump = (key: string): 0 | 5 | 10 =>
    [0, 5, 10].includes(Number(input[key])) ? Number(input[key]) as 0 | 5 | 10 : 0;
  const assetId = (key: string) =>
    typeof input[key] === "string" && (/^[a-zA-Z0-9-]{8,100}$/.test(String(input[key])) || input[key] === "")
      ? String(input[key])
      : "";
  const allowedDomains = Array.isArray(input.allowedDomains)
    ? input.allowedDomains
        .slice(0, 30)
        .map((item) => String(item).trim().toLowerCase())
        .filter((item) => /^(\*\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(item))
    : [];
  return {
    showControls: input.showControls !== false,
    showBigPlay: input.showBigPlay !== false,
    showVolume: input.showVolume !== false,
    showTime: input.showTime !== false,
    showFullscreen: input.showFullscreen !== false,
    timelineStyle,
    allowSeek: input.allowSeek !== false,
    rewindSeconds: jump("rewindSeconds"),
    forwardSeconds: jump("forwardSeconds"),
    resumePlayback: input.resumePlayback !== false,
    resumeMessage: text("resumeMessage", DEFAULT_PLAYER_CONFIG.resumeMessage, 120),
    resumeContinueLabel: text("resumeContinueLabel", DEFAULT_PLAYER_CONFIG.resumeContinueLabel, 60),
    resumeRestartLabel: text("resumeRestartLabel", DEFAULT_PLAYER_CONFIG.resumeRestartLabel, 60),
    showSpeed: input.showSpeed === true,
    showQuality: input.showQuality === true,
    autoplayMuted: input.autoplayMuted === true,
    autoplayMessage: text("autoplayMessage", DEFAULT_PLAYER_CONFIG.autoplayMessage, 120),
    clickToPause: input.clickToPause !== false,
    protectVideo: input.protectVideo !== false,
    watermark: typeof input.watermark === "string" ? input.watermark.trim().slice(0, 40) : "",
    primaryColor: color("primaryColor", DEFAULT_PLAYER_CONFIG.primaryColor),
    backgroundColor: color("backgroundColor", DEFAULT_PLAYER_CONFIG.backgroundColor),
    borderRadius: number("borderRadius", DEFAULT_PLAYER_CONFIG.borderRadius, 0, 40),
    smartProgress: input.smartProgress === true,
    smartProgressHeight: number("smartProgressHeight", DEFAULT_PLAYER_CONFIG.smartProgressHeight, 2, 16),
    playbackRate: number("playbackRate", DEFAULT_PLAYER_CONFIG.playbackRate, 0.75, 1.5),
    loop: input.loop === true,
    headlineText: text("headlineText", "", 180),
    headlineStartSeconds: number("headlineStartSeconds", 0, 0, 86_400),
    headlineEndSeconds: number("headlineEndSeconds", 0, 0, 86_400),
    miniHookText: text("miniHookText", "", 180),
    miniHookStartSeconds: number("miniHookStartSeconds", 0, 0, 86_400),
    miniHookEndSeconds: number("miniHookEndSeconds", 0, 0, 86_400),
    ctaAtSeconds: number("ctaAtSeconds", 0, 0, 86_400),
    ctaEndSeconds: number("ctaEndSeconds", 0, 0, 86_400),
    ctaText: text("ctaText", DEFAULT_PLAYER_CONFIG.ctaText, 80),
    ctaUrl: typeof input.ctaUrl === "string" && /^https:\/\//i.test(input.ctaUrl)
      ? input.ctaUrl.trim().slice(0, 2_000)
      : "",
    ctaNewTab: input.ctaNewTab === true,
    ctaPulse: input.ctaPulse !== false,
    allowedDomains: [...new Set(allowedDomains)],
    posterAssetId: assetId("posterAssetId"),
    posterTestAssetId: assetId("posterTestAssetId"),
    qualitySources
  };
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
    url: row.upload_status === "ready" ? `/media/${row.id}` : null,
    playerConfig: normalizePlayerConfig(
      safeJson<unknown>(row.player_config_json, DEFAULT_PLAYER_CONFIG)
    )
  };
}

async function findAsset(env: Env, id: string): Promise<AssetRow | null> {
  return env.DB.prepare(
    `SELECT id, offer_id, object_key, original_name, media_type, mime_type, extension,
     byte_size, upload_status, multipart_upload_id, player_config_json, created_at
     FROM assets WHERE id = ? AND deleted_at IS NULL`
  ).bind(id).first<AssetRow>();
}

async function listAssets(env: Env): Promise<AssetSummary[]> {
  const result = await env.DB.prepare(
    `SELECT id, offer_id, object_key, original_name, media_type, mime_type, extension,
     byte_size, upload_status, multipart_upload_id, player_config_json, created_at
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
  const maxStorage = Number(env.MAX_STORAGE_BYTES) || 10_737_418_240;
  const id = randomId();
  const extension = (originalName.split(".").pop() ?? "bin").toLowerCase().slice(0, 12);
  const objectKey = `assets/${new Date().toISOString().slice(0, 10)}/${id}-${sanitizeFileName(originalName)}`;
  const multipart = await requireMediaBinding(env).createMultipartUpload(objectKey, {
    httpMetadata: { contentType: mime },
    customMetadata: { assetId: id, originalName: sanitizeFileName(originalName) }
  });
  let inserted: D1Result<unknown>;
  try {
    inserted = await env.DB.prepare(
      `INSERT INTO assets(
        id, offer_id, object_key, original_name, media_type, mime_type, extension,
        byte_size, sha256, upload_status, multipart_upload_id, created_by
       )
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploading', ?, ?
       WHERE ? <> 'true' OR (
         SELECT COALESCE(SUM(byte_size), 0)
         FROM assets
         WHERE upload_status IN ('ready', 'uploading') AND deleted_at IS NULL
       ) + ? <= ?`
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
      user.id,
      env.FREE_ONLY,
      byteSize,
      maxStorage
    ).run();
  } catch (error) {
    try {
      await multipart.abort();
    } catch {
      // A rotina agendada também limpa uploads órfãos caso o provedor já os tenha removido.
    }
    throw error;
  }
  if (!inserted.meta.changes) {
    try {
      await multipart.abort();
    } catch {
      // A ausência do upload remoto não altera a recusa atômica da reserva.
    }
    return errorResponse(
      409,
      "FREE_ONLY_STORAGE_LIMIT",
      "Este upload ultrapassaria o limite de proteção configurado."
    );
  }
  await audit(env, user.id, "asset.upload_started", "asset", id, { byteSize, mime }).run();
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
  if (length <= 0 || length > MAX_MULTIPART_PART_BYTES) {
    throw new ValidationError("Parte vazia ou maior que 16 MB.");
  }
  if (!request.body) throw new ValidationError("Parte vazia.");
  const upload = requireMediaBinding(env).resumeMultipartUpload(asset.object_key, asset.multipart_upload_id);
  const uploaded = await upload.uploadPart(partNumber, request.body);
  await env.DB.prepare(
    `INSERT INTO asset_upload_parts(asset_id, part_number, etag, byte_size)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(asset_id, part_number) DO UPDATE SET
       etag = excluded.etag, byte_size = excluded.byte_size, created_at = datetime('now')`
  ).bind(id, partNumber, uploaded.etag, length).run();
  return json({ partNumber, etag: uploaded.etag });
}

async function reservedBytesExcluding(env: Env, assetId: string): Promise<number> {
  return (await env.DB.prepare(
    `SELECT COALESCE(SUM(byte_size), 0) AS value
     FROM assets
     WHERE upload_status IN ('ready', 'uploading')
       AND deleted_at IS NULL
       AND id <> ?`
  ).bind(assetId).first<number>("value")) ?? 0;
}

async function invalidateMultipartUpload(
  env: Env,
  user: SessionUser,
  asset: AssetRow,
  reason: string
): Promise<void> {
  if (asset.multipart_upload_id) {
    try {
      await requireMediaBinding(env).resumeMultipartUpload(
        asset.object_key,
        asset.multipart_upload_id
      ).abort();
    } catch {
      // O upload pode já ter sido concluído; a exclusão abaixo cobre esse estado.
    }
  }
  try {
    await requireMediaBinding(env).delete(asset.object_key);
  } catch {
    // A linha fica como failed e a limpeza agendada pode repetir a remoção.
  }
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE assets
       SET upload_status = 'failed', multipart_upload_id = NULL, updated_at = datetime('now')
       WHERE id = ?`
    ).bind(asset.id),
    env.DB.prepare("DELETE FROM asset_upload_parts WHERE asset_id = ?").bind(asset.id),
    audit(env, user.id, "asset.upload_rejected", "asset", asset.id, { reason })
  ]);
}

async function complete(env: Env, user: SessionUser, id: string): Promise<Response> {
  const asset = await findAsset(env, id);
  if (!asset?.multipart_upload_id || asset.upload_status !== "uploading") {
    return errorResponse(404, "UPLOAD_NOT_FOUND", "Upload não encontrado ou já finalizado.");
  }
  const rows = await env.DB.prepare(
    `SELECT part_number, etag, byte_size
     FROM asset_upload_parts WHERE asset_id = ? ORDER BY part_number`
  ).bind(id).all<PartRow>();
  const maxFile = Number(env.MAX_FILE_BYTES) || 524_288_000;
  const validation = validateMultipartParts(
    Number(asset.byte_size),
    rows.results.map((part) => ({
      partNumber: Number(part.part_number),
      byteSize: Number(part.byte_size)
    })),
    maxFile
  );
  if (!validation.ok) {
    await invalidateMultipartUpload(env, user, asset, validation.code);
    return errorResponse(
      409,
      "UPLOAD_INTEGRITY_ERROR",
      "As partes recebidas não correspondem ao arquivo reservado. Envie o arquivo novamente."
    );
  }
  const maxStorage = Number(env.MAX_STORAGE_BYTES) || 10_737_418_240;
  const reservedWithoutAsset = await reservedBytesExcluding(env, id);
  if (
    env.FREE_ONLY === "true" &&
    reservedWithoutAsset + validation.totalBytes > maxStorage
  ) {
    await invalidateMultipartUpload(env, user, asset, "FREE_ONLY_STORAGE_LIMIT");
    return errorResponse(
      409,
      "FREE_ONLY_STORAGE_LIMIT",
      "A conclusão ultrapassaria o limite de proteção configurado."
    );
  }
  const upload = requireMediaBinding(env).resumeMultipartUpload(asset.object_key, asset.multipart_upload_id);
  let object: R2Object;
  try {
    object = await upload.complete(
      rows.results.map((part) => ({ partNumber: part.part_number, etag: part.etag }))
    );
  } catch {
    await invalidateMultipartUpload(env, user, asset, "R2_COMPLETE_FAILED");
    return errorResponse(
      409,
      "UPLOAD_COMPLETE_FAILED",
      "A Cloudflare não confirmou todas as partes. Envie o arquivo novamente."
    );
  }
  const actualSize = Number(object.size);
  const storageAfterComplete = await reservedBytesExcluding(env, id);
  if (
    !Number.isSafeInteger(actualSize) ||
    actualSize !== validation.totalBytes ||
    actualSize > maxFile ||
    (env.FREE_ONLY === "true" && storageAfterComplete + actualSize > maxStorage)
  ) {
    await invalidateMultipartUpload(env, user, asset, "R2_OBJECT_SIZE_MISMATCH");
    return errorResponse(
      409,
      "UPLOAD_INTEGRITY_ERROR",
      "O arquivo confirmado não corresponde ao tamanho reservado."
    );
  }
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE assets SET upload_status = 'ready', byte_size = ?, multipart_upload_id = NULL,
       updated_at = datetime('now') WHERE id = ?`
    ).bind(actualSize, id),
    env.DB.prepare("DELETE FROM asset_upload_parts WHERE asset_id = ?").bind(id),
    audit(env, user.id, "asset.upload_completed", "asset", id, { byteSize: actualSize })
  ]);
  return json({ asset: mapAsset((await findAsset(env, id))!) });
}

async function abort(env: Env, user: SessionUser, id: string): Promise<Response> {
  const asset = await findAsset(env, id);
  if (!asset) return errorResponse(404, "NOT_FOUND", "Arquivo não encontrado.");
  if (asset.multipart_upload_id) {
    await requireMediaBinding(env).resumeMultipartUpload(asset.object_key, asset.multipart_upload_id).abort();
  } else if (asset.upload_status === "ready") {
    await requireMediaBinding(env).delete(asset.object_key);
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

async function updateAsset(
  request: Request,
  env: Env,
  user: SessionUser,
  id: string
): Promise<Response> {
  const body = parseBodyRecord(await readJson(request, 16_000));
  const name = optionalString(body.name, 180);
  const playerConfig =
    body.playerConfig && typeof body.playerConfig === "object" && !Array.isArray(body.playerConfig)
      ? normalizePlayerConfig(body.playerConfig)
      : null;
  if (!name && !playerConfig) {
    throw new ValidationError("Informe um nome ou configuração do player.");
  }
  if (playerConfig?.qualitySources.length) {
    const qualityIds = playerConfig.qualitySources.map((item) => item.assetId);
    const placeholders = qualityIds.map(() => "?").join(",");
    const videos = await env.DB.prepare(
      `SELECT id FROM assets
       WHERE id IN (${placeholders}) AND media_type = 'video'
         AND upload_status = 'ready' AND deleted_at IS NULL`
    ).bind(...qualityIds).all<{ id: string }>();
    if (videos.results.length !== new Set(qualityIds).size) {
      throw new ValidationError("Uma das qualidades escolhidas não está disponível.");
    }
  }
  if (playerConfig) {
    const posterIds = [playerConfig.posterAssetId, playerConfig.posterTestAssetId].filter(Boolean);
    if (posterIds.length) {
      const placeholders = posterIds.map(() => "?").join(",");
      const images = await env.DB.prepare(
        `SELECT id FROM assets
         WHERE id IN (${placeholders}) AND media_type = 'image'
           AND upload_status = 'ready' AND deleted_at IS NULL`
      ).bind(...posterIds).all<{ id: string }>();
      if (images.results.length !== new Set(posterIds).size) {
        throw new ValidationError("Uma das thumbnails escolhidas não está disponível.");
      }
    }
  }
  const result = await env.DB.prepare(
    `UPDATE assets SET
       original_name = COALESCE(?, original_name),
       player_config_json = COALESCE(?, player_config_json),
       updated_at = datetime('now')
     WHERE id = ? AND deleted_at IS NULL`
  ).bind(name, playerConfig ? JSON.stringify(playerConfig) : null, id).run();
  if (!result.meta.changes) return errorResponse(404, "NOT_FOUND", "Arquivo não encontrado.");
  await audit(
    env,
    user.id,
    playerConfig ? "asset.player_updated" : "asset.renamed",
    "asset",
    id
  ).run();
  return json({ asset: mapAsset((await findAsset(env, id))!) });
}

async function readVideoMetrics(env: Env, id: string, periodDays: number): Promise<Response> {
  const days = Math.min(Math.max(Math.trunc(periodDays), 1), 90);
  const since = `-${days} days`;
  const asset = await findAsset(env, id);
  if (!asset || asset.media_type !== "video") {
    return errorResponse(404, "NOT_FOUND", "Vídeo não encontrado.");
  }
  const [eventCounts, uniqueViewers, deviceRows, browserRows, sourceRows] = await Promise.all([
    env.DB.prepare(
      `SELECT event_type, COUNT(*) AS value
       FROM tracking_events
       WHERE json_extract(properties_json, '$.assetId') = ?
         AND occurred_at > datetime('now', ?)
       GROUP BY event_type`
    ).bind(id, since).all<{ event_type: string; value: number }>(),
    env.DB.prepare(
      `SELECT COUNT(DISTINCT anonymous_id) AS value
       FROM tracking_events
       WHERE event_type = 'vsl_start'
         AND json_extract(properties_json, '$.assetId') = ?
         AND occurred_at > datetime('now', ?)`
    ).bind(id, since).first<number>("value"),
    env.DB.prepare(
      `SELECT COALESCE(json_extract(properties_json, '$.device'), 'Desconhecido') AS label,
        COUNT(*) AS value
       FROM tracking_events
       WHERE event_type = 'vsl_start'
         AND json_extract(properties_json, '$.assetId') = ?
         AND occurred_at > datetime('now', ?)
       GROUP BY label ORDER BY value DESC LIMIT 8`
    ).bind(id, since).all<{ label: string; value: number }>(),
    env.DB.prepare(
      `SELECT COALESCE(json_extract(properties_json, '$.browser'), 'Desconhecido') AS label,
        COUNT(*) AS value
       FROM tracking_events
       WHERE event_type = 'vsl_start'
         AND json_extract(properties_json, '$.assetId') = ?
         AND occurred_at > datetime('now', ?)
       GROUP BY label ORDER BY value DESC LIMIT 8`
    ).bind(id, since).all<{ label: string; value: number }>(),
    env.DB.prepare(
      `SELECT COALESCE(NULLIF(source, ''), 'Direto') AS label, COUNT(*) AS value
       FROM tracking_events
       WHERE event_type = 'vsl_start'
         AND json_extract(properties_json, '$.assetId') = ?
         AND occurred_at > datetime('now', ?)
       GROUP BY label ORDER BY value DESC LIMIT 8`
    ).bind(id, since).all<{ label: string; value: number }>()
  ]);
  const counts = new Map(
    eventCounts.results.map((row) => [row.event_type, Number(row.value)])
  );
  const starts = counts.get("vsl_start") ?? 0;
  const completions = counts.get("vsl_complete") ?? 0;
  const checkpointTypes = ["vsl_start", "vsl_25", "vsl_50", "vsl_75", "vsl_complete"];
  const retention = [0, 25, 50, 75, 100].map((point, index) => {
    const viewers = counts.get(checkpointTypes[index]) ?? 0;
    return {
      percent: point,
      viewers,
      rate: starts > 0 ? Math.round((viewers / starts) * 10_000) / 100 : 0
    };
  });
  const weightedRetention =
    retention.slice(1).reduce((sum, item) => sum + item.rate, 0) /
    Math.max(retention.length - 1, 1);
  const metrics: VideoMetrics = {
    assetId: id,
    starts,
    uniqueViewers: Number(uniqueViewers ?? 0),
    pauses: counts.get("vsl_pause") ?? 0,
    completions,
    checkoutClicks: counts.get("checkout_click") ?? 0,
    pitchReached: counts.get("vsl_pitch") ?? 0,
    engagementRate: starts > 0
      ? Math.round(((counts.get("vsl_50") ?? 0) / starts) * 10_000) / 100
      : 0,
    averageRetention: Math.round(weightedRetention * 10) / 10,
    completionRate: starts > 0 ? Math.round((completions / starts) * 10_000) / 100 : 0,
    retention,
    devices: deviceRows.results.map((row) => ({ label: row.label, value: Number(row.value) })),
    browsers: browserRows.results.map((row) => ({ label: row.label, value: Number(row.value) })),
    sources: sourceRows.results.map((row) => ({ label: row.label, value: Number(row.value) })),
    periodDays: days
  };
  return json({ metrics });
}

export async function handleAssetsApi(
  request: Request,
  env: Env,
  user: SessionUser,
  url: URL
): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/assets")) return null;
  if (!mediaBinding(env)) {
    return errorResponse(
      409,
      "MEDIA_MODULE_DISABLED",
      "Hospedagem de VSL não está ativa. Habilite o módulo no aplicativo KRANO."
    );
  }
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
    const metricsMatch = url.pathname.match(/^\/api\/assets\/([^/]+)\/metrics$/);
    if (metricsMatch && request.method === "GET") {
      return readVideoMetrics(env, metricsMatch[1], Number(url.searchParams.get("days") ?? "7"));
    }
    const assetMatch = url.pathname.match(/^\/api\/assets\/([^/]+)$/);
    if (assetMatch && request.method === "PATCH") {
      return updateAsset(request, env, user, assetMatch[1]);
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
  if (!mediaBinding(env)) {
    return new Response("Hospedagem de VSL não está ativa.", { status: 404 });
  }
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
  const object = await requireMediaBinding(env).get(asset.object_key, {
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
