import type { SessionUser } from "../../../packages/shared/src/schemas";
import {
  cfRequest,
  CloudflareApiError,
  providerConfig,
  providerStatus
} from "./cloudflare";
import { randomId } from "./crypto";
import { errorResponse, json, readJson, requireSameOrigin } from "./http";
import {
  audit,
  parseBodyRecord,
  requiredString,
  safeJson,
  ValidationError
} from "./platform";

interface DomainRow {
  id: string;
  funnel_id: string | null;
  funnel_name: string | null;
  site_id: string | null;
  site_name: string | null;
  hostname: string;
  status: "pending" | "validating" | "active" | "failed";
  is_primary: number;
  provider_config_json: string;
  last_checked_at: string | null;
}

interface CloudflareDomain {
  id: string;
  cert_id?: string;
  hostname: string;
  service: string;
  zone_id: string;
  zone_name: string;
}

interface CloudflareZone {
  id: string;
  name: string;
  status: string;
  name_servers?: string[];
}

interface DomainRouteRow {
  domain_id: string;
  offer_slug: string | null;
  page_slug: string | null;
  standalone: number;
}

function cloudflareDomainError(error: CloudflareApiError): Response {
  const message = error.message.toLowerCase();
  if (
    message.includes("account.zone.create") ||
    message.includes("requires permission")
  ) {
    return errorResponse(
      403,
      "CLOUDFLARE_ZONE_PERMISSION_REQUIRED",
      "A permissão para adicionar domínios precisa ser atualizada. Clique em “Atualizar permissão” e autorize novamente na Cloudflare."
    );
  }
  if (message.includes("already exists") || message.includes("already been claimed")) {
    return errorResponse(
      409,
      "CLOUDFLARE_ZONE_ALREADY_EXISTS",
      "Esse domínio já está cadastrado em outra conta Cloudflare. Conecte a conta correta ou remova o domínio da conta anterior."
    );
  }
  if (error.status === 401 || error.status === 403) {
    return errorResponse(
      403,
      "CLOUDFLARE_REAUTHORIZE_REQUIRED",
      "A autorização da Cloudflare expirou ou não cobre esta ação. Reconecte a conta e tente novamente."
    );
  }
  return errorResponse(
    error.status >= 500 ? 502 : 400,
    "CLOUDFLARE_DOMAIN_ERROR",
    `A Cloudflare recusou o domínio: ${error.message}`
  );
}

function normalizeHostname(value: string): string {
  const hostname = value.trim().toLowerCase().replace(/\.$/, "");
  if (
    hostname.length > 253 ||
    !/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname)
  ) {
    throw new ValidationError("Informe um domínio ou subdomínio válido.");
  }
  return hostname;
}

async function readDomains(env: Env) {
  const result = await env.DB.prepare(
    `SELECT d.*, f.name AS funnel_name,
       json_extract(d.provider_config_json, '$.pageId') AS site_id,
       p.name AS site_name
     FROM domains d
     LEFT JOIN funnels f ON f.id = d.funnel_id
     LEFT JOIN pages p ON p.id = json_extract(d.provider_config_json, '$.pageId')
     ORDER BY d.created_at DESC`
  ).all<DomainRow>();
  return {
    provider: await providerStatus(env),
    domains: result.results.map((row) => ({
      ...safeJson<{ zoneName?: string; certIssued?: boolean }>(row.provider_config_json, {}),
      id: row.id,
      funnelId: row.funnel_id,
      funnelName: row.funnel_name,
      siteId: row.site_id,
      siteName: row.site_name,
      hostname: row.hostname,
      status: row.status,
      isPrimary: Boolean(row.is_primary),
      lastCheckedAt: row.last_checked_at
    }))
  };
}

async function listZones(env: Env): Promise<Response> {
  const provider = await providerConfig(env);
  if (!provider.connected || !provider.accountId) {
    return errorResponse(
      409,
      "PROVIDER_NOT_CONFIGURED",
      "Conecte sua conta Cloudflare para ver os domínios disponíveis."
    );
  }
  const zones = await listAllZones(env, provider.accountId);
  return json({
    zones: zones.map(({ id, name, status, name_servers }) => ({
      id,
      name,
      status,
      nameServers: name_servers ?? []
    }))
  });
}

async function listAllZones(env: Env, accountId: string): Promise<CloudflareZone[]> {
  const zones: CloudflareZone[] = [];
  const perPage = 50;
  for (let page = 1; page <= 20; page += 1) {
    const current = await cfRequest<CloudflareZone[]>(
      env,
      `/zones?account.id=${encodeURIComponent(accountId)}&per_page=${perPage}&page=${page}`
    );
    zones.push(...current);
    if (current.length < perPage) break;
  }
  return zones;
}

async function listWorkerDomains(
  env: Env,
  accountId: string,
  workerName: string
): Promise<CloudflareDomain[]> {
  const domains: CloudflareDomain[] = [];
  const perPage = 100;
  for (let page = 1; page <= 20; page += 1) {
    const current = await cfRequest<CloudflareDomain[]>(
      env,
      `/accounts/${encodeURIComponent(accountId)}/workers/domains?service=${encodeURIComponent(workerName)}&per_page=${perPage}&page=${page}`
    );
    domains.push(...current);
    if (current.length < perPage) break;
  }
  return domains;
}

async function importExternalDomain(
  request: Request,
  env: Env,
  user: SessionUser
): Promise<Response> {
  const body = parseBodyRecord(await readJson(request, 16_000));
  const domain = normalizeHostname(requiredString(body.domain, "Domínio", 253));
  const provider = await providerConfig(env);
  if (!provider.connected || !provider.accountId) {
    return errorResponse(
      409,
      "PROVIDER_NOT_CONFIGURED",
      "Conecte sua conta Cloudflare antes de importar o domínio."
    );
  }
  const existing = await cfRequest<CloudflareZone[]>(
    env,
    `/zones?account.id=${encodeURIComponent(provider.accountId)}&name=${encodeURIComponent(domain)}&per_page=1`
  );
  const zone = existing[0] ?? await cfRequest<CloudflareZone>(
    env,
    "/zones",
    {
      method: "POST",
      body: JSON.stringify({
        account: { id: provider.accountId },
        name: domain,
        type: "full"
      })
    }
  );
  await audit(env, user.id, "domain.import_started", "zone", zone.id, {
    domain,
    status: zone.status
  }).run();
  return json({
    zone: {
      id: zone.id,
      name: zone.name,
      status: zone.status,
      nameServers: zone.name_servers ?? []
    },
    registrarStepRequired: zone.status !== "active"
  }, { status: existing[0] ? 200 : 201 });
}

async function attachDomain(
  request: Request,
  env: Env,
  user: SessionUser
): Promise<Response> {
  const body = parseBodyRecord(await readJson(request, 32_000));
  const hostname = normalizeHostname(requiredString(body.hostname, "Domínio", 253));
  const siteId = requiredString(body.siteId, "Site", 100);
  const existing = await env.DB.prepare(
    "SELECT id, status FROM domains WHERE hostname = ? LIMIT 1"
  )
    .bind(hostname)
    .first<{ id: string; status: string }>();
  if (existing && existing.status !== "failed") {
    throw new ValidationError("Esse endereço já está publicado na KRANO.");
  }
  const site = await env.DB.prepare(
    `SELECT id FROM pages
     WHERE id = ? AND status = 'published' AND published_version_id IS NOT NULL
     LIMIT 1`
  )
    .bind(siteId)
    .first<{ id: string }>();
  if (!site) {
    throw new ValidationError("Publique o site antes de conectar o domínio.");
  }
  const provider = await providerConfig(env);
  if (!provider.connected || !provider.accountId) {
    return errorResponse(
      409,
      "PROVIDER_NOT_CONFIGURED",
      "A conexão Cloudflare ainda não está configurada."
    );
  }
  const zones = await listAllZones(env, provider.accountId);
  const zone = zones
    .filter(({ name, status }) => {
      const normalizedName = name.toLowerCase();
      return (
        status === "active" &&
        (hostname === normalizedName || hostname.endsWith(`.${normalizedName}`))
      );
    })
    .sort((first, second) => second.name.length - first.name.length)[0];
  if (!zone) {
    throw new ValidationError(
      "Esse endereço não pertence a um domínio ativo da conta autorizada."
    );
  }
  const attached = await cfRequest<CloudflareDomain>(
    env,
    `/accounts/${encodeURIComponent(provider.accountId)}/workers/domains`,
    {
      method: "PUT",
      body: JSON.stringify({
        hostname,
        service: provider.workerName,
        zone_id: zone.id,
        zone_name: zone.name
      })
    }
  );
  const domainStatus = attached.cert_id ? "active" : "validating";
  const id = existing?.id ?? randomId();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO domains(
        id, funnel_id, hostname, status, is_primary, provider_config_json, last_checked_at
       ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(hostname) DO UPDATE SET
         funnel_id = excluded.funnel_id,
         status = excluded.status,
         is_primary = excluded.is_primary,
         provider_config_json = excluded.provider_config_json,
         last_checked_at = datetime('now'),
         updated_at = datetime('now')`
    ).bind(
      id,
      null,
      hostname,
      domainStatus,
      body.isPrimary === true ? 1 : 0,
      JSON.stringify({
        domainId: attached.id,
        zoneId: zone.id,
        zoneName: zone.name,
        certIssued: Boolean(attached.cert_id),
        pageId: siteId
      })
    ),
    audit(env, user.id, "domain.attached", "domain", id, { hostname })
  ]);
  return json({ id, hostname, status: domainStatus }, { status: 201 });
}

async function syncDomains(env: Env, user: SessionUser): Promise<Response> {
  const provider = await providerConfig(env);
  if (!provider.connected || !provider.accountId) {
    return errorResponse(409, "PROVIDER_NOT_CONFIGURED", "A conexão Cloudflare não está configurada.");
  }
  const remote = await listWorkerDomains(env, provider.accountId, provider.workerName);
  const local = await env.DB.prepare(
    "SELECT id, hostname, provider_config_json FROM domains"
  ).all<{ id: string; hostname: string; provider_config_json: string }>();
  const statements = local.results.map((row) => {
    const match = remote.find((item) => item.hostname === row.hostname);
    const current = safeJson<Record<string, unknown>>(row.provider_config_json, {});
    const status = match ? (match.cert_id ? "active" : "validating") : "failed";
    return env.DB.prepare(
      `UPDATE domains
       SET status = ?, provider_config_json = ?, last_checked_at = datetime('now'),
           updated_at = datetime('now')
       WHERE id = ?`
    ).bind(
      status,
      JSON.stringify(
        match
          ? {
              ...current,
              domainId: match.id,
              zoneId: match.zone_id,
              zoneName: match.zone_name,
              certIssued: Boolean(match.cert_id)
            }
          : { ...current, certIssued: false }
      ),
      row.id
    );
  });
  statements.push(audit(env, user.id, "domains.synced", "domain", "all", { count: remote.length }));
  await env.DB.batch(statements);
  return json({
    ok: true,
    remoteCount: remote.length,
    activeCount: remote.filter((item) => Boolean(item.cert_id)).length,
    validatingCount: remote.filter((item) => !item.cert_id).length
  });
}

async function detachDomain(
  request: Request,
  env: Env,
  user: SessionUser,
  id: string
): Promise<Response> {
  const body = parseBodyRecord(await readJson(request, 16_000));
  const row = await env.DB.prepare(
    "SELECT id, hostname, provider_config_json FROM domains WHERE id = ?"
  ).bind(id).first<Pick<DomainRow, "id" | "hostname" | "provider_config_json">>();
  if (!row) return errorResponse(404, "NOT_FOUND", "Domínio não encontrado.");
  if (body.confirmation !== row.hostname) {
    throw new ValidationError("Confirme digitando exatamente o domínio.");
  }
  const provider = await providerConfig(env);
  const remoteId = safeJson<{ domainId?: string }>(row.provider_config_json, {}).domainId;
  if (!provider.connected || !provider.accountId || !remoteId) {
    return errorResponse(409, "PROVIDER_NOT_CONFIGURED", "Não é possível remover sem a conexão Cloudflare.");
  }
  await cfRequest<unknown>(
    env,
    `/accounts/${encodeURIComponent(provider.accountId)}/workers/domains/${encodeURIComponent(remoteId)}`,
    { method: "DELETE" }
  );
  await env.DB.batch([
    env.DB.prepare("DELETE FROM domains WHERE id = ?").bind(id),
    audit(env, user.id, "domain.detached", "domain", id, { hostname: row.hostname })
  ]);
  return json({ ok: true });
}

export async function resolveCustomDomainUrl(
  env: Env,
  url: URL
): Promise<{ matched: boolean; publicUrl: URL | null }> {
  const pageSlug =
    url.pathname === "/"
      ? null
      : /^\/[a-z0-9][a-z0-9-]{0,99}\/?$/i.test(url.pathname)
        ? url.pathname.slice(1).replace(/\/$/, "")
        : "__unmatched__";
  const row = await env.DB.prepare(
    `SELECT d.id AS domain_id, o.slug AS offer_slug, p.slug AS page_slug,
       CASE WHEN p.offer_id IS NULL THEN 1 ELSE 0 END AS standalone
     FROM domains d
     LEFT JOIN funnels f
       ON f.id = d.funnel_id AND f.status = 'published'
     LEFT JOIN pages p
       ON (p.funnel_id = f.id OR p.id = json_extract(d.provider_config_json, '$.pageId'))
      AND p.status = 'published'
      AND p.published_version_id IS NOT NULL
      AND (? IS NULL OR p.slug = ?)
     LEFT JOIN offers o
       ON o.id = p.offer_id AND o.status = 'active'
     WHERE d.hostname = ? AND d.status = 'active'
     ORDER BY
       CASE p.page_type WHEN 'vsl' THEN 0 WHEN 'sales' THEN 1 ELSE 2 END,
       p.created_at
     LIMIT 1`
  )
    .bind(pageSlug, pageSlug, url.hostname.toLowerCase())
    .first<DomainRouteRow>();
  if (!row) return { matched: false, publicUrl: null };
  if (!row.page_slug || pageSlug === "__unmatched__") {
    return { matched: true, publicUrl: null };
  }
  const publicUrl = new URL(url);
  publicUrl.pathname = row.standalone
    ? `/s/${encodeURIComponent(row.page_slug)}`
    : `/o/${encodeURIComponent(row.offer_slug ?? "")}/${encodeURIComponent(row.page_slug)}`;
  return { matched: true, publicUrl };
}

export async function handleDomainsApi(
  request: Request,
  env: Env,
  user: SessionUser,
  url: URL
): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/domains")) return null;
  if (["POST", "PATCH", "DELETE"].includes(request.method) && !requireSameOrigin(request)) {
    return errorResponse(403, "ORIGIN_INVALID", "Origem inválida.");
  }
  try {
    if (url.pathname === "/api/domains" && request.method === "GET") {
      return json(await readDomains(env));
    }
    if (url.pathname === "/api/domains/zones" && request.method === "GET") {
      return await listZones(env);
    }
    if (url.pathname === "/api/domains/import" && request.method === "POST") {
      return await importExternalDomain(request, env, user);
    }
    if (url.pathname === "/api/domains" && request.method === "POST") {
      return await attachDomain(request, env, user);
    }
    if (url.pathname === "/api/domains/sync" && request.method === "POST") {
      return await syncDomains(env, user);
    }
    const match = url.pathname.match(/^\/api\/domains\/([^/]+)$/);
    if (match && request.method === "DELETE") {
      return await detachDomain(request, env, user, match[1]);
    }
    return errorResponse(404, "NOT_FOUND", "Rota de domínio não encontrada.");
  } catch (error) {
    if (error instanceof CloudflareApiError) {
      return cloudflareDomainError(error);
    }
    if (error instanceof ValidationError) {
      return errorResponse(400, "VALIDATION_ERROR", error.message);
    }
    throw error;
  }
}
