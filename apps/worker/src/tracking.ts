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

interface PublicEvent {
  id: string;
  occurredAt: string;
  type: string;
  anonymousId: string | null;
  sessionKey: string | null;
  offerId: string | null;
  funnelId: string | null;
  pageId: string | null;
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

function parseEvent(value: unknown, request: Request): PublicEvent {
  const event = parseBodyRecord(value);
  const type = optionalString(event.type, 40) ?? "";
  if (!EVENT_TYPES.has(type) || type === "purchase") {
    throw new ValidationError("Tipo de evento inválido.");
  }
  const anonymousId = optionalString(event.anonymousId, 100);
  if (anonymousId && !/^[a-zA-Z0-9_-]{8,100}$/.test(anonymousId)) {
    throw new ValidationError("Identificador anônimo inválido.");
  }
  const occurredAtRaw = optionalString(event.occurredAt, 40);
  const occurredDate = occurredAtRaw ? new Date(occurredAtRaw) : new Date();
  if (Number.isNaN(occurredDate.getTime())) throw new ValidationError("Data inválida.");
  const now = Date.now();
  if (Math.abs(now - occurredDate.getTime()) > 24 * 60 * 60 * 1000) {
    throw new ValidationError("Evento fora da janela aceita.");
  }
  const properties =
    event.properties && typeof event.properties === "object" && !Array.isArray(event.properties)
      ? event.properties as Record<string, unknown>
      : {};
  const cleanProperties = Object.fromEntries(
    Object.entries(properties)
      .slice(0, 20)
      .filter(([, item]) => ["string", "number", "boolean"].includes(typeof item))
      .map(([key, item]) => [key.slice(0, 60), typeof item === "string" ? item.slice(0, 500) : item])
  );
  const requestedId = optionalString(event.id, 100);
  const id =
    requestedId && /^[a-zA-Z0-9_-]{8,100}$/.test(requestedId)
      ? requestedId
      : randomId();
  const requestOrigin = new URL(request.url).origin;
  const origin = request.headers.get("Origin");
  if (origin && origin !== requestOrigin) throw new ValidationError("Origem inválida.");
  return {
    id,
    occurredAt: occurredDate.toISOString(),
    type,
    anonymousId,
    sessionKey: optionalString(event.sessionKey, 100),
    offerId: optionalString(event.offerId, 100),
    funnelId: optionalString(event.funnelId, 100),
    pageId: optionalString(event.pageId, 100),
    variantId: optionalString(event.variantId, 100),
    source: optionalString(event.source, 120),
    campaign: optionalString(event.campaign, 120),
    utm:
      event.utm && typeof event.utm === "object" && !Array.isArray(event.utm)
        ? event.utm as Record<string, unknown>
        : {},
    properties: cleanProperties,
    dedupeKey: `${anonymousId ?? "anon"}:${id}`.slice(0, 220),
    eventSourceUrl: request.headers.get("Referer") ?? requestOrigin,
    clientIp: request.headers.get("CF-Connecting-IP") ?? "0.0.0.0",
    userAgent: request.headers.get("User-Agent") ?? "unknown"
  };
}

async function recordEvents(env: Env, events: PublicEvent[]): Promise<void> {
  const statements: D1PreparedStatement[] = [];
  for (const event of events) {
    statements.push(
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
    );
    statements.push(
      env.DB.prepare(
        `INSERT INTO tracking_aggregates(
          bucket_date, offer_id, funnel_id, variant_id, event_type, event_count, unique_count
        ) VALUES (date(?), ?, ?, ?, ?, 1, ?)
        ON CONFLICT(bucket_date, offer_id, funnel_id, variant_id, event_type)
        DO UPDATE SET event_count = event_count + 1,
          unique_count = unique_count + excluded.unique_count,
          updated_at = datetime('now')`
      ).bind(
        event.occurredAt,
        event.offerId ?? "",
        event.funnelId ?? "",
        event.variantId ?? "",
        event.type,
        event.anonymousId ? 1 : 0
      )
    );
  }
  if (statements.length) await env.DB.batch(statements);
}

async function handleEvents(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const body = parseBodyRecord(await readJson(request, 256_000));
  const rawEvents = Array.isArray(body.events) ? body.events : [body];
  if (!rawEvents.length || rawEvents.length > 30) {
    throw new ValidationError("Envie entre 1 e 30 eventos por lote.");
  }
  const events = rawEvents.map((item) => parseEvent(item, request));
  ctx.waitUntil((async () => {
    await recordEvents(env, events);
    const metaEvents: MetaForwardEvent[] = events.map((event) => ({
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
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return errorResponse(403, "ORIGIN_INVALID", "Origem inválida.");
  }
  const body = parseBodyRecord(await readJson(request, 32_000));
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
  const rawCustomFields =
    body.customFields && typeof body.customFields === "object" && !Array.isArray(body.customFields)
      ? body.customFields as Record<string, unknown>
      : {};
  const customFields = Object.fromEntries(
    Object.entries(rawCustomFields)
      .slice(0, 20)
      .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
      .map(([key, value]) => [
        key.slice(0, 60),
        typeof value === "string" ? value.slice(0, 500) : value
      ])
  );
  const anonymousId = optionalString(body.anonymousId, 100);
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
      anonymousId,
      optionalString(body.offerId, 100),
      optionalString(body.funnelId, 100),
      optionalString(body.pageId, 100),
      name,
      email,
      whatsapp,
      JSON.stringify(customFields),
      body.consent === true ? 1 : 0
    ),
    env.DB.prepare(
      `INSERT INTO tracking_events(
        id, occurred_at, event_type, anonymous_id, offer_id, funnel_id, page_id,
        properties_json, dedupe_key
       ) VALUES (?, ?, 'lead_submit', ?, ?, ?, ?, ?, ?)`
    ).bind(
      randomId(),
      new Date().toISOString(),
      anonymousId,
      optionalString(body.offerId, 100),
      optionalString(body.funnelId, 100),
      optionalString(body.pageId, 100),
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
      return handleEvents(request, env, ctx);
    }
    if (url.pathname === "/api/public/leads" && request.method === "POST") {
      return handleLead(request, env);
    }
    return null;
  } catch (error) {
    if (error instanceof ValidationError) {
      return errorResponse(400, "VALIDATION_ERROR", error.message);
    }
    throw error;
  }
}
