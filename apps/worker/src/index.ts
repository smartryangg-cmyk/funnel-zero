import { loginSchema, setupSchema, type BootstrapResponse } from "../../../packages/shared/src/schemas";
import {
  clearSessionCookie,
  createSession,
  findUserByEmail,
  getCurrentUser,
  isRateLimited,
  loginRateKey,
  recordLoginAttempt,
  revokeSession
} from "./auth";
import { hashPassword, randomId, sha256, verifyPassword } from "./crypto";
import { readDashboard } from "./dashboard";
import {
  errorResponse,
  json,
  readJson,
  RequestBodyError,
  requireSameOrigin,
  withSecurityHeaders
} from "./http";

interface InstalledSetting {
  value_json: string;
}

interface SetupTokenRow {
  id: string;
}

interface CountRow {
  count: number;
}

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
    `SELECT id FROM setup_tokens
     WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now') LIMIT 1`
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
    version: "0.1.0",
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
    env.DB.prepare("UPDATE setup_tokens SET used_at = datetime('now') WHERE id = ?").bind(
      setupToken.id
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
    { ok: true, redirect: "/dashboard" },
    { status: 201, headers: { "Set-Cookie": session.cookie } }
  );
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  if (!requireSameOrigin(request)) return errorResponse(403, "ORIGIN_INVALID", "Origem inválida.");
  const parsed = loginSchema.safeParse(await readJson(request));
  if (!parsed.success) return errorResponse(400, "VALIDATION_ERROR", "E-mail ou senha inválidos.");

  const identityHash = await loginRateKey(request, env, parsed.data.email);
  if (await isRateLimited(env, identityHash)) {
    return errorResponse(429, "RATE_LIMITED", "Muitas tentativas. Aguarde 15 minutos.");
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

  if (request.method === "POST" && url.pathname === "/api/auth/logout") {
    if (!requireSameOrigin(request)) return errorResponse(403, "ORIGIN_INVALID", "Origem inválida.");
    await revokeSession(request, env);
    return json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie() } });
  }

  const user = await getCurrentUser(request, env, ctx);
  if (!user) return errorResponse(401, "UNAUTHORIZED", "Faça login para continuar.");

  if (request.method === "GET" && url.pathname === "/api/auth/me") return json({ user });

  if (request.method === "GET" && url.pathname === "/api/dashboard") {
    const period = Number(url.searchParams.get("days") ?? "7");
    return json({ metrics: await readDashboard(env, period) });
  }

  return errorResponse(404, "NOT_FOUND", "Rota não encontrada.");
}

async function handlePage(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL
): Promise<Response> {
  if (url.pathname.startsWith("/dashboard")) {
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
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < datetime('now') OR revoked_at IS NOT NULL"),
    env.DB.prepare("DELETE FROM login_attempts WHERE created_at < datetime('now', '-1 day')"),
    env.DB.prepare("DELETE FROM setup_tokens WHERE expires_at < datetime('now') OR used_at IS NOT NULL"),
    env.DB.prepare("DELETE FROM tracking_events WHERE occurred_at < datetime('now', ?)").bind(
      `-${trackingDays} days`
    )
  ]);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith("/api/")) return await handleApi(request, env, ctx, url);
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
