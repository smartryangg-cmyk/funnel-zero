import { hmac, randomId } from "./crypto";
import { errorResponse, json, readJson } from "./http";
import { forwardMetaEvents, type MetaForwardEvent } from "./meta";
import { optionalString, parseBodyRecord, ValidationError } from "./platform";

const EVENT_TYPES = new Set([
  "page_view",
  "vsl_start",
  "vsl_pause",
  "vsl_25",
  "vsl_50",
  "vsl_75",
  "vsl_progress",
  "vsl_pitch",
  "vsl_complete",
  "checkout_click",
  "lead_submit",
  "quiz_start",
  "quiz_answer",
  "quiz_complete",
  "purchase"
]);

const TRACKING_CONTEXT_VERSION = 1;
const TRACKING_CONTEXT_TTL_SECONDS = 6 * 60 * 60;
const MAX_TRACKING_CONTEXT_BYTES = 4_096;

export interface PublicTrackingContext {
  v: 1;
  iat: number;
  exp: number;
  host: string;
  path: string;
  anonymousId: string;
  offerId: string | null;
  funnelId: string | null;
  pageId: string;
  variantId: string | null;
}

export type PublicTrackingContextInput = Omit<
  PublicTrackingContext,
  "v" | "iat" | "exp"
>;

interface PublicEvent {
  id: string;
  occurredAt: string;
  type: string;
  anonymousId: string;
  sessionKey: string | null;
  offerId: string | null;
  funnelId: string | null;
  pageId: string;
  variantId: string | null;
  source: string | null;
  campaign: string | null;
  utm: Record<string, unknown>;
  properties: Record<string, unknown>;
  dedupeKey: string;
  eventSourceUrl: string;
  clientIp: string;
  userAgent: string;
}

class PublicContextError extends Error {}

class PublicRateLimitError extends Error {
  constructor(
    message: string,
    readonly retryAfter: number
  ) {
    super(message);
  }
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function decodeBase64Url(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new PublicContextError("Contexto inválido.");
  const base64 = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return new TextDecoder().decode(
    Uint8Array.from(binary, (character) => character.charCodeAt(0))
  );
}

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function validId(value: unknown, nullable = false): value is string | null {
  if (nullable && value === null) return true;
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value);
}

function parseTrackingContext(value: unknown): PublicTrackingContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PublicContextError("Contexto inválido.");
  }
  const context = value as Record<string, unknown>;
  if (
    context.v !== TRACKING_CONTEXT_VERSION ||
    !Number.isSafeInteger(context.iat) ||
    !Number.isSafeInteger(context.exp) ||
    typeof context.host !== "string" ||
    !context.host ||
    context.host.length > 255 ||
    typeof context.path !== "string" ||
    !context.path.startsWith("/") ||
    context.path.length > 2_048 ||
    !validId(context.anonymousId) ||
    !validId(context.offerId) ||
    !validId(context.funnelId, true) ||
    !validId(context.pageId) ||
    !validId(context.variantId, true)
  ) {
    throw new PublicContextError("Contexto inválido.");
  }
  return context as unknown as PublicTrackingContext;
}

export async function signPublicTrackingContext(
  secret: string,
  input: PublicTrackingContextInput,
  now = Date.now()
): Promise<string> {
  const issuedAt = Math.floor(now / 1_000);
  const context = parseTrackingContext({
    ...input,
    v: TRACKING_CONTEXT_VERSION,
    iat: issuedAt,
    exp: issuedAt + TRACKING_CONTEXT_TTL_SECONDS
  });
  const payload = encodeBase64Url(JSON.stringify(context));
  return `${payload}.${await hmac(payload, secret)}`;
}

export async function verifyPublicTrackingContext(
  secret: string,
  token: string,
  expectedHost: string,
  now = Date.now()
): Promise<PublicTrackingContext> {
  if (!token || token.length > MAX_TRACKING_CONTEXT_BYTES) {
    throw new PublicContextError("Contexto inválido.");
  }
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !/^[0-9a-f]{64}$/i.test(parts[1] ?? "")) {
    throw new PublicContextError("Contexto inválido.");
  }
  const [payload, providedSignature] = parts as [string, string];
  const expectedSignature = await hmac(payload, secret);
  if (!constantTimeEqual(providedSignature.toLowerCase(), expectedSignature)) {
    throw new PublicContextError("Contexto inválido.");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(decodeBase64Url(payload)) as unknown;
  } catch (error) {
    if (error instanceof PublicContextError) throw error;
    throw new PublicContextError("Contexto inválido.");
  }
  const context = parseTrackingContext(decoded);
  const current = Math.floor(now / 1_000);
  if (
    context.host.toLowerCase() !== expectedHost.toLowerCase() ||
    context.iat > current + 60 ||
    context.exp <= current ||
    context.exp - context.iat > TRACKING_CONTEXT_TTL_SECONDS
  ) {
    throw new PublicContextError("Contexto expirado ou incompatível com este endereço.");
  }
  return context;
}

function sanitizeProperties(value: unknown, maximumEntries: number): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, maximumEntries)
      .filter(([, item]) => ["string", "number", "boolean"].includes(typeof item))
      .map(([key, item]) => [
        key.slice(0, 60),
        typeof item === "string" ? item.slice(0, 500) : item
      ])
  );
}

function validateRequestOrigin(request: Request): void {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (!origin) return;
  try {
    if (new URL(origin).origin !== requestUrl.origin) {
      throw new PublicContextError("Origem inválida.");
    }
  } catch (error) {
    if (error instanceof PublicContextError) throw error;
    throw new PublicContextError("Origem inválida.");
  }
}

function parseEvent(
  value: unknown,
  request: Request,
  context: PublicTrackingContext
): PublicEvent {
  const event = parseBodyRecord(value);
  const type = optionalString(event.type, 40) ?? "";
  if (!EVENT_TYPES.has(type) || type === "purchase") {
    throw new ValidationError("Tipo de evento inválido.");
  }
  const occurredAtRaw = optionalString(event.occurredAt, 40);
  const occurredDate = occurredAtRaw ? new Date(occurredAtRaw) : new Date();
  if (Number.isNaN(occurredDate.getTime())) throw new ValidationError("Data inválida.");
  const now = Date.now();
  if (Math.abs(now - occurredDate.getTime()) > 24 * 60 * 60 * 1_000) {
    throw new ValidationError("Evento fora da janela aceita.");
  }
  const requestedId = optionalString(event.id, 100);
  const id =
    requestedId && /^[A-Za-z0-9_-]{8,100}$/.test(requestedId)
      ? requestedId
      : randomId();
  const requestUrl = new URL(request.url);
  return {
    id,
    occurredAt: occurredDate.toISOString(),
    type,
    anonymousId: context.anonymousId,
    sessionKey: optionalString(event.sessionKey, 100),
    offerId: context.offerId,
    funnelId: context.funnelId,
    pageId: context.pageId,
    variantId: context.variantId,
    source: optionalString(event.source, 120),
    campaign: optionalString(event.campaign, 120),
    utm: sanitizeProperties(event.utm, 10),
    properties: sanitizeProperties(event.properties, 20),
    dedupeKey: `${context.anonymousId}:${id}`.slice(0, 220),
    eventSourceUrl: new URL(context.path, requestUrl.origin).toString(),
    clientIp: request.headers.get("CF-Connecting-IP") ?? "0.0.0.0",
    userAgent: request.headers.get("User-Agent") ?? "unknown"
  };
}

async function recordEvents(env: Env, events: PublicEvent[]): Promise<PublicEvent[]> {
  if (!events.length) return [];
  const results = await env.DB.batch(
    events.map((event) =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO tracking_events(
          id, occurred_at, event_type, anonymous_id, session_key, offer_id, funnel_id,
          page_id, variant_id, source, campaign, utm_json, properties_json, dedupe_key
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        event.id,
        event.occurredAt,
        event.type,
        event.anonymousId,
        event.sessionKey,
        event.offerId,
        event.funnelId,
        event.pageId,
        event.variantId,
        event.source,
        event.campaign,
        JSON.stringify(event.utm),
        JSON.stringify(event.properties),
        event.dedupeKey
      )
    )
  );
  return events.filter((_, index) => Number(results[index]?.meta.changes ?? 0) > 0);
}

async function enforcePublicRateLimit(
  request: Request,
  env: Env,
  context: PublicTrackingContext,
  scope: "events" | "leads",
  cost: number
): Promise<void> {
  const windowSeconds = scope === "events" ? 60 : 300;
  const limit = scope === "events" ? 180 : 6;
  const current = Math.floor(Date.now() / 1_000);
  const windowStart = current - current % windowSeconds;
  const clientIp = request.headers.get("CF-Connecting-IP") ?? "0.0.0.0";
  const identityHash = await hmac(
    `${clientIp}|${context.host}|${context.pageId}`,
    env.SESSION_SECRET
  );
  const row = await env.DB.prepare(
    `INSERT INTO public_rate_limits(scope, identity_hash, window_start, request_count)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(scope, identity_hash, window_start) DO UPDATE SET
       request_count = request_count + excluded.request_count,
       updated_at = datetime('now')
     RETURNING request_count`
  ).bind(scope, identityHash, windowStart, cost).first<{ request_count: number }>();
  await env.DB.prepare(
    `DELETE FROM public_rate_limits
     WHERE scope = ? AND identity_hash = ? AND window_start < ?`
  ).bind(scope, identityHash, windowStart - windowSeconds).run();
  if (!row || Number(row.request_count) > limit) {
    throw new PublicRateLimitError(
      "Muitas solicitações. Aguarde um instante e tente novamente.",
      Math.max(1, windowStart + windowSeconds - current)
    );
  }
}

function tokenFromBody(body: Record<string, unknown>): string {
  if (
    typeof body.contextToken !== "string" ||
    !body.contextToken ||
    body.contextToken.length > MAX_TRACKING_CONTEXT_BYTES
  ) {
    throw new PublicContextError("Contexto de rastreamento ausente.");
  }
  return body.contextToken;
}

async function contextFromBody(
  request: Request,
  env: Env,
  body: Record<string, unknown>
): Promise<PublicTrackingContext> {
  validateRequestOrigin(request);
  return verifyPublicTrackingContext(
    env.SESSION_SECRET,
    tokenFromBody(body),
    new URL(request.url).host
  );
}

async function handleEvents(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const body = parseBodyRecord(await readJson(request, 256_000));
  const context = await contextFromBody(request, env, body);
  const rawEvents = Array.isArray(body.events) ? body.events : [body];
  if (!rawEvents.length || rawEvents.length > 30) {
    throw new ValidationError("Envie entre 1 e 30 eventos por lote.");
  }
  const events = rawEvents.map((item) => parseEvent(item, request, context));
  await enforcePublicRateLimit(request, env, context, "events", events.length);
  ctx.waitUntil((async () => {
    const insertedEvents = await recordEvents(env, events);
    if (!insertedEvents.length) return;
    const metaEvents: MetaForwardEvent[] = insertedEvents.map((event) => ({
      id: event.id,
      type: event.type,
      occurredAt: event.occurredAt,
      anonymousId: event.anonymousId,
      offerId: event.offerId,
      eventSourceUrl: event.eventSourceUrl,
      clientIp: event.clientIp,
      userAgent: event.userAgent,
      properties: event.properties
    }));
    await forwardMetaEvents(env, metaEvents);
  })());
  return json({ accepted: events.length }, { status: 202 });
}

async function handleLead(request: Request, env: Env): Promise<Response> {
  const body = parseBodyRecord(await readJson(request, 32_000));
  const context = await contextFromBody(request, env, body);
  const name = optionalString(body.name, 120);
  const email = optionalString(body.email, 254);
  const whatsapp = optionalString(body.whatsapp, 30);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ValidationError("Informe um e-mail válido.");
  }
  if (whatsapp && !/^\+?[\d ()-]{8,30}$/.test(whatsapp)) {
    throw new ValidationError("Informe um WhatsApp válido.");
  }
  if (!name && !email && !whatsapp) {
    throw new ValidationError("Informe pelo menos um dado de contato.");
  }
  const customFields = sanitizeProperties(body.customFields, 20);
  await enforcePublicRateLimit(request, env, context, "leads", 1);
  const emailHash = email ? await hmac(email.toLowerCase(), env.SESSION_SECRET) : null;
  const leadId = randomId();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO leads(
        id, anonymous_id, offer_id, funnel_id, page_id, name, email, whatsapp,
        custom_fields_json, consent
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      leadId,
      context.anonymousId,
      context.offerId,
      context.funnelId,
      context.pageId,
      name,
      email,
      whatsapp,
      JSON.stringify(customFields),
      body.consent === true ? 1 : 0
    ),
    env.DB.prepare(
      `INSERT INTO tracking_events(
        id, occurred_at, event_type, anonymous_id, offer_id, funnel_id, page_id,
        variant_id, properties_json, dedupe_key
       ) VALUES (?, ?, 'lead_submit', ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      randomId(),
      new Date().toISOString(),
      context.anonymousId,
      context.offerId,
      context.funnelId,
      context.pageId,
      context.variantId,
      JSON.stringify({ emailHash, hasWhatsapp: Boolean(whatsapp) }),
      `lead:${leadId}`
    )
  ]);
  return json({ ok: true }, { status: 201 });
}

export async function handlePublicTrackingApi(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL
): Promise<Response | null> {
  try {
    if (url.pathname === "/api/public/events" && request.method === "POST") {
      return await handleEvents(request, env, ctx);
    }
    if (url.pathname === "/api/public/leads" && request.method === "POST") {
      return await handleLead(request, env);
    }
    return null;
  } catch (error) {
    if (error instanceof PublicContextError) {
      return errorResponse(403, "TRACKING_CONTEXT_INVALID", error.message);
    }
    if (error instanceof PublicRateLimitError) {
      return errorResponse(
        429,
        "PUBLIC_RATE_LIMITED",
        error.message,
        { retryAfter: error.retryAfter }
      );
    }
    if (error instanceof ValidationError) {
      return errorResponse(400, "VALIDATION_ERROR", error.message);
    }
    throw error;
  }
}
