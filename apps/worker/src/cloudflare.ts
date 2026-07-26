import type { SessionUser } from "../../../packages/shared/src/schemas";
import { openSecret, randomToken, sealSecret, sha256, sha256Base64Url } from "./crypto";
import { errorResponse, json, readJson, requireSameOrigin } from "./http";
import {
  audit,
  parseBodyRecord,
  requiredString,
  safeJson,
  ValidationError
} from "./platform";

const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";
const CLOUDFLARE_AUTHORIZE = "https://dash.cloudflare.com/oauth2/auth";
const CLOUDFLARE_TOKEN = "https://dash.cloudflare.com/oauth2/token";
const CLOUDFLARE_REVOKE = "https://dash.cloudflare.com/oauth2/revoke";
const OAUTH_PERMISSION_VERSION = 2;
const OAUTH_SCOPES = [
  "account-settings.read",
  "zone.read",
  "zone.write",
  "workers-scripts.write",
  "offline_access"
] as const;
const GUIDED_TOKEN_PERMISSIONS = [
  { key: "account_settings", type: "read" },
  { key: "workers_scripts", type: "edit" },
  { key: "workers_routes", type: "edit" },
  { key: "zone", type: "edit" }
] as const;

interface SettingRow {
  value_json: string;
}

interface OAuthStateRow {
  user_id: string;
  code_verifier_ciphertext: string;
  return_to: string;
}

interface CloudflareResponse<T> {
  success: boolean;
  result: T;
  errors?: Array<{ code?: number; message?: string; documentation_url?: string }>;
}

interface OAuthTokenResponse {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface CloudflareAccount {
  id: string;
  name: string;
}

interface CloudflareScript {
  id?: string;
}

interface CloudflareTokenVerification {
  id?: string;
  status?: string;
}

export interface ProviderConfig {
  configured: boolean;
  connected: boolean;
  authMode: "none" | "oauth" | "legacy_token";
  accountId: string;
  accountName: string;
  workerName: string;
  scopes: string[];
  permissionVersion: number;
  expiresAt: string | null;
  connectedAt: string | null;
  lastCheckedAt: string | null;
}

function emptyProvider(env: Env): ProviderConfig {
  return {
    configured: false,
    connected: false,
    authMode: "none",
    accountId: "",
    accountName: "",
    workerName: env.WORKER_NAME,
    scopes: [],
    permissionVersion: 0,
    expiresAt: null,
    connectedAt: null,
    lastCheckedAt: null
  };
}

function normalizeProvider(value: string | null | undefined, env: Env): ProviderConfig {
  const legacy = safeJson<Partial<ProviderConfig>>(value, {});
  const configured = legacy.configured === true;
  const authMode =
    legacy.authMode === "oauth" || legacy.authMode === "legacy_token"
      ? legacy.authMode
      : configured && Boolean(env.CLOUDFLARE_API_TOKEN)
        ? "legacy_token"
        : "none";
  return {
    ...emptyProvider(env),
    ...legacy,
    configured,
    connected: legacy.connected === true || (configured && authMode === "legacy_token"),
    authMode,
    accountId: typeof legacy.accountId === "string" ? legacy.accountId : "",
    accountName: typeof legacy.accountName === "string" ? legacy.accountName : "",
    workerName:
      typeof legacy.workerName === "string" && legacy.workerName ? legacy.workerName : env.WORKER_NAME,
    scopes: Array.isArray(legacy.scopes)
      ? legacy.scopes.filter((scope): scope is string => typeof scope === "string")
      : [],
    permissionVersion:
      typeof legacy.permissionVersion === "number" &&
      Number.isInteger(legacy.permissionVersion) &&
      legacy.permissionVersion >= 0
        ? legacy.permissionVersion
        : 0,
    expiresAt: typeof legacy.expiresAt === "string" ? legacy.expiresAt : null,
    connectedAt: typeof legacy.connectedAt === "string" ? legacy.connectedAt : null,
    lastCheckedAt: typeof legacy.lastCheckedAt === "string" ? legacy.lastCheckedAt : null
  };
}

export async function providerConfig(env: Env): Promise<ProviderConfig> {
  const row = await env.DB.prepare(
    "SELECT value_json FROM installation_settings WHERE key = 'domain_provider'"
  ).first<SettingRow>();
  return normalizeProvider(row?.value_json, env);
}

async function writeProvider(env: Env, config: ProviderConfig): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO installation_settings(key, value_json, updated_at)
     VALUES ('domain_provider', ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET
       value_json = excluded.value_json,
       updated_at = datetime('now')`
  )
    .bind(JSON.stringify(config))
    .run();
}

export async function providerStatus(env: Env) {
  const provider = await providerConfig(env);
  const tokenAvailable =
    provider.authMode === "oauth"
      ? Boolean(env.CLOUDFLARE_OAUTH_ACCESS_TOKEN)
      : Boolean(env.CLOUDFLARE_API_TOKEN);
  return {
    configured: provider.configured,
    connected: provider.connected,
    ready: provider.connected && tokenAvailable,
    authMode: provider.authMode,
    accountName: provider.accountName,
    workerName: provider.workerName,
    scopes: provider.scopes,
    zoneImportReady:
      provider.authMode === "legacy_token" ||
      provider.permissionVersion >= OAUTH_PERMISSION_VERSION,
    expiresAt: provider.expiresAt,
    connectedAt: provider.connectedAt,
    lastCheckedAt: provider.lastCheckedAt,
    oauthAvailable: Boolean(env.CLOUDFLARE_OAUTH_CLIENT_ID),
    guidedTokenAvailable: Boolean(env.CLOUDFLARE_ACCOUNT_ID),
    tokenTemplateUrl: guidedTokenTemplateUrl(env.CLOUDFLARE_ACCOUNT_ID),
    tokenAvailable
  };
}

export function guidedTokenTemplateUrl(accountId: string | undefined): string | null {
  if (!accountId || !/^[a-f0-9]{32}$/i.test(accountId)) return null;
  const url = new URL("https://dash.cloudflare.com/profile/api-tokens");
  url.searchParams.set("permissionGroupKeys", JSON.stringify(GUIDED_TOKEN_PERMISSIONS));
  url.searchParams.set("accountId", accountId);
  url.searchParams.set("zoneId", "all");
  url.searchParams.set("name", "KRANO - domínios e publicação");
  return url.toString();
}

export class CloudflareApiError extends ValidationError {
  constructor(
    message: string,
    public readonly status: number,
    public readonly apiCode?: number
  ) {
    super(message);
    this.name = "CloudflareApiError";
  }
}

async function cloudflareWithToken<T>(
  token: string,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${CLOUDFLARE_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers
    }
  });
  const payload = await response.json<CloudflareResponse<T>>().catch(() => null);
  if (!payload) {
    throw new CloudflareApiError(
      "A Cloudflare devolveu uma resposta inválida. Tente novamente.",
      response.status
    );
  }
  if (!response.ok || !payload.success) {
    const firstError = payload.errors?.[0];
    throw new CloudflareApiError(
      firstError?.message ?? "A Cloudflare recusou a operação.",
      response.status,
      firstError?.code
    );
  }
  return payload.result;
}

async function verifyWorkerAccess(
  token: string,
  accountId: string,
  workerName: string
): Promise<{ accountName: string }> {
  const verification = await cloudflareWithToken<CloudflareTokenVerification>(
    token,
    "/user/tokens/verify"
  );
  if (verification.status !== "active") {
    throw new ValidationError("O token informado não está ativo.");
  }
  const account = await cloudflareWithToken<CloudflareAccount>(
    token,
    `/accounts/${encodeURIComponent(accountId)}`
  );
  const scripts = await cloudflareWithToken<CloudflareScript[]>(
    token,
    `/accounts/${encodeURIComponent(accountId)}/workers/scripts?per_page=100`
  );
  if (!scripts.some((script) => script.id === workerName)) {
    throw new ValidationError(
      "O token não pertence à conta onde esta instalação da KRANO está publicada."
    );
  }
  await cloudflareWithToken<CloudflareZoneProbe[]>(
    token,
    `/zones?account.id=${encodeURIComponent(accountId)}&per_page=1`
  );
  return { accountName: account.name };
}

interface CloudflareZoneProbe {
  id: string;
}

async function tokenRequest(body: URLSearchParams): Promise<OAuthTokenResponse> {
  const response = await fetch(CLOUDFLARE_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const payload = await response.json<OAuthTokenResponse>();
  if (!response.ok || !payload.access_token) {
    throw new ValidationError(
      payload.error_description ?? payload.error ?? "Não foi possível concluir a autorização."
    );
  }
  return payload;
}

async function persistConnectionSecrets(
  accessToken: string,
  refreshToken: string,
  accountId: string,
  workerName: string
): Promise<void> {
  await cloudflareWithToken<Record<string, unknown>>(
    accessToken,
    `/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(workerName)}/secrets-bulk`,
    {
      method: "PATCH",
      body: JSON.stringify({
        secrets: {
          CLOUDFLARE_OAUTH_ACCESS_TOKEN: {
            name: "CLOUDFLARE_OAUTH_ACCESS_TOKEN",
            text: accessToken,
            type: "secret_text"
          },
          CLOUDFLARE_OAUTH_REFRESH_TOKEN: {
            name: "CLOUDFLARE_OAUTH_REFRESH_TOKEN",
            text: refreshToken,
            type: "secret_text"
          }
        }
      })
    }
  );
}

async function connectGuidedToken(
  request: Request,
  env: Env,
  user: SessionUser
): Promise<Response> {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  if (!accountId || !/^[a-f0-9]{32}$/i.test(accountId)) {
    return errorResponse(
      503,
      "INSTALLATION_ACCOUNT_MISSING",
      "Esta instalação precisa ser atualizada pelo instalador para habilitar a conexão guiada."
    );
  }
  const body = parseBodyRecord(await readJson(request, 8_192));
  const apiToken = requiredString(body.apiToken, "Token da Cloudflare", 512);
  if (!/^cf[a-z0-9_-]{20,}$/i.test(apiToken)) {
    throw new ValidationError("Cole o token completo gerado na tela oficial da Cloudflare.");
  }

  const workerName = env.WORKER_NAME;
  const verified = await verifyWorkerAccess(apiToken, accountId, workerName);
  await cloudflareWithToken<Record<string, unknown>>(
    apiToken,
    `/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(workerName)}/secrets-bulk`,
    {
      method: "PATCH",
      body: JSON.stringify({
        secrets: {
          CLOUDFLARE_API_TOKEN: {
            name: "CLOUDFLARE_API_TOKEN",
            text: apiToken,
            type: "secret_text"
          }
        }
      })
    }
  );

  const now = new Date().toISOString();
  const provider: ProviderConfig = {
    configured: true,
    connected: true,
    authMode: "legacy_token",
    accountId,
    accountName: verified.accountName,
    workerName,
    scopes: [
      "account-settings.read",
      "workers-scripts.write",
      "workers-routes.write",
      "zone.write"
    ],
    permissionVersion: OAUTH_PERMISSION_VERSION,
    expiresAt: null,
    connectedAt: now,
    lastCheckedAt: now
  };
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO installation_settings(key, value_json, updated_at)
       VALUES ('domain_provider', ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = datetime('now')`
    ).bind(JSON.stringify(provider)),
    audit(env, user.id, "cloudflare.connected", "settings", "domain_provider", {
      accountName: provider.accountName,
      workerName,
      authMode: "guided_token"
    })
  ]);
  return json({
    ok: true,
    provider: {
      connected: true,
      accountName: provider.accountName,
      workerName
    }
  });
}

async function refreshAccessToken(env: Env, provider: ProviderConfig): Promise<string> {
  if (
    !env.CLOUDFLARE_OAUTH_CLIENT_ID ||
    !env.CLOUDFLARE_OAUTH_REFRESH_TOKEN ||
    !provider.accountId ||
    !provider.workerName
  ) {
    throw new ValidationError("Reconecte sua conta Cloudflare para continuar.");
  }
  const token = await tokenRequest(
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: env.CLOUDFLARE_OAUTH_CLIENT_ID,
      refresh_token: env.CLOUDFLARE_OAUTH_REFRESH_TOKEN
    })
  );
  const accessToken = token.access_token as string;
  const refreshToken = token.refresh_token ?? env.CLOUDFLARE_OAUTH_REFRESH_TOKEN;
  await persistConnectionSecrets(
    accessToken,
    refreshToken,
    provider.accountId,
    provider.workerName
  );
  await writeProvider(env, {
    ...provider,
    scopes: parseScopes(token.scope, provider.scopes),
    expiresAt: tokenExpiry(token.expires_in),
    lastCheckedAt: new Date().toISOString()
  });
  return accessToken;
}

async function connectionAccessToken(env: Env, provider: ProviderConfig): Promise<string> {
  if (provider.authMode === "legacy_token" && env.CLOUDFLARE_API_TOKEN) {
    return env.CLOUDFLARE_API_TOKEN;
  }
  if (provider.authMode !== "oauth" || !provider.connected) {
    throw new ValidationError("Conecte sua conta Cloudflare para continuar.");
  }
  if (!env.CLOUDFLARE_OAUTH_ACCESS_TOKEN) {
    throw new ValidationError(
      "A Cloudflare ainda está finalizando a conexão. Aguarde alguns segundos e tente novamente."
    );
  }
  if (
    provider.expiresAt &&
    Date.parse(provider.expiresAt) - Date.now() <= 120_000
  ) {
    return refreshAccessToken(env, provider);
  }
  return env.CLOUDFLARE_OAUTH_ACCESS_TOKEN;
}

export async function cfRequest<T>(
  env: Env,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const provider = await providerConfig(env);
  return cloudflareWithToken<T>(await connectionAccessToken(env, provider), path, init);
}

function parseScopes(value: string | undefined, fallback: string[] = []): string[] {
  if (!value) return fallback;
  return value.split(/\s+/).filter(Boolean);
}

function tokenExpiry(expiresIn: number | undefined): string {
  const seconds =
    typeof expiresIn === "number" && Number.isFinite(expiresIn)
      ? Math.max(60, expiresIn)
      : 3600;
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function oauthRedirectUri(request: Request): string {
  return new URL("/api/cloudflare/oauth/callback", request.url).toString();
}

async function startOAuth(request: Request, env: Env, user: SessionUser): Promise<Response> {
  if (!env.CLOUDFLARE_OAUTH_CLIENT_ID) {
    return errorResponse(
      503,
      "OAUTH_NOT_CONFIGURED",
      "A conexão guiada da Cloudflare ainda não foi ativada nesta instalação."
    );
  }
  const state = randomToken(32);
  const codeVerifier = randomToken(48);
  const stateHash = await sha256(state);
  const encryptedVerifier = await sealSecret(codeVerifier, env.SESSION_SECRET);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO cloudflare_oauth_states(
        state_hash, user_id, code_verifier_ciphertext, return_to, expires_at
       ) VALUES (?, ?, ?, '/domains', datetime('now', '+10 minutes'))`
    ).bind(stateHash, user.id, encryptedVerifier),
    env.DB.prepare(
      "DELETE FROM cloudflare_oauth_states WHERE expires_at < datetime('now') OR used_at IS NOT NULL"
    )
  ]);
  const authorizeUrl = new URL(CLOUDFLARE_AUTHORIZE);
  authorizeUrl.searchParams.set("client_id", env.CLOUDFLARE_OAUTH_CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", oauthRedirectUri(request));
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", OAUTH_SCOPES.join(" "));
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", await sha256Base64Url(codeVerifier));
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  return json({ authorizeUrl: authorizeUrl.toString() });
}

async function accountForWorker(
  accessToken: string,
  accounts: CloudflareAccount[],
  workerName: string,
  previousAccountId: string
): Promise<CloudflareAccount> {
  const previous = accounts.find((account) => account.id === previousAccountId);
  if (previous) return previous;
  if (accounts.length === 1) return accounts[0];
  const matches: CloudflareAccount[] = [];
  for (const account of accounts.slice(0, 10)) {
    try {
      const scripts = await cloudflareWithToken<CloudflareScript[]>(
        accessToken,
        `/accounts/${encodeURIComponent(account.id)}/workers/scripts`
      );
      if (scripts.some((script) => script.id === workerName)) matches.push(account);
    } catch {
      // A conta pode ter sido selecionada sem permissão para listar Workers.
    }
  }
  if (matches.length === 1) return matches[0];
  throw new ValidationError(
    "Selecione na Cloudflare somente a conta onde a KRANO está instalada."
  );
}

function oauthRedirect(
  request: Request,
  status: "connected" | "error",
  message?: string
): Response {
  const target = new URL("/domains", request.url);
  target.searchParams.set("cloudflare", status);
  if (message) target.searchParams.set("message", message.slice(0, 180));
  return Response.redirect(target.toString(), 302);
}

async function completeOAuth(
  request: Request,
  env: Env,
  url: URL
): Promise<Response> {
  try {
    if (!env.CLOUDFLARE_OAUTH_CLIENT_ID) {
      throw new ValidationError("A conexão guiada não está configurada.");
    }
    const state = url.searchParams.get("state") ?? "";
    const code = url.searchParams.get("code") ?? "";
    const oauthError = url.searchParams.get("error_description") ?? url.searchParams.get("error");
    if (oauthError) throw new ValidationError(oauthError);
    if (!state || !code) throw new ValidationError("A Cloudflare não devolveu uma autorização válida.");

    const stateHash = await sha256(state);
    const oauthState = await env.DB.prepare(
      `SELECT user_id, code_verifier_ciphertext, return_to
       FROM cloudflare_oauth_states
       WHERE state_hash = ? AND used_at IS NULL
         AND expires_at > datetime('now') LIMIT 1`
    )
      .bind(stateHash)
      .first<OAuthStateRow>();
    if (!oauthState) throw new ValidationError("A autorização expirou. Tente conectar novamente.");

    const codeVerifier = await openSecret(
      oauthState.code_verifier_ciphertext,
      env.SESSION_SECRET
    );
    const token = await tokenRequest(
      new URLSearchParams({
        grant_type: "authorization_code",
        client_id: env.CLOUDFLARE_OAUTH_CLIENT_ID,
        code,
        redirect_uri: oauthRedirectUri(request),
        code_verifier: codeVerifier
      })
    );
    if (!token.refresh_token) {
      throw new ValidationError("A Cloudflare não liberou acesso contínuo. Autorize novamente.");
    }

    const accessToken = token.access_token as string;
    const accounts = await cloudflareWithToken<CloudflareAccount[]>(
      accessToken,
      "/accounts?per_page=50"
    );
    if (!accounts.length) {
      throw new ValidationError("Nenhuma conta Cloudflare autorizada foi encontrada.");
    }
    const previous = await providerConfig(env);
    const account = await accountForWorker(
      accessToken,
      accounts,
      env.WORKER_NAME,
      previous.accountId
    );
    await persistConnectionSecrets(
      accessToken,
      token.refresh_token,
      account.id,
      env.WORKER_NAME
    );

    const now = new Date().toISOString();
    const provider: ProviderConfig = {
      configured: true,
      connected: true,
      authMode: "oauth",
      accountId: account.id,
      accountName: account.name,
      workerName: env.WORKER_NAME,
      scopes: parseScopes(token.scope, [...OAUTH_SCOPES]),
      permissionVersion: OAUTH_PERMISSION_VERSION,
      expiresAt: tokenExpiry(token.expires_in),
      connectedAt: now,
      lastCheckedAt: now
    };
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO installation_settings(key, value_json, updated_at)
         VALUES ('domain_provider', ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET
           value_json = excluded.value_json,
           updated_at = datetime('now')`
      ).bind(JSON.stringify(provider)),
      env.DB.prepare(
        "UPDATE cloudflare_oauth_states SET used_at = datetime('now') WHERE state_hash = ?"
      ).bind(stateHash),
      audit(env, oauthState.user_id, "cloudflare.connected", "settings", "domain_provider", {
        accountName: account.name,
        workerName: env.WORKER_NAME,
        scopes: provider.scopes,
        permissionVersion: provider.permissionVersion
      })
    ]);
    return oauthRedirect(request, "connected");
  } catch (error) {
    const message =
      error instanceof ValidationError
        ? error.message
        : "Não foi possível concluir a conexão com a Cloudflare.";
    return oauthRedirect(request, "error", message);
  }
}

async function revokeToken(clientId: string, token: string): Promise<void> {
  await fetch(CLOUDFLARE_REVOKE, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, token })
  });
}

async function disconnectCloudflare(
  env: Env,
  user: SessionUser
): Promise<Response> {
  const provider = await providerConfig(env);
  const accessToken = env.CLOUDFLARE_OAUTH_ACCESS_TOKEN;
  const refreshToken = env.CLOUDFLARE_OAUTH_REFRESH_TOKEN;
  const legacyToken = env.CLOUDFLARE_API_TOKEN;
  let warning: string | null = null;
  if (
    provider.authMode === "oauth" &&
    accessToken &&
    provider.accountId &&
    provider.workerName
  ) {
    try {
      await cloudflareWithToken<Record<string, unknown>>(
        accessToken,
        `/accounts/${encodeURIComponent(provider.accountId)}/workers/scripts/${encodeURIComponent(provider.workerName)}/secrets-bulk`,
        {
          method: "PATCH",
          body: JSON.stringify({
            secrets: {
              CLOUDFLARE_OAUTH_ACCESS_TOKEN: null,
              CLOUDFLARE_OAUTH_REFRESH_TOKEN: null
            }
          })
        }
      );
    } catch {
      warning = "O acesso foi revogado, mas a limpeza dos secrets precisa ser revisada.";
    }
  }
  if (
    provider.authMode === "legacy_token" &&
    legacyToken &&
    provider.accountId &&
    provider.workerName
  ) {
    try {
      await cloudflareWithToken<Record<string, unknown>>(
        legacyToken,
        `/accounts/${encodeURIComponent(provider.accountId)}/workers/scripts/${encodeURIComponent(provider.workerName)}/secrets-bulk`,
        {
          method: "PATCH",
          body: JSON.stringify({ secrets: { CLOUDFLARE_API_TOKEN: null } })
        }
      );
    } catch {
      warning = "A conexão foi removida, mas revise o token no painel da Cloudflare.";
    }
  }
  if (env.CLOUDFLARE_OAUTH_CLIENT_ID) {
    if (refreshToken) await revokeToken(env.CLOUDFLARE_OAUTH_CLIENT_ID, refreshToken);
    if (accessToken) await revokeToken(env.CLOUDFLARE_OAUTH_CLIENT_ID, accessToken);
  }
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO installation_settings(key, value_json, updated_at)
       VALUES ('domain_provider', ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = datetime('now')`
    ).bind(JSON.stringify(emptyProvider(env))),
    audit(env, user.id, "cloudflare.disconnected", "settings", "domain_provider", {
      cleanupWarning: warning
    })
  ]);
  return json({ ok: true, warning });
}

export async function handleCloudflareOAuthCallback(
  request: Request,
  env: Env,
  url: URL
): Promise<Response | null> {
  if (
    url.pathname !== "/api/cloudflare/oauth/callback" ||
    request.method !== "GET"
  ) {
    return null;
  }
  return completeOAuth(request, env, url);
}

export async function handleCloudflareApi(
  request: Request,
  env: Env,
  user: SessionUser,
  url: URL
): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/cloudflare/")) return null;
  if (["POST", "PATCH", "DELETE"].includes(request.method) && !requireSameOrigin(request)) {
    return errorResponse(403, "ORIGIN_INVALID", "Origem inválida.");
  }
  if (url.pathname === "/api/cloudflare/oauth/start" && request.method === "POST") {
    return startOAuth(request, env, user);
  }
  if (url.pathname === "/api/cloudflare/token/connect" && request.method === "POST") {
    try {
      return await connectGuidedToken(request, env, user);
    } catch (error) {
      if (error instanceof CloudflareApiError) {
        return errorResponse(
          error.status === 401 || error.status === 403 ? 403 : 400,
          "CLOUDFLARE_TOKEN_REJECTED",
          `A Cloudflare recusou a autorização: ${error.message}`
        );
      }
      if (error instanceof ValidationError) {
        return errorResponse(400, "VALIDATION_ERROR", error.message);
      }
      throw error;
    }
  }
  if (url.pathname === "/api/cloudflare/disconnect" && request.method === "POST") {
    return disconnectCloudflare(env, user);
  }
  return errorResponse(404, "NOT_FOUND", "Rota Cloudflare não encontrada.");
}
