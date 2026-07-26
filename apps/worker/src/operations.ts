import type { SessionUser } from "../../../packages/shared/src/schemas";
import { randomId, randomToken, sha256 } from "./crypto";
import { errorResponse, json, readJson, requireSameOrigin } from "./http";
import {
  deleteMetaToken,
  hasMetaToken,
  saveMetaToken,
  testMetaConnection
} from "./meta";
import {
  audit,
  optionalString,
  parseBodyRecord,
  parseHttpUrl,
  requiredString,
  safeJson,
  ValidationError
} from "./platform";

interface OfferIntegrationRow {
  id: string;
  name: string;
  slug: string;
  checkout_url: string | null;
  pixel_config_json: string;
}

interface CheckoutRow {
  id: string;
  offer_id: string;
  name: string;
  checkout_url: string;
  parameter_map_json: string;
  active: number;
}

interface WebhookRow {
  id: string;
  checkout_integration_id: string;
  secret_hash: string;
  active: number;
  last_event_at: string | null;
  offer_id?: string;
}

interface ExperimentRow {
  id: string;
  funnel_id: string;
  name: string;
  status: "draft" | "running" | "paused" | "completed";
  winning_variant_id: string | null;
}

interface VariantRow {
  id: string;
  experiment_id: string;
  name: string;
  weight: number;
  page_version_id: string | null;
  status: "active" | "paused";
  views: number;
  conversions: number;
}

const PURCHASE_WEBHOOK_STATUSES = new Set([
  "paid",
  "approved",
  "completed",
  "purchase"
]);

export function isPurchaseWebhookStatus(value: unknown): boolean {
  return typeof value === "string" &&
    PURCHASE_WEBHOOK_STATUSES.has(value.trim().toLowerCase());
}

async function readIntegrations(env: Env, origin: string) {
  const [offers, checkouts, webhooks, experiments, variants, customScripts, metaSecrets] = await Promise.all([
    env.DB.prepare(
      "SELECT id, name, slug, checkout_url, pixel_config_json FROM offers ORDER BY name"
    ).all<OfferIntegrationRow>(),
    env.DB.prepare(
      `SELECT id, offer_id, name, checkout_url, parameter_map_json, active
       FROM checkout_integrations ORDER BY updated_at DESC`
    ).all<CheckoutRow>(),
    env.DB.prepare(
      `SELECT id, checkout_integration_id, active, last_event_at
       FROM webhooks ORDER BY created_at DESC`
    ).all<WebhookRow>(),
    env.DB.prepare(
      `SELECT id, funnel_id, name, status, winning_variant_id
       FROM experiments ORDER BY updated_at DESC`
    ).all<ExperimentRow>(),
    env.DB.prepare(
      `SELECT v.id, v.experiment_id, v.name, v.weight, v.page_version_id, v.status,
        (SELECT COUNT(*) FROM tracking_events t WHERE t.variant_id = v.id AND t.event_type = 'page_view') AS views,
        (SELECT COUNT(*) FROM tracking_events t WHERE t.variant_id = v.id AND t.event_type = 'purchase') AS conversions
       FROM experiment_variants v ORDER BY v.created_at`
    ).all<VariantRow>(),
    env.DB.prepare(
      "SELECT value_json FROM installation_settings WHERE key = 'custom_scripts'"
    ).first<{ value_json: string }>(),
    env.DB.prepare(
      "SELECT offer_id FROM integration_secrets WHERE kind = 'meta_capi'"
    ).all<{ offer_id: string }>()
  ]);
  const offersWithMetaToken = new Set(metaSecrets.results.map((row) => row.offer_id));
  return {
    offers: offers.results.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      checkoutUrl: row.checkout_url,
      pixelConfig: {
        ...safeJson<Record<string, unknown>>(row.pixel_config_json, {}),
        hasCapiToken: offersWithMetaToken.has(row.id)
      }
    })),
    checkouts: checkouts.results.map((row) => ({
      id: row.id,
      offerId: row.offer_id,
      name: row.name,
      checkoutUrl: row.checkout_url,
      parameterMap: safeJson<Record<string, string>>(row.parameter_map_json, {}),
      active: Boolean(row.active)
    })),
    webhooks: webhooks.results.map((row) => ({
      id: row.id,
      checkoutIntegrationId: row.checkout_integration_id,
      active: Boolean(row.active),
      lastEventAt: row.last_event_at,
      url: `${origin}/api/public/webhooks/${row.id}`
    })),
    experiments: experiments.results.map((experiment) => ({
      id: experiment.id,
      funnelId: experiment.funnel_id,
      name: experiment.name,
      status: experiment.status,
      winningVariantId: experiment.winning_variant_id,
      variants: variants.results
        .filter((variant) => variant.experiment_id === experiment.id)
        .map((variant) => ({
          id: variant.id,
          name: variant.name,
          weight: variant.weight,
          pageVersionId: variant.page_version_id,
          status: variant.status,
          views: Number(variant.views),
          conversions: Number(variant.conversions)
        }))
    })),
    customScripts: safeJson<{ enabled: boolean; acknowledgedRisk: boolean }>(
      customScripts?.value_json,
      { enabled: false, acknowledgedRisk: false }
    )
  };
}

async function savePixels(
  request: Request,
  env: Env,
  user: SessionUser,
  offerId: string
): Promise<Response> {
  const body = parseBodyRecord(await readJson(request, 64_000));
  const pastedCode = optionalString(body.metaCode, 32_000) ?? "";
  const pastedGa4Code = optionalString(body.ga4Code, 32_000) ?? "";
  const codeMatch = pastedCode.match(
    /fbq\s*\(\s*['"]init['"]\s*,\s*['"](\d{6,20})['"]/i
  );
  const ga4CodeMatch = pastedGa4Code.match(
    /(?:gtag\s*\(\s*['"]config['"]\s*,\s*['"]|[?&]id=)(G-[A-Z0-9]{6,15})/i
  );
  const metaPixelId = codeMatch?.[1] ?? optionalString(body.metaPixelId, 20);
  const ga4Id = (ga4CodeMatch?.[1] ?? optionalString(body.ga4Id, 20))?.toUpperCase() ?? null;
  if (metaPixelId && !/^\d{6,20}$/.test(metaPixelId)) {
    throw new ValidationError("O ID do Meta Pixel deve conter apenas números.");
  }
  if (ga4Id && !/^G-[A-Z0-9]{6,15}$/.test(ga4Id)) {
    throw new ValidationError("Informe um ID GA4 no formato G-XXXXXXXX.");
  }
  const offer = await env.DB.prepare("SELECT id FROM offers WHERE id = ? LIMIT 1")
    .bind(offerId)
    .first<{ id: string }>();
  if (!offer) return errorResponse(404, "NOT_FOUND", "Oferta não encontrada.");
  const capiToken = optionalString(body.capiToken, 4096);
  if (body.clearCapiToken === true) {
    await deleteMetaToken(env, offerId);
  } else if (capiToken) {
    if (capiToken.length < 40) {
      throw new ValidationError("O token da API de Conversões parece incompleto.");
    }
    await saveMetaToken(env, offerId, capiToken);
  }
  const tokenAvailable = await hasMetaToken(env, offerId);
  const capiEnabled = body.capiEnabled === true && Boolean(metaPixelId) && tokenAvailable;
  const config = JSON.stringify({
    metaPixelId: metaPixelId ?? "",
    ga4Id: ga4Id ?? "",
    capiEnabled,
    testEventCode: optionalString(body.testEventCode, 80) ?? "",
    graphVersion: env.META_GRAPH_VERSION || "v25.0",
    metaSource: pastedCode ? "pasted_code" : "manual",
    ga4Source: pastedGa4Code ? "pasted_code" : "manual"
  });
  const result = await env.DB.prepare(
    "UPDATE offers SET pixel_config_json = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(config, offerId).run();
  if (!result.meta.changes) return errorResponse(404, "NOT_FOUND", "Oferta não encontrada.");
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO integration_diagnostics(id, offer_id, integration_type, status, details_json)
       VALUES (?, ?, 'pixels', 'ok', ?)`
    ).bind(
      randomId(),
      offerId,
      JSON.stringify({
        metaConfigured: Boolean(metaPixelId),
        ga4Configured: Boolean(ga4Id),
        capiEnabled,
        tokenAvailable
      })
    ),
    audit(env, user.id, "pixels.updated", "offer", offerId)
  ]);
  return json({
    ok: true,
    diagnostics: {
      metaConfigured: Boolean(metaPixelId),
      ga4Configured: Boolean(ga4Id),
      capiEnabled,
      tokenAvailable,
      detectedFromCode: Boolean(codeMatch),
      detectedGa4FromCode: Boolean(ga4CodeMatch)
    }
  });
}

async function testPixels(env: Env, offerId: string, origin: string): Promise<Response> {
  try {
    const result = await testMetaConnection(env, offerId, origin);
    return json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(
      400,
      "META_TEST_FAILED",
      error instanceof Error ? error.message : "A Meta recusou o evento de teste."
    );
  }
}

async function createCheckout(
  request: Request,
  env: Env,
  user: SessionUser
): Promise<Response> {
  const body = parseBodyRecord(await readJson(request, 32_000));
  const id = randomId();
  const offerId = requiredString(body.offerId, "Oferta", 100);
  const name = requiredString(body.name, "Nome", 120);
  const checkoutUrl = parseHttpUrl(body.checkoutUrl, false)!;
  const parameterMap =
    body.parameterMap && typeof body.parameterMap === "object"
      ? body.parameterMap as Record<string, unknown>
      : { anonymousId: "fz_aid", source: "utm_source", campaign: "utm_campaign" };
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO checkout_integrations(id, offer_id, name, checkout_url, parameter_map_json)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(id, offerId, name, checkoutUrl, JSON.stringify(parameterMap)),
    env.DB.prepare(
      "UPDATE offers SET checkout_url = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(checkoutUrl, offerId),
    audit(env, user.id, "checkout.created", "checkout", id)
  ]);
  return json({ id }, { status: 201 });
}

async function createWebhook(
  request: Request,
  env: Env,
  user: SessionUser,
  origin: string
): Promise<Response> {
  const body = parseBodyRecord(await readJson(request, 16_000));
  const checkoutId = requiredString(body.checkoutIntegrationId, "Checkout", 100);
  const checkout = await env.DB.prepare("SELECT id FROM checkout_integrations WHERE id = ?")
    .bind(checkoutId)
    .first<{ id: string }>();
  if (!checkout) return errorResponse(404, "NOT_FOUND", "Integração de checkout não encontrada.");
  const id = randomId();
  const secret = randomToken(32);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO webhooks(id, checkout_integration_id, secret_hash) VALUES (?, ?, ?)"
    ).bind(id, checkoutId, await sha256(secret)),
    audit(env, user.id, "webhook.created", "webhook", id)
  ]);
  return json(
    {
      webhook: {
        id,
        url: `${origin}/api/public/webhooks/${id}`,
        secret,
        secretShownOnce: true,
        header: "X-Funnel-Zero-Secret"
      }
    },
    { status: 201 }
  );
}

async function createExperiment(
  request: Request,
  env: Env,
  user: SessionUser
): Promise<Response> {
  const body = parseBodyRecord(await readJson(request, 128_000));
  const funnelId = requiredString(body.funnelId, "Funil", 100);
  const name = requiredString(body.name, "Nome", 120);
  const variants = Array.isArray(body.variants) ? body.variants : [];
  if (variants.length < 2 || variants.length > 5) {
    throw new ValidationError("Crie entre 2 e 5 variantes.");
  }
  const id = randomId();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      "INSERT INTO experiments(id, funnel_id, name) VALUES (?, ?, ?)"
    ).bind(id, funnelId, name)
  ];
  const weight = Math.floor(10_000 / variants.length);
  variants.forEach((value, index) => {
    const variant = parseBodyRecord(value);
    statements.push(
      env.DB.prepare(
        `INSERT INTO experiment_variants(id, experiment_id, name, weight, page_version_id)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(
        randomId(),
        id,
        optionalString(variant.name, 120) ?? `Variante ${String.fromCharCode(65 + index)}`,
        index === variants.length - 1 ? 10_000 - weight * index : weight,
        optionalString(variant.pageVersionId, 100)
      )
    );
  });
  statements.push(audit(env, user.id, "experiment.created", "experiment", id));
  await env.DB.batch(statements);
  return json({ id }, { status: 201 });
}

async function updateExperiment(
  request: Request,
  env: Env,
  user: SessionUser,
  id: string
): Promise<Response> {
  const body = parseBodyRecord(await readJson(request, 32_000));
  const status = optionalString(body.status, 20);
  if (status && !["draft", "running", "paused", "completed"].includes(status)) {
    throw new ValidationError("Status inválido.");
  }
  const winner = optionalString(body.winningVariantId, 100);
  const result = await env.DB.prepare(
    `UPDATE experiments SET status = COALESCE(?, status),
     winning_variant_id = COALESCE(?, winning_variant_id), updated_at = datetime('now')
     WHERE id = ?`
  ).bind(status, winner, id).run();
  if (!result.meta.changes) return errorResponse(404, "NOT_FOUND", "Teste não encontrado.");
  await audit(env, user.id, "experiment.updated", "experiment", id, { status, winner }).run();
  return json({ ok: true });
}

async function updateCustomScripts(
  request: Request,
  env: Env,
  user: SessionUser
): Promise<Response> {
  const body = parseBodyRecord(await readJson(request, 16_000));
  const acknowledged = body.acknowledgedRisk === true;
  const enabled = body.enabled === true && acknowledged;
  const config = { enabled, acknowledgedRisk: acknowledged };
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO installation_settings(key, value_json, updated_at)
       VALUES ('custom_scripts', ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = datetime('now')`
    ).bind(JSON.stringify(config)),
    audit(env, user.id, "custom_scripts.updated", "settings", "custom_scripts", config)
  ]);
  return json({ customScripts: config });
}

export async function handleOperationsApi(
  request: Request,
  env: Env,
  user: SessionUser,
  url: URL
): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/integrations") && !url.pathname.startsWith("/api/experiments")) {
    return null;
  }
  if (["POST", "PATCH", "DELETE"].includes(request.method) && !requireSameOrigin(request)) {
    return errorResponse(403, "ORIGIN_INVALID", "Origem inválida.");
  }
  try {
    if (url.pathname === "/api/integrations" && request.method === "GET") {
      return json(await readIntegrations(env, url.origin));
    }
    const pixels = url.pathname.match(/^\/api\/integrations\/pixels\/([^/]+)$/);
    if (pixels && request.method === "PATCH") {
      return savePixels(request, env, user, pixels[1]);
    }
    const pixelTest = url.pathname.match(/^\/api\/integrations\/pixels\/([^/]+)\/test$/);
    if (pixelTest && request.method === "POST") {
      return testPixels(env, pixelTest[1], url.origin);
    }
    if (url.pathname === "/api/integrations/checkouts" && request.method === "POST") {
      return createCheckout(request, env, user);
    }
    if (url.pathname === "/api/integrations/webhooks" && request.method === "POST") {
      return createWebhook(request, env, user, url.origin);
    }
    if (url.pathname === "/api/integrations/custom-scripts" && request.method === "PATCH") {
      return updateCustomScripts(request, env, user);
    }
    if (url.pathname === "/api/experiments" && request.method === "POST") {
      return createExperiment(request, env, user);
    }
    const experiment = url.pathname.match(/^\/api\/experiments\/([^/]+)$/);
    if (experiment && request.method === "PATCH") {
      return updateExperiment(request, env, user, experiment[1]);
    }
    return errorResponse(404, "NOT_FOUND", "Integração não encontrada.");
  } catch (error) {
    if (error instanceof ValidationError) {
      return errorResponse(400, "VALIDATION_ERROR", error.message);
    }
    throw error;
  }
}

export async function handleWebhook(
  request: Request,
  env: Env,
  url: URL
): Promise<Response | null> {
  const match = url.pathname.match(/^\/api\/public\/webhooks\/([^/]+)$/);
  if (!match || request.method !== "POST") return null;
  const row = await env.DB.prepare(
    `SELECT w.id, w.checkout_integration_id, w.secret_hash, w.active, w.last_event_at,
     c.offer_id FROM webhooks w JOIN checkout_integrations c ON c.id = w.checkout_integration_id
     WHERE w.id = ?`
  ).bind(match[1]).first<WebhookRow>();
  if (!row || !row.active) return errorResponse(404, "NOT_FOUND", "Webhook não encontrado.");
  const provided = request.headers.get("X-Funnel-Zero-Secret") ?? "";
  const actual = await sha256(provided);
  const encoder = new TextEncoder();
  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual(a: ArrayBuffer | ArrayBufferView, b: ArrayBuffer | ArrayBufferView): boolean;
  };
  if (!subtle.timingSafeEqual(encoder.encode(actual), encoder.encode(row.secret_hash))) {
    return errorResponse(401, "INVALID_SECRET", "Assinatura inválida.");
  }
  const declaredLength = Number(request.headers.get("Content-Length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > 256_000) {
    return errorResponse(413, "PAYLOAD_TOO_LARGE", "Evento muito grande.");
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 256_000) {
    return errorResponse(413, "PAYLOAD_TOO_LARGE", "Evento muito grande.");
  }
  let payload: Record<string, unknown>;
  try {
    payload = parseBodyRecord(JSON.parse(raw));
  } catch {
    return errorResponse(400, "INVALID_BODY", "JSON inválido.");
  }
  const payloadHash = await sha256(raw);
  const externalId =
    optionalString(payload.id, 160) ??
    optionalString(payload.eventId, 160) ??
    optionalString(payload.transactionId, 160) ??
    payloadHash;
  const rawStatus = payload.status ?? payload.event ?? payload.type;
  const purchase = isPurchaseWebhookStatus(rawStatus);
  const anonymousId =
    optionalString(payload.fz_aid, 100) ?? optionalString(payload.anonymousId, 100);
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT OR IGNORE INTO webhook_events(id, webhook_id, external_event_id, payload_hash, status)
       VALUES (?, ?, ?, ?, 'accepted')`
    ).bind(randomId(), row.id, externalId, payloadHash),
    env.DB.prepare(
      "UPDATE webhooks SET last_event_at = datetime('now') WHERE id = ?"
    ).bind(row.id)
  ];
  if (purchase) {
    statements.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO tracking_events(
          id, occurred_at, event_type, anonymous_id, offer_id, properties_json, dedupe_key
         ) VALUES (?, ?, 'purchase', ?, ?, ?, ?)`
      ).bind(
        randomId(),
        new Date().toISOString(),
        anonymousId,
        row.offer_id ?? null,
        JSON.stringify({
          externalEventId: externalId,
          value: Number(payload.amount ?? payload.value ?? 0) || 0
        }),
        `webhook:${row.id}:${externalId}`
      )
    );
  }
  const results = await env.DB.batch(statements);
  const duplicate = Number(results[0]?.meta.changes ?? 0) === 0;
  const purchaseRecorded =
    purchase && Number(results[results.length - 1]?.meta.changes ?? 0) > 0;
  return json({ ok: true, duplicate, purchaseRecorded });
}
