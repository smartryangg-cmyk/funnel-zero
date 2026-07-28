import {
  changePasswordSchema,
  loginSchema,
  setupSchema,
  type BootstrapResponse,
  type SessionUser
} from "../../../packages/shared/src/schemas";
import {
  clearLoginFailures,
  clearSessionCookie,
  createSession,
  findUserByEmail,
  getCurrentUser,
  isRateLimited,
  loginRateKey,
  recordLoginAttempt,
  requireRole,
  revokeSession
} from "./auth";
import { hashPassword, randomId, sha256, verifyPassword } from "./crypto";
import { readDashboard } from "./dashboard";
import { handleAssetsApi, serveMedia } from "./assets";
import { handleCatalogApi } from "./catalog";
import { handleCloudflareApi, handleCloudflareOAuthCallback } from "./cloudflare";
import { handleDomainsApi, resolveCustomDomainUrl } from "./domains";
import {
  errorResponse,
  json,
  readJson,
  RequestBodyError,
  requireSameOrigin,
  withSecurityHeaders
} from "./http";
import { handleOperationsApi, handleWebhook } from "./operations";
import { servePublicPage } from "./public-page";
import { handlePublicTrackingApi } from "./tracking";
import { handleMetaAdsApi, handleMetaAdsOAuthCallback } from "./meta-ads";

interface InstalledSetting {
  value_json: string;
}

interface SetupTokenRow {
  id: string;
}

interface RecoveryTokenRow {
  user_id: string;
}

interface CountRow {
  count: number;
}

const APP_VERSION = "0.4.4";
const PRIVATE_PAGE_PREFIXES = [
  "/home",
  "/dashboard",
  "/integrations",
  "/account",
  "/hosting",
  "/kratube",
  "/player",
  "/studio",
  "/offers",
  "/funnels",
  "/pages",
  "/media-library",
  "/tracking",
  "/meta-ads",
  "/domains",
  "/subdomains",
  "/studies",
  "/settings"
] as const;

const EDIT_ROLES = ["owner", "admin", "editor"] as const;
const ADMIN_ROLES = ["owner", "admin"] as const;
const OWNER_ROLES = ["owner"] as const;

async function isInstalled(env: Env): Promise<boolean> {
  const setting = await env.DB.prepare(
    "SELECT value_json FROM installation_settings WHERE key = 'installation' LIMIT 1"
  ).first<InstalledSetting>();
  if (!setting) return false;
  try {
    const parsed = JSON.parse(setting.value_json) as { installed?: unknown };
    return parsed.installed === true;
  } catch {
    return false;
  }
}

async function handleSetupComplete(request: Request, env: Env): Promise<Response> {
  if (!requireSameOrigin(request)) return errorResponse(403, "ORIGIN_INVALID", "Origem inválida.");
  if (await isInstalled(env)) {
    return errorResponse(409, "ALREADY_INSTALLED", "Esta instalação já possui administrador.");
  }
  const parsed = setupSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return errorResponse(400, "VALIDATION_ERROR", "Revise os dados informados.", parsed.error.flatten());
  }
  const tokenHash = await sha256(parsed.data.token);
  const setupToken = await env.DB.prepare(
    `UPDATE setup_tokens
     SET used_at = datetime('now')
     WHERE id = (
       SELECT id FROM setup_tokens
       WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')
       LIMIT 1
     )
     RETURNING id`
  )
    .bind(tokenHash)
    .first<SetupTokenRow>();
  if (!setupToken) return errorResponse(403, "SETUP_TOKEN_INVALID", "Link de configuração inválido ou expirado.");

  const userCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM users").first<number>("count");
  if ((userCount ?? 0) > 0) return errorResponse(409, "ALREADY_INSTALLED", "Administrador já criado.");

  const password = await hashPassword(parsed.data.password);
  const userId = randomId();
  const installedJson = JSON.stringify({
    installed: true,
    version: APP_VERSION,
    installedAt: new Date().toISOString()
  });
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users(id, name, email, password_hash, password_salt, password_iterations, role)
       VALUES (?, ?, ?, ?, ?, ?, 'owner')`
    ).bind(
      userId,
      parsed.data.name,
      parsed.data.email,
      password.hash,
      password.salt,
      password.iterations
    ),
    env.DB.prepare(
      "UPDATE installation_settings SET value_json = ?, updated_at = datetime('now') WHERE key = 'installation'"
    ).bind(installedJson),
    env.DB.prepare(
      "INSERT INTO audit_logs(id, user_id, action, entity_type, entity_id) VALUES (?, ?, 'installation.completed', 'user', ?)"
    ).bind(randomId(), userId, userId)
  ]);
  const session = await createSession(request, env, userId);
  return json(
    { ok: true, redirect: "/home" },
    { status: 201, headers: { "Set-Cookie": session.cookie } }
  );
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  if (!requireSameOrigin(request)) return errorResponse(403, "ORIGIN_INVALID", "Origem inválida.");
  const parsed = loginSchema.safeParse(await readJson(request));
  if (!parsed.success) return errorResponse(400, "VALIDATION_ERROR", "E-mail ou senha inválidos.");

  const identityHash = await loginRateKey(request, env, parsed.data.email);
  if (await isRateLimited(env, identityHash)) {
    return errorResponse(
      429,
      "RATE_LIMITED",
      "Muitas tentativas. Aguarde 15 minutos.",
      undefined,
      { "Retry-After": "900" }
    );
  }
  const user = await findUserByEmail(env, parsed.data.email);
  const fallbackSalt = "AAAAAAAAAAAAAAAAAAAAAA";
  const valid = user
    ? await verifyPassword(
        parsed.data.password,
        user.password_salt,
        user.password_iterations,
        user.password_hash
      )
    : await verifyPassword(parsed.data.password, fallbackSalt, 100_000, "00".repeat(32));
  const allowed = Boolean(user && !user.disabled_at && valid);
  await recordLoginAttempt(env, identityHash, allowed);
  if (!allowed || !user) {
    return errorResponse(401, "INVALID_CREDENTIALS", "E-mail ou senha incorretos.");
  }

  await clearLoginFailures(env, identityHash);
  const session = await createSession(request, env, user.id);
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").bind(user.id),
    env.DB.prepare(
      "INSERT INTO audit_logs(id, user_id, action, entity_type, entity_id) VALUES (?, ?, 'auth.login', 'user', ?)"
    ).bind(randomId(), user.id, user.id)
  ]);
  return json(
    { user: { id: user.id, name: user.name, email: user.email, role: user.role } },
    { headers: { "Set-Cookie": session.cookie } }
  );
}

async function handleChangePassword(
  request: Request,
  env: Env,
  user: SessionUser
): Promise<Response> {
  if (!requireSameOrigin(request)) {
    return errorResponse(403, "ORIGIN_INVALID", "Origem inválida.");
  }
  const parsed = changePasswordSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return errorResponse(400, "VALIDATION_ERROR", "A nova senha não atende aos requisitos.", parsed.error.flatten());
  }
  if (parsed.data.currentPassword === parsed.data.newPassword) {
    return errorResponse(400, "PASSWORD_UNCHANGED", "Escolha uma senha diferente da atual.");
  }

  const passwordUser = await findUserByEmail(env, user.email);
  const currentPasswordValid = passwordUser
    ? await verifyPassword(
        parsed.data.currentPassword,
        passwordUser.password_salt,
        passwordUser.password_iterations,
        passwordUser.password_hash
      )
    : false;
  if (!passwordUser || !currentPasswordValid) {
    return errorResponse(401, "CURRENT_PASSWORD_INVALID", "A senha atual está incorreta.");
  }

  const password = await hashPassword(parsed.data.newPassword);
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE users
       SET password_hash = ?, password_salt = ?, password_iterations = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).bind(password.hash, password.salt, password.iterations, user.id),
    env.DB.prepare(
      "UPDATE sessions SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL"
    ).bind(user.id),
    env.DB.prepare(
      "INSERT INTO audit_logs(id, user_id, action, entity_type, entity_id) VALUES (?, ?, 'auth.password_changed', 'user', ?)"
    ).bind(randomId(), user.id, user.id)
  ]);

  return json(
    { ok: true, requiresLogin: true },
    { headers: { "Set-Cookie": clearSessionCookie() } }
  );
}

async function handleRecoveryComplete(request: Request, env: Env): Promise<Response> {
  if (!requireSameOrigin(request)) {
    return errorResponse(403, "ORIGIN_INVALID", "Origem inválida.");
  }
  const body = await readJson(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return errorResponse(400, "VALIDATION_ERROR", "Revise o link e a nova senha.");
  }
  const input = body as Record<string, unknown>;
  const token = typeof input.token === "string" ? input.token : "";
  const password = setupSchema.shape.password.safeParse(input.password);
  if (token.length < 32 || token.length > 256 || !password.success) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      "Revise o link e os requisitos da nova senha.",
      password.success ? undefined : password.error.flatten()
    );
  }

  const tokenHash = await sha256(token);
  const claimed = await env.DB.prepare(
    `UPDATE password_recovery_tokens
     SET used_at = datetime('now')
     WHERE id = (
       SELECT id FROM password_recovery_tokens
       WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')
       LIMIT 1
     )
     RETURNING user_id`
  )
    .bind(tokenHash)
    .first<RecoveryTokenRow>();
  if (!claimed) {
    return errorResponse(
      403,
      "RECOVERY_TOKEN_INVALID",
      "Este link de recuperação é inválido, expirou ou já foi usado."
    );
  }

  const nextPassword = await hashPassword(password.data);
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE users
       SET password_hash = ?, password_salt = ?, password_iterations = ?,
           updated_at = datetime('now')
       WHERE id = ? AND disabled_at IS NULL`
    ).bind(
      nextPassword.hash,
      nextPassword.salt,
      nextPassword.iterations,
      claimed.user_id
    ),
    env.DB.prepare(
      "UPDATE sessions SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL"
    ).bind(claimed.user_id),
    env.DB.prepare(
      `UPDATE password_recovery_tokens SET used_at = datetime('now')
       WHERE user_id = ? AND used_at IS NULL`
    ).bind(claimed.user_id),
    env.DB.prepare(
      "INSERT INTO audit_logs(id, user_id, action, entity_type, entity_id) VALUES (?, ?, 'auth.password_recovered', 'user', ?)"
    ).bind(randomId(), claimed.user_id, claimed.user_id)
  ]);
  return json(
    { ok: true, requiresLogin: true },
    { headers: { "Set-Cookie": clearSessionCookie() } }
  );
}

async function handleChangeEmail(
  request: Request,
  env: Env,
  user: SessionUser
): Promise<Response> {
  if (!requireSameOrigin(request)) {
    return errorResponse(403, "ORIGIN_INVALID", "Origem inválida.");
  }
  const body = await readJson(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return errorResponse(400, "VALIDATION_ERROR", "Revise o e-mail e a senha atual.");
  }
  const input = body as Record<string, unknown>;
  const currentPassword =
    typeof input.currentPassword === "string" ? input.currentPassword : "";
  const email = loginSchema.shape.email.safeParse(input.email);
  if (!currentPassword || currentPassword.length > 128 || !email.success) {
    return errorResponse(400, "VALIDATION_ERROR", "Revise o e-mail e a senha atual.");
  }
  if (email.data === user.email.toLowerCase()) {
    return errorResponse(400, "EMAIL_UNCHANGED", "Informe um e-mail diferente do atual.");
  }

  const passwordUser = await findUserByEmail(env, user.email);
  const valid = passwordUser
    ? await verifyPassword(
        currentPassword,
        passwordUser.password_salt,
        passwordUser.password_iterations,
        passwordUser.password_hash
      )
    : false;
  if (!passwordUser || !valid) {
    return errorResponse(401, "CURRENT_PASSWORD_INVALID", "A senha atual está incorreta.");
  }
  const existing = await findUserByEmail(env, email.data);
  if (existing && existing.id !== user.id) {
    return errorResponse(409, "EMAIL_ALREADY_USED", "Este e-mail já pertence a outra conta.");
  }

  await env.DB.batch([
    env.DB.prepare(
      "UPDATE users SET email = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(email.data, user.id),
    env.DB.prepare(
      "UPDATE sessions SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL"
    ).bind(user.id),
    env.DB.prepare(
      "INSERT INTO audit_logs(id, user_id, action, entity_type, entity_id) VALUES (?, ?, 'auth.email_changed', 'user', ?)"
    ).bind(randomId(), user.id, user.id)
  ]);
  return json(
    { ok: true, requiresLogin: true },
    { headers: { "Set-Cookie": clearSessionCookie() } }
  );
}

function authorizeApiRequest(
  request: Request,
  user: SessionUser,
  url: URL
): Response | null {
  if (request.method === "GET" || request.method === "HEAD") return null;
  if (url.pathname.startsWith("/api/cloudflare/") || url.pathname.startsWith("/api/domains")) {
    return requireRole(user, ADMIN_ROLES);
  }
  if (url.pathname.startsWith("/api/integrations")) {
    return requireRole(user, ADMIN_ROLES);
  }
  if (url.pathname.startsWith("/api/meta-ads")) {
    return requireRole(user, ADMIN_ROLES);
  }
  if (
    url.pathname.startsWith("/api/offers")
    || url.pathname.startsWith("/api/funnels")
    || url.pathname.startsWith("/api/pages")
    || url.pathname.startsWith("/api/assets")
    || url.pathname.startsWith("/api/experiments")
  ) {
    return requireRole(user, EDIT_ROLES);
  }
  return requireRole(user, ADMIN_ROLES);
}

export function isPrivatePagePath(pathname: string): boolean {
  return PRIVATE_PAGE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

async function handleApi(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL
): Promise<Response> {
  if (request.method === "GET" && url.pathname === "/api/health") {
    const db = await env.DB.prepare("SELECT 1 AS count").first<CountRow>();
    return json({
      ok: db?.count === 1,
      name: env.APP_NAME,
      environment: env.ENVIRONMENT,
      freeOnly: env.FREE_ONLY === "true"
    });
  }

  if (request.method === "GET" && url.pathname === "/api/bootstrap") {
    const [installed, user] = await Promise.all([
      isInstalled(env),
      getCurrentUser(request, env, ctx)
    ]);
    const response: BootstrapResponse = {
      installed,
      user,
      environment: env.ENVIRONMENT,
      freeOnly: env.FREE_ONLY === "true"
    };
    return json(response);
  }

  if (request.method === "POST" && url.pathname === "/api/setup/complete") {
    return handleSetupComplete(request, env);
  }

  if (request.method === "POST" && url.pathname === "/api/auth/login") {
    return handleLogin(request, env);
  }

  if (request.method === "POST" && url.pathname === "/api/auth/recovery/complete") {
    return handleRecoveryComplete(request, env);
  }

  if (request.method === "POST" && url.pathname === "/api/auth/logout") {
    if (!requireSameOrigin(request)) return errorResponse(403, "ORIGIN_INVALID", "Origem inválida.");
    await revokeSession(request, env);
    return json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie() } });
  }

  const webhookResponse = await handleWebhook(request, env, url);
  if (webhookResponse) return webhookResponse;
  const publicTracking = await handlePublicTrackingApi(request, env, ctx, url);
  if (publicTracking) return publicTracking;
  const cloudflareOAuthCallback = await handleCloudflareOAuthCallback(request, env, url);
  if (cloudflareOAuthCallback) return cloudflareOAuthCallback;
  const metaAdsOAuthCallback = await handleMetaAdsOAuthCallback(request, env, url);
  if (metaAdsOAuthCallback) return metaAdsOAuthCallback;

  const user = await getCurrentUser(request, env, ctx);
  if (!user) return errorResponse(401, "UNAUTHORIZED", "Faça login para continuar.");

  if (request.method === "GET" && url.pathname === "/api/auth/me") return json({ user });
  if (request.method === "POST" && url.pathname === "/api/account/password") {
    return handleChangePassword(request, env, user);
  }
  if (request.method === "POST" && url.pathname === "/api/account/email") {
    const forbidden = requireRole(user, OWNER_ROLES);
    return forbidden ?? handleChangeEmail(request, env, user);
  }

  if (request.method === "GET" && url.pathname === "/api/dashboard") {
    const period = Number(url.searchParams.get("days") ?? "7");
    return json({
      metrics: await readDashboard(env, period, url.searchParams.get("offerId"))
    });
  }

  const forbidden = authorizeApiRequest(request, user, url);
  if (forbidden) return forbidden;

  const catalogResponse = await handleCatalogApi(request, env, user, url);
  if (catalogResponse) return catalogResponse;
  const assetsResponse = await handleAssetsApi(request, env, user, url);
  if (assetsResponse) return assetsResponse;
  const operationsResponse = await handleOperationsApi(request, env, user, url);
  if (operationsResponse) return operationsResponse;
  const cloudflareResponse = await handleCloudflareApi(request, env, user, url);
  if (cloudflareResponse) return cloudflareResponse;
  const metaAdsResponse = await handleMetaAdsApi(request, env, user, url);
  if (metaAdsResponse) return metaAdsResponse;
  const domainsResponse = await handleDomainsApi(request, env, user, url);
  if (domainsResponse) return domainsResponse;

  return errorResponse(404, "NOT_FOUND", "Rota não encontrada.");
}

async function handlePage(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL
): Promise<Response> {
  if (isPrivatePagePath(url.pathname)) {
    const user = await getCurrentUser(request, env, ctx);
    if (!user) return Response.redirect(`${url.origin}/login`, 302);
  }
  if (url.pathname.startsWith("/setup") && (await isInstalled(env))) {
    return Response.redirect(`${url.origin}/login`, 302);
  }
  return withSecurityHeaders(await env.ASSETS.fetch(request));
}

async function scheduled(env: Env): Promise<void> {
  const retention = await env.DB.prepare(
    "SELECT value_json FROM installation_settings WHERE key = 'retention'"
  ).first<InstalledSetting>();
  let trackingDays = 90;
  if (retention) {
    try {
      const parsed = JSON.parse(retention.value_json) as { trackingDays?: unknown };
      if (typeof parsed.trackingDays === "number") trackingDays = Math.max(7, parsed.trackingDays);
    } catch {
      trackingDays = 90;
    }
  }
  const abandoned = await env.DB.prepare(
    `SELECT id, object_key, multipart_upload_id FROM assets
     WHERE upload_status = 'uploading' AND multipart_upload_id IS NOT NULL
       AND updated_at < datetime('now', '-1 day') LIMIT 100`
  ).all<{ id: string; object_key: string; multipart_upload_id: string }>();
  for (const asset of abandoned.results) {
    try {
      await env.MEDIA.resumeMultipartUpload(asset.object_key, asset.multipart_upload_id).abort();
    } catch {
      // O R2 também remove uploads multipart abandonados pela regra de ciclo de vida.
    }
  }
  const statements = [
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < datetime('now') OR revoked_at IS NOT NULL"),
    env.DB.prepare("DELETE FROM login_attempts WHERE created_at < datetime('now', '-1 day')"),
    env.DB.prepare("DELETE FROM setup_tokens WHERE expires_at < datetime('now') OR used_at IS NOT NULL"),
    env.DB.prepare(
      "DELETE FROM password_recovery_tokens WHERE expires_at < datetime('now') OR used_at IS NOT NULL"
    ),
    env.DB.prepare(
      "DELETE FROM cloudflare_oauth_states WHERE expires_at < datetime('now') OR used_at IS NOT NULL"
    ),
    env.DB.prepare("DELETE FROM tracking_events WHERE occurred_at < datetime('now', ?)").bind(
      `-${trackingDays} days`
    ),
    env.DB.prepare(
      `UPDATE assets SET upload_status = 'failed', multipart_upload_id = NULL,
       updated_at = datetime('now')
       WHERE upload_status = 'uploading' AND updated_at < datetime('now', '-1 day')`
    ),
    env.DB.prepare(
      "DELETE FROM asset_upload_parts WHERE asset_id IN (SELECT id FROM assets WHERE upload_status = 'failed')"
    )
  ];
  await env.DB.batch(statements);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith("/api/")) return await handleApi(request, env, ctx, url);
      if (url.pathname.startsWith("/media/")) return await serveMedia(request, env, url);
      if (url.pathname === "/o" || url.pathname.startsWith("/o/")) {
        return await servePublicPage(request, env, url);
      }
      const customDomain = await resolveCustomDomainUrl(env, url);
      if (customDomain.publicUrl) {
        return await servePublicPage(request, env, customDomain.publicUrl);
      }
      if (customDomain.matched) {
        return new Response(
          "<!doctype html><html lang=\"pt-BR\"><meta charset=\"utf-8\"><title>Página não encontrada</title><body><main><h1>Página não encontrada</h1><p>Revise a publicação deste domínio na KRANO.</p></main></body></html>",
          { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } }
        );
      }
      return await handlePage(request, env, ctx, url);
    } catch (error) {
      if (error instanceof RequestBodyError) {
        return errorResponse(400, "INVALID_BODY", error.message);
      }
      console.error(
        JSON.stringify({
          message: "request_failed",
          method: request.method,
          path: url.pathname,
          error: error instanceof Error ? error.message : "unknown"
        })
      );
      return errorResponse(500, "INTERNAL_ERROR", "Não foi possível concluir a solicitação.");
    }
  },
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    ctx.waitUntil(scheduled(env));
  }
} satisfies ExportedHandler<Env>;
