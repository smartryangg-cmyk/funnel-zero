import type {
  DailyMetricPoint,
  DashboardMetrics,
  FunnelMetricStage,
  QuizAnswerMetric,
  RetentionPoint
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
    env.DB.prepare("SELECT COUNT(*) AS value FROM domains WHERE status != 'active'"),
    env.DB.prepare(
      "SELECT COUNT(*) AS value FROM leads WHERE created_at > datetime('now', ?)"
    ).bind(since),
    env.DB.prepare(
      "SELECT COUNT(*) AS value FROM tracking_events WHERE event_type = 'quiz_start' AND occurred_at > datetime('now', ?)"
    ).bind(since),
    env.DB.prepare(
      "SELECT COUNT(*) AS value FROM tracking_events WHERE event_type = 'quiz_complete' AND occurred_at > datetime('now', ?)"
    ).bind(since),
    env.DB.prepare(
      "SELECT COALESCE(SUM(CAST(json_extract(properties_json, '$.value') AS REAL)), 0) AS value FROM tracking_events WHERE event_type = 'purchase' AND occurred_at > datetime('now', ?)"
    ).bind(since),
    ...["vsl_25", "vsl_50", "vsl_75", "vsl_complete"].map((type) =>
      env.DB.prepare(
        "SELECT COUNT(*) AS value FROM tracking_events WHERE event_type = ? AND occurred_at > datetime('now', ?)"
      ).bind(type, since)
    )
  ];

  const [results, dailyRows, quizRows, storage] = await Promise.all([
    env.DB.batch<CountRow>(statements),
    env.DB.prepare(
      `SELECT date(occurred_at) AS bucket, event_type, COUNT(*) AS value
       FROM tracking_events
       WHERE event_type IN ('page_view', 'checkout_click', 'purchase')
         AND occurred_at > datetime('now', ?)
       GROUP BY date(occurred_at), event_type
       ORDER BY bucket`
    ).bind(since).all<DailyRow>(),
    env.DB.prepare(
      `SELECT
         COALESCE(json_extract(properties_json, '$.question'), 'Pergunta') AS question,
         COALESCE(json_extract(properties_json, '$.answer'), 'Sem resposta') AS answer,
         COUNT(*) AS value
       FROM tracking_events
       WHERE event_type = 'quiz_answer' AND occurred_at > datetime('now', ?)
       GROUP BY question, answer
       ORDER BY value DESC
       LIMIT 8`
    ).bind(since).all<QuizAnswerRow>(),
    env.MEDIA.list({ limit: 1000 })
  ]);
  const values = results.map((result) => Number(result.results[0]?.value ?? 0));
  const storageBytes = storage.objects.reduce((total, object) => total + object.size, 0);
  const storageLimitBytes = Number(env.MAX_STORAGE_BYTES) || 10_737_418_240;
  const pageViews = values[2] ?? 0;
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
    { key: "view", label: "Visualizaram", value: pageViews },
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

  return {
    activeOffers: values[0] ?? 0,
    publishedFunnels: values[1] ?? 0,
    pageViews,
    approximateVisitors: values[3] ?? 0,
    vslStarts,
    averageRetention: Math.round((values[5] ?? 0) * 10) / 10,
    pitchReached,
    checkoutClicks,
    clickThroughRate: percent(checkoutClicks, pageViews),
    conversions,
    leads: values[12] ?? 0,
    quizStarts: values[13] ?? 0,
    quizCompletions: values[14] ?? 0,
    conversionRate: percent(conversions, pageViews),
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
    topQuizAnswers
  };
}
