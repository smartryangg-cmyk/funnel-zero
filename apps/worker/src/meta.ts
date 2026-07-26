import { openSecret, randomId, sealSecret, sha256 } from "./crypto";
import { safeJson } from "./platform";

interface MetaConfigRow {
  pixel_config_json: string;
  ciphertext: string | null;
}

interface MetaConfig {
  metaPixelId?: unknown;
  capiEnabled?: unknown;
  testEventCode?: unknown;
  graphVersion?: unknown;
}

export interface MetaForwardEvent {
  id: string;
  type: string;
  occurredAt: string;
  anonymousId: string | null;
  offerId: string | null;
  eventSourceUrl: string;
  clientIp: string;
  userAgent: string;
  properties: Record<string, unknown>;
}

interface MetaApiResult {
  events_received?: unknown;
  messages?: unknown;
  error?: {
    message?: unknown;
    type?: unknown;
    code?: unknown;
  };
}

const EVENT_NAMES: Record<string, string> = {
  page_view: "PageView",
  vsl_start: "ViewContent",
  quiz_complete: "CompleteRegistration",
  lead_submit: "Lead",
  checkout_click: "InitiateCheckout",
  purchase: "Purchase"
};

function cleanGraphVersion(value: unknown, fallback: string): string {
  const candidate = typeof value === "string" ? value.trim() : "";
  return /^v\d{1,3}\.\d$/.test(candidate) ? candidate : fallback;
}

export async function hasMetaToken(env: Env, offerId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT id FROM integration_secrets WHERE offer_id = ? AND kind = 'meta_capi' LIMIT 1"
  ).bind(offerId).first<{ id: string }>();
  return Boolean(row);
}

export async function saveMetaToken(env: Env, offerId: string, token: string): Promise<void> {
  const ciphertext = await sealSecret(token, env.SESSION_SECRET);
  await env.DB.prepare(
    `INSERT INTO integration_secrets(id, offer_id, kind, ciphertext)
     VALUES (?, ?, 'meta_capi', ?)
     ON CONFLICT(offer_id, kind) DO UPDATE SET
       ciphertext = excluded.ciphertext,
       updated_at = datetime('now')`
  ).bind(randomId(), offerId, ciphertext).run();
}

export async function deleteMetaToken(env: Env, offerId: string): Promise<void> {
  await env.DB.prepare(
    "DELETE FROM integration_secrets WHERE offer_id = ? AND kind = 'meta_capi'"
  ).bind(offerId).run();
}

async function readMetaConfig(
  env: Env,
  offerId: string
): Promise<{ pixelId: string; token: string; testEventCode: string; graphVersion: string } | null> {
  const row = await env.DB.prepare(
    `SELECT o.pixel_config_json, s.ciphertext
     FROM offers o
     LEFT JOIN integration_secrets s
       ON s.offer_id = o.id AND s.kind = 'meta_capi'
     WHERE o.id = ? AND o.status != 'archived'
     LIMIT 1`
  ).bind(offerId).first<MetaConfigRow>();
  if (!row?.ciphertext) return null;
  const config = safeJson<MetaConfig>(row.pixel_config_json, {});
  const pixelId =
    typeof config.metaPixelId === "string" && /^\d{6,20}$/.test(config.metaPixelId)
      ? config.metaPixelId
      : "";
  if (!pixelId || config.capiEnabled !== true) return null;
  return {
    pixelId,
    token: await openSecret(row.ciphertext, env.SESSION_SECRET),
    testEventCode:
      typeof config.testEventCode === "string" ? config.testEventCode.trim().slice(0, 80) : "",
    graphVersion: cleanGraphVersion(config.graphVersion, env.META_GRAPH_VERSION || "v25.0")
  };
}

async function sendBatch(
  env: Env,
  offerId: string,
  events: MetaForwardEvent[],
  forceTest = false
): Promise<{ received: number; message: string }> {
  const config = await readMetaConfig(env, offerId);
  if (!config) return { received: 0, message: "CAPI não configurada." };
  const data = await Promise.all(
    events
      .filter((event) => EVENT_NAMES[event.type])
      .slice(0, 30)
      .map(async (event) => ({
        event_name: EVENT_NAMES[event.type],
        event_time: Math.floor(new Date(event.occurredAt).getTime() / 1000),
        event_id: event.id,
        event_source_url: event.eventSourceUrl,
        action_source: "website",
        user_data: {
          client_ip_address: event.clientIp,
          client_user_agent: event.userAgent,
          external_id: event.anonymousId ? [await sha256(event.anonymousId)] : undefined
        },
        custom_data: {
          content_name:
            typeof event.properties.contentName === "string"
              ? event.properties.contentName.slice(0, 120)
              : undefined,
          value: typeof event.properties.value === "number" ? event.properties.value : undefined,
          currency: typeof event.properties.currency === "string" ? event.properties.currency : "BRL"
        }
      }))
  );
  if (!data.length) return { received: 0, message: "Nenhum evento compatível." };
  const response = await fetch(
    `https://graph.facebook.com/${config.graphVersion}/${config.pixelId}/events`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data,
        access_token: config.token,
        test_event_code: forceTest && config.testEventCode ? config.testEventCode : undefined,
        partner_agent: "funnel-zero"
      })
    }
  );
  let payload: MetaApiResult = {};
  try {
    payload = await response.json<MetaApiResult>();
  } catch {
    payload = {};
  }
  if (!response.ok || payload.error) {
    const message =
      typeof payload.error?.message === "string"
        ? payload.error.message.slice(0, 240)
        : `Meta respondeu HTTP ${response.status}.`;
    throw new Error(message);
  }
  return {
    received: Number(payload.events_received ?? data.length),
    message: "Evento recebido pela Meta."
  };
}

export async function forwardMetaEvents(env: Env, events: MetaForwardEvent[]): Promise<void> {
  const grouped = new Map<string, MetaForwardEvent[]>();
  for (const event of events) {
    if (!event.offerId || !EVENT_NAMES[event.type]) continue;
    const current = grouped.get(event.offerId) ?? [];
    current.push(event);
    grouped.set(event.offerId, current);
  }
  for (const [offerId, offerEvents] of grouped) {
    try {
      const result = await sendBatch(env, offerId, offerEvents);
      await env.DB.prepare(
        `INSERT INTO integration_diagnostics(id, offer_id, integration_type, status, details_json)
         VALUES (?, ?, 'meta_capi', 'ok', ?)`
      ).bind(randomId(), offerId, JSON.stringify({ received: result.received })).run();
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "meta_capi_forward_failed",
          offerId,
          error: error instanceof Error ? error.message : "unknown"
        })
      );
      await env.DB.prepare(
        `INSERT INTO integration_diagnostics(id, offer_id, integration_type, status, details_json)
         VALUES (?, ?, 'meta_capi', 'error', ?)`
      ).bind(
        randomId(),
        offerId,
        JSON.stringify({ message: error instanceof Error ? error.message : "Falha desconhecida." })
      ).run();
    }
  }
}

export async function testMetaConnection(
  env: Env,
  offerId: string,
  origin: string
): Promise<{ received: number; message: string }> {
  return sendBatch(
    env,
    offerId,
    [{
      id: randomId(),
      type: "page_view",
      occurredAt: new Date().toISOString(),
      anonymousId: `test-${randomId()}`,
      offerId,
      eventSourceUrl: origin,
      clientIp: "0.0.0.0",
      userAgent: "KRANO CAPI diagnostics",
      properties: { contentName: "Diagnóstico KRANO" }
    }],
    true
  );
}
