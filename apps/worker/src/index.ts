import {
  changePasswordSchema,
  loginSchema,
  setupSchema,
  type BootstrapResponse,
  type SessionUser
} from "../../../packages/shared/src/schemas";
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
import { safeJson } from "./platform";
import { servePublicPage } from "./public-page";
import { handlePublicTrackingApi } from "./tracking";

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
  const userCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM users").first<number>("count");
  if ((userCount ?? 0) > 0) return errorResponse(409, "ALREADY_INSTALLED", "Administrador já criado.");

  let setupTokenId: string | null = null;
  if (parsed.data.token) {
    const tokenHash = await sha256(parsed.data.token);
    const tokenRow = await env.DB.prepare(
      `SELECT id FROM setup_tokens
       WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now') LIMIT 1`
    )
      .bind(tokenHash)
      .first<SetupTokenRow>();
    if (tokenRow) setupTokenId = tokenRow.id;
  }

  const password = await hashPassword(parsed.data.password);
  const userId = randomId();
  const installedJson = JSON.stringify({
    installed: true,
    version: "0.1.0",
    installedAt: new Date().toISOString()
  });

  const batchQueries = [
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
  ];

  if (setupTokenId) {
    batchQueries.push(
      env.DB.prepare("UPDATE setup_tokens SET used_at = datetime('now') WHERE id = ?").bind(setupTokenId)
    );
  }

  await env.DB.batch(batchQueries);
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

async function handleRegister(request: Request, env: Env): Promise<Response> {
  if (!requireSameOrigin(request)) return errorResponse(403, "ORIGIN_INVALID", "Origem inválida.");
  const body = safeJson<{ name?: string; email?: string; password?: string }>(await request.text(), {});
  const name = (body.name ?? "").trim();
  const email = (body.email ?? "").trim().toLowerCase();
  const passwordInput = body.password ?? "";

  if (name.length < 2 || !email || !email.includes("@") || passwordInput.length < 12) {
    return errorResponse(400, "VALIDATION_ERROR", "Preencha todos os campos corretamente (senha mínima de 12 caracteres).");
  }

  const existing = await findUserByEmail(env, email);
  if (existing) {
    return errorResponse(409, "EMAIL_IN_USE", "Este e-mail já está em uso.");
  }

  const id = randomId();
  const password = await hashPassword(passwordInput);

  await env.DB.prepare(
    `INSERT INTO users(id, name, email, password_hash, password_salt, password_iterations, role)
     VALUES (?, ?, ?, ?, ?, ?, 'editor')`
  ).bind(
    id,
    name,
    email,
    password.hash,
    password.salt,
    password.iterations
  ).run();

  await env.DB.prepare(
    "INSERT INTO audit_logs(id, user_id, action, entity_type, entity_id) VALUES (?, ?, 'user.register', 'user', ?)"
  ).bind(randomId(), id, id).run();

  return json({ ok: true, message: "Conta criada com sucesso! Faça login para continuar." });
}

async function handleSendAuthCode(request: Request, env: Env & { RESEND_API_KEY?: string }): Promise<Response> {
  if (!requireSameOrigin(request)) return errorResponse(403, "ORIGIN_INVALID", "Origem inválida.");
  const body = safeJson<{ email?: string }>(await request.text(), {});
  const email = (body.email ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return errorResponse(400, "VALIDATION_ERROR", "Informe um e-mail válido.");
  }

  // Verifica configuracao do provedor de e-mail (Resend)
  if (!env.RESEND_API_KEY) {
    return errorResponse(500, "EMAIL_NOT_CONFIGURED", "Provedor de e-mail não configurado. Adicione RESEND_API_KEY no painel da Cloudflare.");
  }

  const user = await findUserByEmail(env, email);
  if (!user || user.disabled_at) {
    return errorResponse(404, "USER_NOT_FOUND", "Nenhuma conta encontrada com este e-mail.");
  }
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const codeHash = await sha256(code);
  const id = randomId();
  await env.DB.prepare(
    `INSERT INTO email_auth_codes(id, email, code_hash, expires_at)
     VALUES (?, ?, ?, datetime('now', '+15 minutes'))`
  ).bind(id, email, codeHash).run();

  // Enviar e-mail usando a API do Resend
  const emailResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: "Autenticação <noreply@resend.dev>", // Pode ser sobrescrito se o usuario configurar um dominio verificado
      to: email,
      subject: "Seu código de acesso",
      html: `
        <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
          <h2>Código de Acesso</h2>
          <p>Você solicitou um código para entrar no painel.</p>
          <div style="background: #f4f4f5; padding: 20px; font-size: 24px; text-align: center; letter-spacing: 4px; font-weight: bold; border-radius: 8px; margin: 20px 0;">
            ${code}
          </div>
          <p>Se você não solicitou este código, por favor ignore este e-mail.</p>
        </div>
      `
    })
  });

  if (!emailResponse.ok) {
    return errorResponse(500, "EMAIL_SEND_FAILED", "Falha ao enviar e-mail. Verifique se a RESEND_API_KEY está correta.");
  }

  return json({
    ok: true,
    message: "Código enviado para seu e-mail com sucesso."
  });
}

async function handleVerifyAuthCodeLogin(request: Request, env: Env): Promise<Response> {
  if (!requireSameOrigin(request)) return errorResponse(403, "ORIGIN_INVALID", "Origem inválida.");
  const body = safeJson<{ email?: string; code?: string }>(await request.text(), {});
  const email = (body.email ?? "").trim().toLowerCase();
  const code = (body.code ?? "").trim();
  if (!email || !code || code.length !== 6) {
    return errorResponse(400, "VALIDATION_ERROR", "E-mail e código de 6 dígitos são obrigatórios.");
  }
  const user = await findUserByEmail(env, email);
  if (!user || user.disabled_at) {
    return errorResponse(401, "INVALID_CREDENTIALS", "Conta não encontrada.");
  }
  const codeHash = await sha256(code);
  const authCodeRow = await env.DB.prepare(
    `SELECT id FROM email_auth_codes
     WHERE email = ? AND code_hash = ? AND used_at IS NULL AND expires_at > datetime('now')
     ORDER BY created_at DESC LIMIT 1`
  ).bind(email, codeHash).first<{ id: string }>();

  if (!authCodeRow) {
    return errorResponse(401, "INVALID_CODE", "Código incorreto ou expirado. Solicite um novo código.");
  }

  await env.DB.batch([
    env.DB.prepare("UPDATE email_auth_codes SET used_at = datetime('now') WHERE id = ?").bind(authCodeRow.id),
    env.DB.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").bind(user.id),
    env.DB.prepare(
      "INSERT INTO audit_logs(id, user_id, action, entity_type, entity_id) VALUES (?, ?, 'auth.login_code', 'user', ?)"
    ).bind(randomId(), user.id, user.id)
  ]);

  const session = await createSession(request, env, user.id);
  return json(
    { user: { id: user.id, name: user.name, email: user.email, role: user.role } },
    { headers: { "Set-Cookie": session.cookie } }
  );
}

async function handleResetPasswordWithCode(request: Request, env: Env): Promise<Response> {
  if (!requireSameOrigin(request)) return errorResponse(403, "ORIGIN_INVALID", "Origem inválida.");
  const body = safeJson<{ email?: string; code?: string; newPassword?: string }>(await request.text(), {});
  const email = (body.email ?? "").trim().toLowerCase();
  const code = (body.code ?? "").trim();
  const newPassword = body.newPassword ?? "";
  if (!email || !code || code.length !== 6 || newPassword.length < 12) {
    return errorResponse(400, "VALIDATION_ERROR", "Preencha todos os campos corretamente (senha mínima de 12 caracteres).");
  }
  const user = await findUserByEmail(env, email);
  if (!user || user.disabled_at) {
    return errorResponse(404, "USER_NOT_FOUND", "Conta não encontrada.");
  }
  const codeHash = await sha256(code);
  const authCodeRow = await env.DB.prepare(
    `SELECT id FROM email_auth_codes
     WHERE email = ? AND code_hash = ? AND used_at IS NULL AND expires_at > datetime('now')
     ORDER BY created_at DESC LIMIT 1`
  ).bind(email, codeHash).first<{ id: string }>();

  if (!authCodeRow) {
    return errorResponse(401, "INVALID_CODE", "Código incorreto ou expirado. Solicite um novo código.");
  }

  const password = await hashPassword(newPassword);
  await env.DB.batch([
    env.DB.prepare("UPDATE email_auth_codes SET used_at = datetime('now') WHERE id = ?").bind(authCodeRow.id),
    env.DB.prepare(
      `UPDATE users
       SET password_hash = ?, password_salt = ?, password_iterations = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).bind(password.hash, password.salt, password.iterations, user.id),
    env.DB.prepare(
      "INSERT INTO audit_logs(id, user_id, action, entity_type, entity_id) VALUES (?, ?, 'auth.password_reset', 'user', ?)"
    ).bind(randomId(), user.id, user.id)
  ]);

  return json({ ok: true, message: "Senha redefinida com sucesso! Faça login com a nova senha." });
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

  if (request.method === "POST" && url.pathname === "/api/auth/register") {
    return handleRegister(request, env);
  }

  if (request.method === "POST" && url.pathname === "/api/auth/code/send") {
    return handleSendAuthCode(request, env);
  }

  if (request.method === "POST" && url.pathname === "/api/auth/code/login") {
    return handleVerifyAuthCodeLogin(request, env);
  }

  if (request.method === "POST" && url.pathname === "/api/auth/code/reset-password") {
    return handleResetPasswordWithCode(request, env);
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

  const user = await getCurrentUser(request, env, ctx);
  if (!user) return errorResponse(401, "UNAUTHORIZED", "Faça login para continuar.");

  if (request.method === "GET" && url.pathname === "/api/auth/me") return json({ user });
  if (request.method === "POST" && url.pathname === "/api/account/password") {
    return handleChangePassword(request, env, user);
  }

  if (request.method === "GET" && url.pathname === "/api/dashboard") {
    const period = Number(url.searchParams.get("days") ?? "7");
    return json({ metrics: await readDashboard(env, period) });
  }

  const catalogResponse = await handleCatalogApi(request, env, user, url);
  if (catalogResponse) return catalogResponse;
  const assetsResponse = await handleAssetsApi(request, env, user, url);
  if (assetsResponse) return assetsResponse;
  const operationsResponse = await handleOperationsApi(request, env, user, url);
  if (operationsResponse) return operationsResponse;
  const cloudflareResponse = await handleCloudflareApi(request, env, user, url);
  if (cloudflareResponse) return cloudflareResponse;
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
  if (
    url.pathname.startsWith("/home")
    || url.pathname.startsWith("/dashboard")
    || url.pathname.startsWith("/integrations")
    || url.pathname.startsWith("/account")
  ) {
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
