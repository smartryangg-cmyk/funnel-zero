import type { SessionUser } from "../../../packages/shared/src/schemas";
import { randomId } from "./crypto";
import { errorResponse, json, readJson, requireSameOrigin } from "./http";
import {
  audit,
  optionalString,
  parseBodyRecord,
  requiredString,
  safeJson,
  ValidationError
} from "./platform";

interface SettingRow {
  value_json: string;
}

interface DomainRow {
  id: string;
  funnel_id: string | null;
  funnel_name: string | null;
  hostname: string;
  status: "pending" | "validating" | "active" | "failed";
  is_primary: number;
  provider_config_json: string;
  last_checked_at: string | null;
}

interface ProviderConfig {
  configured: boolean;
  accountId: string;
  workerName: string;
}

interface CloudflareDomain {
  id: string;
  hostname: string;
  service: string;
  zone_id: string;
  zone_name: string;
}

interface CloudflareResponse<T> {
  success: boolean;
  result: T;
  errors?: Array<{ message?: string }>;
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

async function providerConfig(env: Env): Promise<ProviderConfig> {
  const row = await env.DB.prepare(
    "SELECT value_json FROM installation_settings WHERE key = 'domain_provider'"
  ).first<SettingRow>();
  return safeJson<ProviderConfig>(row?.value_json, {
    configured: false,
    accountId: "",
    workerName: ""
  });
}

async function cfRequest<T>(
  env: Env,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  if (!env.CLOUDFLARE_API_TOKEN) throw new ValidationError("Token da Cloudflare não configurado.");
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      "Content-Type": "application/json",
      ...init.headers
    }
  });
  const payload = await response.json<CloudflareResponse<T>>();
  if (!response.ok || !payload.success) {
    throw new ValidationError(
      payload.errors?.[0]?.message ?? "A Cloudflare recusou a operação de domínio."
    );
  }
  return payload.result;
}

async function readDomains(env: Env) {
  const result = await env.DB.prepare(
    `SELECT d.*, f.name AS funnel_name FROM domains d
     LEFT JOIN funnels f ON f.id = d.funnel_id ORDER BY d.created_at DESC`
  ).all<DomainRow>();
  const provider = await providerConfig(env);
  return {
    provider: {
      ...provider,
      tokenAvailable: Boolean(env.CLOUDFLARE_API_TOKEN)
    },
    domains: result.results.map((row) => ({
      id: row.id,
      funnelId: row.funnel_id,
      funnelName: row.funnel_name,
      hostname: row.hostname,
      status: row.status,
      isPrimary: Boolean(row.is_primary),
      lastCheckedAt: row.last_checked_at
    }))
  };
}

async function saveProvider(
  request: Request,
  env: Env,
  user: SessionUser
): Promise<Response> {
  const body = parseBodyRecord(await readJson(request, 16_000));
  const accountId = requiredString(body.accountId, "Account ID", 64);
  const workerName = requiredString(body.workerName, "Worker", 80);
  if (!/^[a-f0-9]{32}$/i.test(accountId)) {
    throw new ValidationError("Account ID inválido.");
  }
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/i.test(workerName)) {
    throw new ValidationError("Nome do Worker inválido.");
  }
  const config: ProviderConfig = { configured: true, accountId, workerName };
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO installation_settings(key, value_json, updated_at)
       VALUES ('domain_provider', ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = datetime('now')`
    ).bind(JSON.stringify(config)),
    audit(env, user.id, "domain_provider.updated", "settings", "domain_provider", {
      accountId,
      workerName,
      tokenStoredInSecret: Boolean(env.CLOUDFLARE_API_TOKEN)
    })
  ]);
  return json({ provider: { ...config, tokenAvailable: Boolean(env.CLOUDFLARE_API_TOKEN) } });
}

async function listZones(env: Env): Promise<Response> {
  const provider = await providerConfig(env);
  if (!provider.configured || !env.CLOUDFLARE_API_TOKEN) {
    return errorResponse(
      409,
      "PROVIDER_NOT_CONFIGURED",
      "Configure o Account ID, o Worker e o secret CLOUDFLARE_API_TOKEN."
    );
  }
  const zones = await cfRequest<Array<{ id: string; name: string; status: string }>>(
    env,
    `/zones?account.id=${encodeURIComponent(provider.accountId)}&per_page=50`
  );
  return json({ zones: zones.map(({ id, name, status }) => ({ id, name, status })) });
}

async function attachDomain(
  request: Request,
  env: Env,
  user: SessionUser
): Promise<Response> {
  const body = parseBodyRecord(await readJson(request, 32_000));
  const hostname = normalizeHostname(requiredString(body.hostname, "Domínio", 253));
  if (body.confirmation !== hostname) {
    throw new ValidationError("Confirme digitando exatamente o domínio.");
  }
  const provider = await providerConfig(env);
  if (!provider.configured || !env.CLOUDFLARE_API_TOKEN) {
    return errorResponse(
      409,
      "PROVIDER_NOT_CONFIGURED",
      "A conexão Cloudflare ainda não está configurada."
    );
  }
  const zoneId = requiredString(body.zoneId, "Zona", 64);
  const zoneName = normalizeHostname(requiredString(body.zoneName, "Nome da zona", 253));
  const attached = await cfRequest<CloudflareDomain>(
    env,
    `/accounts/${encodeURIComponent(provider.accountId)}/workers/domains`,
    {
      method: "PUT",
      body: JSON.stringify({
        hostname,
        service: provider.workerName,
        zone_id: zoneId,
        zone_name: zoneName
      })
    }
  );
  const id = randomId();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO domains(
        id, funnel_id, hostname, status, is_primary, provider_config_json, last_checked_at
       ) VALUES (?, ?, ?, 'active', ?, ?, datetime('now'))`
    ).bind(
      id,
      optionalString(body.funnelId, 100),
      hostname,
      body.isPrimary === true ? 1 : 0,
      JSON.stringify({ domainId: attached.id, zoneId, zoneName })
    ),
    audit(env, user.id, "domain.attached", "domain", id, { hostname })
  ]);
  return json({ id, hostname, status: "active" }, { status: 201 });
}

async function syncDomains(env: Env, user: SessionUser): Promise<Response> {
  const provider = await providerConfig(env);
  if (!provider.configured || !env.CLOUDFLARE_API_TOKEN) {
    return errorResponse(409, "PROVIDER_NOT_CONFIGURED", "A conexão Cloudflare não está configurada.");
  }
  const remote = await cfRequest<CloudflareDomain[]>(
    env,
    `/accounts/${encodeURIComponent(provider.accountId)}/workers/domains?service=${encodeURIComponent(provider.workerName)}`
  );
  const local = await env.DB.prepare(
    "SELECT id, hostname FROM domains"
  ).all<{ id: string; hostname: string }>();
  const statements = local.results.map((row) => {
    const active = remote.some((item) => item.hostname === row.hostname);
    return env.DB.prepare(
      "UPDATE domains SET status = ?, last_checked_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
    ).bind(active ? "active" : "failed", row.id);
  });
  statements.push(audit(env, user.id, "domains.synced", "domain", "all", { count: remote.length }));
  await env.DB.batch(statements);
  return json({ ok: true, remoteCount: remote.length });
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
  if (!provider.configured || !env.CLOUDFLARE_API_TOKEN || !remoteId) {
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
    if (url.pathname === "/api/domains/provider" && request.method === "PATCH") {
      return saveProvider(request, env, user);
    }
    if (url.pathname === "/api/domains/zones" && request.method === "GET") {
      return listZones(env);
    }
    if (url.pathname === "/api/domains" && request.method === "POST") {
      return attachDomain(request, env, user);
    }
    if (url.pathname === "/api/domains/sync" && request.method === "POST") {
      return syncDomains(env, user);
    }
    const match = url.pathname.match(/^\/api\/domains\/([^/]+)$/);
    if (match && request.method === "DELETE") {
      return detachDomain(request, env, user, match[1]);
    }
    return errorResponse(404, "NOT_FOUND", "Rota de domínio não encontrada.");
  } catch (error) {
    if (error instanceof ValidationError) {
      return errorResponse(400, "VALIDATION_ERROR", error.message);
    }
    throw error;
  }
}
