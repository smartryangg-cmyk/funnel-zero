import type { SessionUser } from "../../../packages/shared/src/schemas";
import { openSecret, randomToken, sealSecret, sha256 } from "./crypto";
import { errorResponse, json, readJson, requireSameOrigin } from "./http";

interface OAuthStateRow {
  user_id: string;
  redirect_uri: string;
}

interface ConnectionRow {
  meta_user_id: string;
  meta_user_name: string;
  access_token_sealed: string;
  expires_at: string | null;
  connected_at: string;
}

interface MetaTokenResponse {
  access_token?: string;
  expires_in?: number;
}

interface MetaProfile {
  id?: string;
  name?: string;
}

interface MetaList<T> {
  data?: T[];
  error?: { message?: string; code?: number };
}

interface MetaAdAccount {
  id: string;
  account_id?: string;
  name?: string;
  account_status?: number;
  currency?: string;
  timezone_name?: string;
}

interface MetaCampaign {
  id: string;
  account_id?: string;
  name?: string;
  status?: string;
  effective_status?: string;
  objective?: string;
}

interface MetaInsight {
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  actions?: Array<{ action_type: string; value: string }>;
}

const SCOPES = ["public_profile", "ads_read", "ads_management", "business_management"];

function graphVersion(env: Env): string {
  return /^v\d+\.\d+$/.test(env.META_GRAPH_VERSION) ? env.META_GRAPH_VERSION : "v25.0";
}

function oauthReady(env: Env): boolean {
  return Boolean(env.META_APP_ID && env.META_APP_SECRET);
}

function callbackUri(request: Request): string {
  return `${new URL(request.url).origin}/api/meta-ads/oauth/callback`;
}

async function graphJson<T>(url: URL): Promise<T> {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const body = await response.json().catch(() => ({})) as T & {
    error?: { message?: string };
  };
  if (!response.ok || body.error) {
    throw new Error(body.error?.message || "A Meta recusou a solicitação.");
  }
  return body;
}

async function graphForm<T>(url: URL, values: Record<string, string>): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams(values)
  });
  const body = await response.json().catch(() => ({})) as T & {
    error?: { message?: string };
  };
  if (!response.ok || body.error) {
    throw new Error(body.error?.message || "A Meta recusou a alteração.");
  }
  return body;
}

async function connection(env: Env, userId: string): Promise<ConnectionRow | null> {
  return env.DB.prepare(
    `SELECT meta_user_id, meta_user_name, access_token_sealed, expires_at, connected_at
     FROM meta_ad_connections WHERE user_id = ? LIMIT 1`
  ).bind(userId).first<ConnectionRow>();
}

async function accessToken(env: Env, userId: string): Promise<{ row: ConnectionRow; token: string } | null> {
  const row = await connection(env, userId);
  if (!row) return null;
  return { row, token: await openSecret(row.access_token_sealed, env.SESSION_SECRET) };
}

export async function handleMetaAdsOAuthCallback(
  request: Request,
  env: Env,
  url: URL
): Promise<Response | null> {
  if (request.method !== "GET" || url.pathname !== "/api/meta-ads/oauth/callback") return null;
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  if (!state || !code || !oauthReady(env)) {
    return Response.redirect(`${url.origin}/meta-ads?connection=failed`, 302);
  }

  const stateHash = await sha256(state);
  const oauthState = await env.DB.prepare(
    `DELETE FROM meta_oauth_states
     WHERE state_hash = ? AND expires_at > datetime('now')
     RETURNING user_id, redirect_uri`
  ).bind(stateHash).first<OAuthStateRow>();
  if (!oauthState || oauthState.redirect_uri !== callbackUri(request)) {
    return Response.redirect(`${url.origin}/meta-ads?connection=expired`, 302);
  }

  try {
    const tokenUrl = new URL(`https://graph.facebook.com/${graphVersion(env)}/oauth/access_token`);
    tokenUrl.searchParams.set("client_id", env.META_APP_ID!);
    tokenUrl.searchParams.set("client_secret", env.META_APP_SECRET!);
    tokenUrl.searchParams.set("redirect_uri", oauthState.redirect_uri);
    tokenUrl.searchParams.set("code", code);
    const shortToken = await graphJson<MetaTokenResponse>(tokenUrl);
    if (!shortToken.access_token) throw new Error("Token da Meta ausente.");

    let resolvedToken = shortToken;
    try {
      const longLivedUrl = new URL(`https://graph.facebook.com/${graphVersion(env)}/oauth/access_token`);
      longLivedUrl.searchParams.set("grant_type", "fb_exchange_token");
      longLivedUrl.searchParams.set("client_id", env.META_APP_ID!);
      longLivedUrl.searchParams.set("client_secret", env.META_APP_SECRET!);
      longLivedUrl.searchParams.set("fb_exchange_token", shortToken.access_token);
      resolvedToken = await graphJson<MetaTokenResponse>(longLivedUrl);
    } catch {
      resolvedToken = shortToken;
    }

    const token = resolvedToken.access_token ?? shortToken.access_token;
    const profileUrl = new URL(`https://graph.facebook.com/${graphVersion(env)}/me`);
    profileUrl.searchParams.set("fields", "id,name");
    profileUrl.searchParams.set("access_token", token);
    const profile = await graphJson<MetaProfile>(profileUrl);
    if (!profile.id || !profile.name) throw new Error("Perfil da Meta inválido.");

    const sealed = await sealSecret(token, env.SESSION_SECRET);
    const expiresAt = resolvedToken.expires_in
      ? new Date(Date.now() + resolvedToken.expires_in * 1000).toISOString()
      : null;
    await env.DB.prepare(
      `INSERT INTO meta_ad_connections(
         user_id, meta_user_id, meta_user_name, access_token_sealed, expires_at
       ) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         meta_user_id = excluded.meta_user_id,
         meta_user_name = excluded.meta_user_name,
         access_token_sealed = excluded.access_token_sealed,
         expires_at = excluded.expires_at,
         connected_at = datetime('now'),
         updated_at = datetime('now')`
    ).bind(oauthState.user_id, profile.id, profile.name, sealed, expiresAt).run();
    return Response.redirect(`${url.origin}/meta-ads?connection=success`, 302);
  } catch (error) {
    console.error(JSON.stringify({
      message: "meta_oauth_failed",
      error: error instanceof Error ? error.message : "unknown"
    }));
    return Response.redirect(`${url.origin}/meta-ads?connection=failed`, 302);
  }
}

export async function handleMetaAdsApi(
  request: Request,
  env: Env,
  user: SessionUser,
  url: URL
): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/meta-ads")) return null;

  if (request.method === "GET" && url.pathname === "/api/meta-ads/status") {
    const row = await connection(env, user.id);
    return json({
      configured: oauthReady(env),
      connected: Boolean(row),
      profile: row ? { id: row.meta_user_id, name: row.meta_user_name } : null,
      expiresAt: row?.expires_at ?? null,
      connectedAt: row?.connected_at ?? null,
      redirectUri: callbackUri(request),
      requiredPermissions: SCOPES.filter((scope) => scope !== "public_profile")
    });
  }

  if (request.method === "POST" && url.pathname === "/api/meta-ads/oauth/start") {
    if (!requireSameOrigin(request)) return errorResponse(403, "ORIGIN_INVALID", "Origem inválida.");
    if (!oauthReady(env)) {
      return errorResponse(
        409,
        "META_APP_NOT_CONFIGURED",
        "Configure META_APP_ID e META_APP_SECRET no Worker antes de conectar."
      );
    }
    const state = randomToken(32);
    const redirectUri = callbackUri(request);
    await env.DB.prepare(
      `INSERT INTO meta_oauth_states(state_hash, user_id, redirect_uri, expires_at)
       VALUES (?, ?, ?, datetime('now', '+10 minutes'))`
    ).bind(await sha256(state), user.id, redirectUri).run();
    const authorizeUrl = new URL(`https://www.facebook.com/${graphVersion(env)}/dialog/oauth`);
    authorizeUrl.searchParams.set("client_id", env.META_APP_ID!);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("scope", SCOPES.join(","));
    authorizeUrl.searchParams.set("response_type", "code");
    return json({ authorizeUrl: authorizeUrl.toString() });
  }

  if (request.method === "POST" && url.pathname === "/api/meta-ads/disconnect") {
    if (!requireSameOrigin(request)) return errorResponse(403, "ORIGIN_INVALID", "Origem inválida.");
    await env.DB.prepare("DELETE FROM meta_ad_connections WHERE user_id = ?").bind(user.id).run();
    return json({ ok: true });
  }

  const auth = await accessToken(env, user.id);
  if (!auth) return errorResponse(409, "META_NOT_CONNECTED", "Conecte seu perfil da Meta para continuar.");

  if (request.method === "GET" && url.pathname === "/api/meta-ads/accounts") {
    const accountsUrl = new URL(`https://graph.facebook.com/${graphVersion(env)}/me/adaccounts`);
    accountsUrl.searchParams.set(
      "fields",
      "id,account_id,name,account_status,currency,timezone_name"
    );
    accountsUrl.searchParams.set("limit", "100");
    accountsUrl.searchParams.set("access_token", auth.token);
    const result = await graphJson<MetaList<MetaAdAccount>>(accountsUrl);
    return json({ accounts: result.data ?? [] });
  }

  const accountId = url.searchParams.get("accountId") ?? "";
  if (!/^act_\d+$/.test(accountId)) {
    return errorResponse(400, "META_ACCOUNT_INVALID", "Selecione uma conta de anúncios válida.");
  }

  if (request.method === "GET" && url.pathname === "/api/meta-ads/campaigns") {
    const campaignsUrl = new URL(
      `https://graph.facebook.com/${graphVersion(env)}/${accountId}/campaigns`
    );
    campaignsUrl.searchParams.set("fields", "id,name,status,effective_status,objective");
    campaignsUrl.searchParams.set("limit", "100");
    campaignsUrl.searchParams.set("access_token", auth.token);
    const result = await graphJson<MetaList<MetaCampaign>>(campaignsUrl);
    return json({ campaigns: result.data ?? [] });
  }

  const campaignStatusMatch = url.pathname.match(
    /^\/api\/meta-ads\/campaigns\/(\d+)\/status$/
  );
  if (request.method === "PATCH" && campaignStatusMatch) {
    if (!requireSameOrigin(request)) {
      return errorResponse(403, "ORIGIN_INVALID", "Origem inválida.");
    }
    const input = await readJson(request) as {
      status?: unknown;
      confirmation?: unknown;
    };
    const campaignId = campaignStatusMatch[1];
    const status = input.status === "ACTIVE" || input.status === "PAUSED"
      ? input.status
      : null;
    if (!campaignId || !status || input.confirmation !== campaignId) {
      return errorResponse(
        400,
        "META_CAMPAIGN_CONFIRMATION_REQUIRED",
        "Confirme a campanha e o novo estado antes de alterar."
      );
    }

    const campaignUrl = new URL(
      `https://graph.facebook.com/${graphVersion(env)}/${campaignId}`
    );
    campaignUrl.searchParams.set("fields", "id,account_id");
    campaignUrl.searchParams.set("access_token", auth.token);
    const campaign = await graphJson<MetaCampaign>(campaignUrl);
    if (campaign.account_id !== accountId.replace("act_", "")) {
      return errorResponse(
        403,
        "META_CAMPAIGN_ACCOUNT_MISMATCH",
        "Esta campanha não pertence à conta de anúncios selecionada."
      );
    }

    const updateUrl = new URL(
      `https://graph.facebook.com/${graphVersion(env)}/${campaignId}`
    );
    const result = await graphForm<{ success?: boolean }>(updateUrl, {
      status,
      access_token: auth.token
    });
    if (!result.success) {
      return errorResponse(502, "META_CAMPAIGN_UPDATE_FAILED", "A Meta não confirmou a alteração.");
    }
    await env.DB.prepare(
      `INSERT INTO audit_logs(id, user_id, action, entity_type, entity_id, metadata_json)
       VALUES (?, ?, 'meta.campaign_status_changed', 'meta_campaign', ?, ?)`
    ).bind(
      crypto.randomUUID(),
      user.id,
      campaignId,
      JSON.stringify({ accountId, status })
    ).run();
    return json({ ok: true, campaignId, status });
  }

  if (request.method === "GET" && url.pathname === "/api/meta-ads/insights") {
    const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days") ?? "7")));
    const insightsUrl = new URL(
      `https://graph.facebook.com/${graphVersion(env)}/${accountId}/insights`
    );
    insightsUrl.searchParams.set("fields", "spend,impressions,reach,clicks,ctr,cpc,cpm,actions");
    insightsUrl.searchParams.set("date_preset", days <= 7 ? "last_7d" : days <= 30 ? "last_30d" : "last_90d");
    insightsUrl.searchParams.set("level", "account");
    insightsUrl.searchParams.set("access_token", auth.token);
    const result = await graphJson<MetaList<MetaInsight>>(insightsUrl);
    return json({ insight: result.data?.[0] ?? null, periodDays: days });
  }

  return null;
}
