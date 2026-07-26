import type { SessionUser } from "../../../packages/shared/src/schemas";
import { hmac, randomId, randomToken } from "./crypto";
import { errorResponse } from "./http";

const COOKIE_NAME = "__Host-funnel_zero_session";
const LAST_SEEN_WRITE_INTERVAL_MS = 5 * 60 * 1000;

interface UserRow extends SessionUser {
  disabled_at: string | null;
  last_seen_at: string;
}

interface PasswordUserRow extends UserRow {
  password_hash: string;
  password_salt: string;
  password_iterations: number;
}

export function getSessionCookie(request: Request): string | null {
  const cookieHeader = request.headers.get("Cookie") ?? "";
  for (const part of cookieHeader.split(";")) {
    const [name, ...valueParts] = part.trim().split("=");
    if (name === COOKIE_NAME) return valueParts.join("=") || null;
  }
  return null;
}

export async function getCurrentUser(
  request: Request,
  env: Env,
  ctx?: ExecutionContext
): Promise<SessionUser | null> {
  const rawToken = getSessionCookie(request);
  if (!rawToken) return null;
  const tokenHash = await hmac(rawToken, env.SESSION_SECRET);
  const user = await env.DB.prepare(
    `SELECT u.id, u.name, u.email, u.role, u.disabled_at, s.last_seen_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?
       AND s.revoked_at IS NULL
       AND s.expires_at > datetime('now')
       AND u.disabled_at IS NULL
     LIMIT 1`
  )
    .bind(tokenHash)
    .first<UserRow>();
  if (!user || user.disabled_at) return null;
  if (ctx && shouldRefreshLastSeen(user.last_seen_at)) {
    ctx.waitUntil(
      env.DB.prepare(
        `UPDATE sessions SET last_seen_at = datetime('now')
         WHERE token_hash = ? AND last_seen_at < datetime('now', '-5 minutes')`
      )
        .bind(tokenHash)
        .run()
        .then(() => undefined)
    );
  }
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

export async function findUserByEmail(env: Env, email: string): Promise<PasswordUserRow | null> {
  return env.DB.prepare(
    `SELECT id, name, email, role, disabled_at, password_hash, password_salt, password_iterations
     FROM users WHERE email = ? COLLATE NOCASE LIMIT 1`
  )
    .bind(email)
    .first<PasswordUserRow>();
}

export async function createSession(
  request: Request,
  env: Env,
  userId: string
): Promise<{ cookie: string }> {
  const rawToken = randomToken(32);
  const tokenHash = await hmac(rawToken, env.SESSION_SECRET);
  const userAgentHash = await hmac(request.headers.get("User-Agent") ?? "unknown", env.SESSION_SECRET);
  const days = Math.min(Math.max(Number(env.SESSION_DAYS) || 7, 1), 30);
  await env.DB.prepare(
    `INSERT INTO sessions(id, user_id, token_hash, expires_at, user_agent_hash)
     VALUES (?, ?, ?, datetime('now', ?), ?)`
  )
    .bind(randomId(), userId, tokenHash, `+${days} days`, userAgentHash)
    .run();
  return {
    cookie: `${COOKIE_NAME}=${rawToken}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${days * 86400}`
  };
}

export async function revokeSession(request: Request, env: Env): Promise<void> {
  const rawToken = getSessionCookie(request);
  if (!rawToken) return;
  const tokenHash = await hmac(rawToken, env.SESSION_SECRET);
  await env.DB.prepare("UPDATE sessions SET revoked_at = datetime('now') WHERE token_hash = ?")
    .bind(tokenHash)
    .run();
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export async function loginRateKey(request: Request, env: Env, email: string): Promise<string> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "local";
  return hmac(`${ip}|${email.toLowerCase()}`, env.SESSION_SECRET);
}

export async function isRateLimited(env: Env, identityHash: string): Promise<boolean> {
  const count = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM login_attempts
     WHERE identity_hash = ?
       AND succeeded = 0
       AND created_at > datetime('now', '-15 minutes')`
  )
    .bind(identityHash)
    .first<number>("count");
  return (count ?? 0) >= 5;
}

export async function recordLoginAttempt(
  env: Env,
  identityHash: string,
  succeeded: boolean
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO login_attempts(id, identity_hash, succeeded) VALUES (?, ?, ?)"
  )
    .bind(randomId(), identityHash, succeeded ? 1 : 0)
    .run();
}

export async function clearLoginFailures(env: Env, identityHash: string): Promise<void> {
  await env.DB.prepare(
    "DELETE FROM login_attempts WHERE identity_hash = ? AND succeeded = 0"
  )
    .bind(identityHash)
    .run();
}

export function hasAnyRole(
  user: SessionUser,
  allowed: readonly SessionUser["role"][]
): boolean {
  return allowed.includes(user.role);
}

export function requireRole(
  user: SessionUser,
  allowed: readonly SessionUser["role"][]
): Response | null {
  if (hasAnyRole(user, allowed)) return null;
  return errorResponse(
    403,
    "FORBIDDEN",
    "Sua função não possui permissão para concluir esta ação."
  );
}

function shouldRefreshLastSeen(value: string): boolean {
  const normalized = value.endsWith("Z") ? value : `${value.replace(" ", "T")}Z`;
  const timestamp = Date.parse(normalized);
  return !Number.isFinite(timestamp) || Date.now() - timestamp >= LAST_SEEN_WRITE_INTERVAL_MS;
}
