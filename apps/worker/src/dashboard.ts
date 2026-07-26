import type {
  DailyMetricPoint,
  DashboardMetrics,
  FunnelMetricStage,
  QuizAnswerMetric,
  RetentionPoint,
  TrackingEventSummary,
  UtmMetricRow
} from "../../../packages/shared/src/schemas";

interface CountRow {
  value: number;
}

interface DailyRow {
  bucket: string;
  event_type: string;
  value: number;
}

interface QuizAnswerRow {
  question: string | null;
  answer: string | null;
  value: number;
}

interface UtmRow {
  source: string | null;
  campaign: string | null;
  page_views: number;
  checkout_clicks: number;
  conversions: number;
  revenue: number;
}

interface EventRow {
  id: string;
  event_type: string;
  occurred_at: string;
  source: string | null;
  campaign: string | null;
  page_id: string | null;
}

function percent(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 10_000) / 100 : 0;
}

function buildStages(values: Array<{ key: string; label: string; value: number }>): FunnelMetricStage[] {
  return values.map((stage, index) => {
    const previous = index ? values[index - 1].value : stage.value;
    const dropOff = Math.max(previous - stage.value, 0);
    return {
      ...stage,
      rateFromPrevious: index ? percent(stage.value, previous) : 100,
      dropOff,
      dropRate: index ? percent(dropOff, previous) : 0
    };
  });
}

function buildDailySeries(rows: DailyRow[], days: number): DailyMetricPoint[] {
  const indexed = new Map<string, DailyMetricPoint>();
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
    indexed.set(date, { date, pageViews: 0, checkoutClicks: 0, conversions: 0 });
  }
  for (const row of rows) {
    const point = indexed.get(row.bucket);
    if (!point) continue;
    if (row.event_type === "page_view") point.pageViews = Number(row.value);
    if (row.event_type === "checkout_click") point.checkoutClicks = Number(row.value);
    if (row.event_type === "purchase") point.conversions = Number(row.value);
  }
  return [...indexed.values()];
}

export async function readDashboard(
  env: Env,
  periodDays: number,
  requestedOfferId?: string | null
): Promise<DashboardMetrics> {
  const days = Math.min(Math.max(Math.trunc(periodDays), 1), 90);
  const since = `-${days} days`;
  const offerId = requestedOfferId?.trim() || null;
  const eventOfferFilter = offerId ? " AND offer_id = ?" : "";
  const bindEvent = (sql: string, ...values: unknown[]) =>
    env.DB.prepare(sql).bind(...values, ...(offerId ? [offerId] : []));
  const statements = [
    offerId
      ? env.DB.prepare(
          "SELECT COUNT(*) AS value FROM offers WHERE status = 'active' AND id = ?"
        ).bind(offerId)
      : env.DB.prepare("SELECT COUNT(*) AS value FROM offers WHERE status = 'active'"),
    offerId
      ? env.DB.prepare(
          "SELECT COUNT(*) AS value FROM funnels WHERE status = 'published' AND offer_id = ?"
        ).bind(offerId)
      : env.DB.prepare("SELECT COUNT(*) AS value FROM funnels WHERE status = 'published'"),
    bindEvent(
      `SELECT COUNT(*) AS value FROM tracking_events
       WHERE event_type = 'page_view' AND occurred_at > datetime('now', ?)
       ${eventOfferFilter}`,
      since
    ),
    bindEvent(
      `SELECT COUNT(DISTINCT COALESCE(NULLIF(anonymous_id, ''), id)) AS value
       FROM tracking_events
       WHERE event_type = 'page_view' AND occurred_at > datetime('now', ?)
       ${eventOfferFilter}`,
      since
    ),
    bindEvent(
      `SELECT COUNT(DISTINCT COALESCE(NULLIF(anonymous_id, ''), id)) AS value
       FROM tracking_events
       WHERE event_type = 'vsl_start' AND occurred_at > datetime('now', ?)
       ${eventOfferFilter}`,
      since
    ),
    bindEvent(
      `SELECT COALESCE(AVG(max_percent), 0) AS value
       FROM (
         SELECT
           COALESCE(NULLIF(anonymous_id, ''), NULLIF(session_key, ''), id) AS viewer_key,
           MAX(
             CASE event_type
               WHEN 'vsl_complete' THEN 100
               WHEN 'vsl_75' THEN 75
               WHEN 'vsl_50' THEN 50
               WHEN 'vsl_25' THEN 25
               WHEN 'vsl_start' THEN 0
               ELSE MIN(
                 100,
                 MAX(0, CAST(json_extract(properties_json, '$.percent') AS REAL))
               )
             END
           ) AS max_percent
         FROM tracking_events
         WHERE event_type IN (
           'vsl_start', 'vsl_progress', 'vsl_25', 'vsl_50', 'vsl_75', 'vsl_complete'
         )
           AND occurred_at > datetime('now', ?)
           ${eventOfferFilter}
         GROUP BY viewer_key
       )`,
      since
    ),
    bindEvent(
      `SELECT COUNT(DISTINCT COALESCE(NULLIF(anonymous_id, ''), id)) AS value
       FROM tracking_events
       WHERE event_type = 'vsl_pitch' AND occurred_at > datetime('now', ?)
       ${eventOfferFilter}`,
      since
    ),
    bindEvent(
      `SELECT COUNT(DISTINCT COALESCE(NULLIF(anonymous_id, ''), id)) AS value
       FROM tracking_events
       WHERE event_type = 'checkout_click' AND occurred_at > datetime('now', ?)
       ${eventOfferFilter}`,
      since
    ),
    bindEvent(
      `SELECT COUNT(DISTINCT COALESCE(NULLIF(anonymous_id, ''), id)) AS value
       FROM tracking_events
       WHERE event_type = 'purchase' AND occurred_at > datetime('now', ?)
       ${eventOfferFilter}`,
      since
    ),
    offerId
      ? env.DB.prepare(
          `SELECT COUNT(*) AS value FROM experiments e
           JOIN funnels f ON f.id = e.funnel_id
           WHERE e.winning_variant_id IS NOT NULL AND f.offer_id = ?`
        ).bind(offerId)
      : env.DB.prepare(
          "SELECT COUNT(*) AS value FROM experiments WHERE winning_variant_id IS NOT NULL"
        ),
    offerId
      ? env.DB.prepare(
          `SELECT COUNT(*) AS value FROM domains d
           JOIN funnels f ON f.id = d.funnel_id
           WHERE d.status = 'active' AND f.offer_id = ?`
        ).bind(offerId)
      : env.DB.prepare("SELECT COUNT(*) AS value FROM domains WHERE status = 'active'"),
    offerId
      ? env.DB.prepare(
          `SELECT COUNT(*) AS value FROM domains d
           JOIN funnels f ON f.id = d.funnel_id
           WHERE d.status != 'active' AND f.offer_id = ?`
        ).bind(offerId)
      : env.DB.prepare("SELECT COUNT(*) AS value FROM domains WHERE status != 'active'"),
    offerId
      ? env.DB.prepare(
          `SELECT COUNT(*) AS value FROM leads
           WHERE created_at > datetime('now', ?) AND offer_id = ?`
        ).bind(since, offerId)
      : env.DB.prepare(
          "SELECT COUNT(*) AS value FROM leads WHERE created_at > datetime('now', ?)"
        ).bind(since),
    bindEvent(
      `SELECT COUNT(DISTINCT COALESCE(NULLIF(anonymous_id, ''), id)) AS value
       FROM tracking_events
       WHERE event_type = 'quiz_start' AND occurred_at > datetime('now', ?)
       ${eventOfferFilter}`,
      since
    ),
    bindEvent(
      `SELECT COUNT(DISTINCT COALESCE(NULLIF(anonymous_id, ''), id)) AS value
       FROM tracking_events
       WHERE event_type = 'quiz_complete' AND occurred_at > datetime('now', ?)
       ${eventOfferFilter}`,
      since
    ),
    bindEvent(
      `SELECT COALESCE(
         SUM(CAST(json_extract(properties_json, '$.value') AS REAL)),
         0
       ) AS value
       FROM tracking_events
       WHERE event_type = 'purchase' AND occurred_at > datetime('now', ?)
       ${eventOfferFilter}`,
      since
    ),
    ...["vsl_25", "vsl_50", "vsl_75", "vsl_complete"].map((type) =>
      bindEvent(
        `SELECT COUNT(DISTINCT COALESCE(NULLIF(anonymous_id, ''), id)) AS value
         FROM tracking_events
         WHERE event_type = ? AND occurred_at > datetime('now', ?)
         ${eventOfferFilter}`,
        type,
        since
      )
    )
  ];

  const [results, dailyRows, quizRows, utmRows, eventRows, storage] = await Promise.all([
    env.DB.batch<CountRow>(statements),
    bindEvent(
      `SELECT date(occurred_at) AS bucket, event_type, COUNT(*) AS value
       FROM tracking_events
       WHERE event_type IN ('page_view', 'checkout_click', 'purchase')
         AND occurred_at > datetime('now', ?)
         ${eventOfferFilter}
       GROUP BY date(occurred_at), event_type
       ORDER BY bucket`,
      since
    ).all<DailyRow>(),
    bindEvent(
      `SELECT
         COALESCE(json_extract(properties_json, '$.question'), 'Pergunta') AS question,
         COALESCE(json_extract(properties_json, '$.answer'), 'Sem resposta') AS answer,
         COUNT(*) AS value
       FROM tracking_events
       WHERE event_type = 'quiz_answer' AND occurred_at > datetime('now', ?)
         ${eventOfferFilter}
       GROUP BY question, answer
       ORDER BY value DESC
       LIMIT 8`,
      since
    ).all<QuizAnswerRow>(),
    bindEvent(
      `SELECT
         COALESCE(NULLIF(source, ''), 'Direto') AS source,
         COALESCE(NULLIF(campaign, ''), 'Sem campanha') AS campaign,
         SUM(CASE WHEN event_type = 'page_view' THEN 1 ELSE 0 END) AS page_views,
         SUM(CASE WHEN event_type = 'checkout_click' THEN 1 ELSE 0 END) AS checkout_clicks,
         SUM(CASE WHEN event_type = 'purchase' THEN 1 ELSE 0 END) AS conversions,
         SUM(CASE WHEN event_type = 'purchase' THEN
            COALESCE(CAST(json_extract(properties_json, '$.value') AS REAL), 0) ELSE 0 END) AS revenue
       FROM tracking_events
       WHERE occurred_at > datetime('now', ?)
         ${eventOfferFilter}
       GROUP BY source, campaign
       ORDER BY conversions DESC, page_views DESC
       LIMIT 30`,
      since
    ).all<UtmRow>(),
    bindEvent(
      `SELECT id, event_type, occurred_at, source, campaign, page_id
       FROM tracking_events
       WHERE occurred_at > datetime('now', ?)
         ${eventOfferFilter}
       ORDER BY occurred_at DESC
       LIMIT 40`,
      since
    ).all<EventRow>(),
    env.MEDIA.list({ limit: 1000 })
  ]);
  const values = results.map((result) => Number(result.results[0]?.value ?? 0));
  const storageBytes = storage.objects.reduce((total, object) => total + object.size, 0);
  const storageLimitBytes = Number(env.MAX_STORAGE_BYTES) || 10_737_418_240;
  const pageViews = values[2] ?? 0;
  const approximateVisitors = values[3] ?? 0;
  const vslStarts = values[4] ?? 0;
  const checkoutClicks = values[7] ?? 0;
  const conversions = values[8] ?? 0;
  const pitchReached = values[6] ?? 0;
  const checkpointValues = [vslStarts, values[16] ?? 0, values[17] ?? 0, values[18] ?? 0, values[19] ?? 0];
  const retentionCurve: RetentionPoint[] = [0, 25, 50, 75, 100].map((point, index) => ({
    percent: point,
    viewers: checkpointValues[index],
    rate: percent(checkpointValues[index], vslStarts)
  }));
  const funnelStages = buildStages([
    { key: "view", label: "Visualizaram", value: approximateVisitors },
    { key: "play", label: "Iniciaram a VSL", value: vslStarts },
    { key: "pitch", label: "Chegaram ao pitch", value: pitchReached },
    { key: "checkout", label: "Clicaram no checkout", value: checkoutClicks },
    { key: "purchase", label: "Compraram", value: conversions }
  ]);
  const topQuizAnswers: QuizAnswerMetric[] = quizRows.results.map((row) => ({
    question: row.question ?? "Pergunta",
    answer: row.answer ?? "Sem resposta",
    count: Number(row.value)
  }));
  const utmMetrics: UtmMetricRow[] = utmRows.results.map((row) => ({
    source: row.source ?? "Direto",
    campaign: row.campaign ?? "Sem campanha",
    pageViews: Number(row.page_views),
    checkoutClicks: Number(row.checkout_clicks),
    conversions: Number(row.conversions),
    revenue: Math.round(Number(row.revenue) * 100) / 100,
    conversionRate: percent(Number(row.conversions), Number(row.page_views))
  }));
  const recentEvents: TrackingEventSummary[] = eventRows.results.map((row) => ({
    id: row.id,
    eventType: row.event_type,
    occurredAt: row.occurred_at,
    source: row.source ?? "Direto",
    campaign: row.campaign ?? "Sem campanha",
    pageId: row.page_id
  }));

  return {
    scopeOfferId: offerId,
    activeOffers: values[0] ?? 0,
    publishedFunnels: values[1] ?? 0,
    pageViews,
    approximateVisitors,
    vslStarts,
    averageRetention: Math.round((values[5] ?? 0) * 10) / 10,
    pitchReached,
    checkoutClicks,
    clickThroughRate: percent(checkoutClicks, approximateVisitors),
    conversions,
    leads: values[12] ?? 0,
    quizStarts: values[13] ?? 0,
    quizCompletions: values[14] ?? 0,
    conversionRate: percent(conversions, approximateVisitors),
    revenue: Math.round((values[15] ?? 0) * 100) / 100,
    winningVariants: values[9] ?? 0,
    storageBytes,
    storageLimitBytes,
    storageScanComplete: !storage.truncated,
    activeDomains: values[10] ?? 0,
    pendingDomains: values[11] ?? 0,
    periodDays: days,
    freeOnly: env.FREE_ONLY === "true",
    funnelStages,
    retentionCurve,
    dailySeries: buildDailySeries(dailyRows.results, Math.min(days, 30)),
    topQuizAnswers,
    utmRows: utmMetrics,
    recentEvents
  };
}
