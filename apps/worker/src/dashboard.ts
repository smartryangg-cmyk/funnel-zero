import type { DashboardMetrics } from "../../../packages/shared/src/schemas";

interface CountRow {
  value: number;
}

export async function readDashboard(env: Env, periodDays: number): Promise<DashboardMetrics> {
  const days = Math.min(Math.max(Math.trunc(periodDays), 1), 90);
  const since = `-${days} days`;
  const statements = [
    env.DB.prepare("SELECT COUNT(*) AS value FROM offers WHERE status = 'active'"),
    env.DB.prepare("SELECT COUNT(*) AS value FROM funnels WHERE status = 'published'"),
    env.DB.prepare(
      "SELECT COUNT(*) AS value FROM tracking_events WHERE event_type = 'page_view' AND occurred_at > datetime('now', ?)"
    ).bind(since),
    env.DB.prepare(
      "SELECT COUNT(DISTINCT anonymous_id) AS value FROM tracking_events WHERE anonymous_id IS NOT NULL AND occurred_at > datetime('now', ?)"
    ).bind(since),
    env.DB.prepare(
      "SELECT COUNT(*) AS value FROM tracking_events WHERE event_type = 'vsl_start' AND occurred_at > datetime('now', ?)"
    ).bind(since),
    env.DB.prepare(
      "SELECT COALESCE(AVG(CAST(json_extract(properties_json, '$.percent') AS REAL)), 0) AS value FROM tracking_events WHERE event_type = 'vsl_progress' AND occurred_at > datetime('now', ?)"
    ).bind(since),
    env.DB.prepare(
      "SELECT COUNT(*) AS value FROM tracking_events WHERE event_type = 'vsl_pitch' AND occurred_at > datetime('now', ?)"
    ).bind(since),
    env.DB.prepare(
      "SELECT COUNT(*) AS value FROM tracking_events WHERE event_type = 'checkout_click' AND occurred_at > datetime('now', ?)"
    ).bind(since),
    env.DB.prepare(
      "SELECT COUNT(*) AS value FROM tracking_events WHERE event_type = 'purchase' AND occurred_at > datetime('now', ?)"
    ).bind(since),
    env.DB.prepare("SELECT COUNT(*) AS value FROM experiments WHERE winning_variant_id IS NOT NULL"),
    env.DB.prepare("SELECT COUNT(*) AS value FROM domains WHERE status = 'active'"),
    env.DB.prepare("SELECT COUNT(*) AS value FROM domains WHERE status != 'active'")
  ];
  const results = await env.DB.batch<CountRow>(statements);
  const values = results.map((result) => Number(result.results[0]?.value ?? 0));

  const storage = await env.MEDIA.list({ limit: 1000 });
  const storageBytes = storage.objects.reduce((total, object) => total + object.size, 0);
  const storageLimitBytes = Number(env.MAX_STORAGE_BYTES) || 10_737_418_240;
  const pageViews = values[2] ?? 0;
  const checkoutClicks = values[7] ?? 0;

  return {
    activeOffers: values[0] ?? 0,
    publishedFunnels: values[1] ?? 0,
    pageViews,
    approximateVisitors: values[3] ?? 0,
    vslStarts: values[4] ?? 0,
    averageRetention: Math.round((values[5] ?? 0) * 10) / 10,
    pitchReached: values[6] ?? 0,
    checkoutClicks,
    clickThroughRate: pageViews > 0 ? Math.round((checkoutClicks / pageViews) * 10_000) / 100 : 0,
    conversions: values[8] ?? 0,
    winningVariants: values[9] ?? 0,
    storageBytes,
    storageLimitBytes,
    storageScanComplete: !storage.truncated,
    activeDomains: values[10] ?? 0,
    pendingDomains: values[11] ?? 0,
    periodDays: days,
    freeOnly: env.FREE_ONLY === "true"
  };
}
