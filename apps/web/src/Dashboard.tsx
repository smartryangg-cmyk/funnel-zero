import { useEffect, useMemo, useState } from "react";
import type {
  DashboardMetrics,
  FunnelMetricStage,
  SessionUser
} from "../../../packages/shared/src/schemas";
import { api } from "./api";
import { Empty, PageHeader, firstName, format, formatBytes, navigate } from "./ui";

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0
});

export function Dashboard({ user }: { user: SessionUser }) {
  const [days, setDays] = useState(7);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setMetrics(null);
    setError("");
    api.dashboard(days)
      .then((result) => active && setMetrics(result.metrics))
      .catch((caught: unknown) => active && setError(caught instanceof Error ? caught.message : "Falha nas métricas."));
    return () => { active = false; };
  }, [days]);

  const biggestLeak = useMemo(
    () => metrics?.funnelStages
      .slice(1)
      .filter((stage) => stage.dropOff > 0)
      .sort((left, right) => right.dropRate - left.dropRate)[0] ?? null,
    [metrics]
  );

  return (
    <>
      <PageHeader
        eyebrow="Dashboard"
        title={`Bom teste, ${firstName(user.name)}.`}
        subtitle="Veja onde o lead avança, onde para e onde a receita está escapando."
        actions={<button className="button primary" onClick={() => navigate("/studio")}>Abrir ofertas</button>}
      />
      <section className="filter-bar" aria-label="Filtros">
        <div className="period-tabs">
          {[1, 7, 30].map((value) => (
            <button key={value} className={days === value ? "active" : ""} onClick={() => setDays(value)}>
              {value === 1 ? "Hoje" : `${value} dias`}
            </button>
          ))}
        </div>
        <span className="filter-hint">Dados reais desta instalação</span>
      </section>
      {error && <div className="notice error">{error}</div>}
      {!metrics ? <DashboardSkeleton /> : (
        <>
          <section className="metric-grid executive" aria-label="Métricas principais">
            <Metric icon="◉" label="Visualizações" value={format(metrics.pageViews)} note={`${format(metrics.approximateVisitors)} visitantes`} />
            <Metric icon="✦" label="Leads capturados" value={format(metrics.leads)} note={`${format(metrics.quizCompletions)} quizzes concluídos`} />
            <Metric icon="✓" label="Conversão" value={`${metrics.conversionRate}%`} note={`${format(metrics.conversions)} compras confirmadas`} />
            <Metric icon="R$" label="Receita registrada" value={currency.format(metrics.revenue)} note="Somente compras via evento/webhook" />
          </section>

          {biggestLeak ? (
            <section className="leak-alert">
              <span>!</span>
              <div><small>MAIOR VAZAMENTO DO PERÍODO</small><strong>{biggestLeak.label}</strong><p>{format(biggestLeak.dropOff)} pessoas não avançaram — queda de {biggestLeak.dropRate}%.</p></div>
              <button onClick={() => navigate("/studio")}>Abrir oferta →</button>
            </section>
          ) : (
            <section className="leak-alert healthy"><span>✓</span><div><small>LEITURA DO FUNIL</small><strong>Aguardando volume suficiente</strong><p>Publique e envie tráfego para localizar os vazamentos com dados reais.</p></div></section>
          )}

          <section className="panel funnel-overview">
            <div className="panel-header">
              <div><span className="eyebrow">FUNIL HORIZONTAL</span><h2>Do acesso à receita</h2></div>
              <span className="muted">{metrics.periodDays} dias</span>
            </div>
            <HorizontalFunnel stages={metrics.funnelStages} />
          </section>

          <section className="analytics-grid">
            <article className="panel vertical-funnel-panel">
              <div className="panel-header"><div><span className="eyebrow">FUNIL VERTICAL</span><h2>Queda etapa por etapa</h2></div></div>
              {metrics.pageViews ? <VerticalFunnel stages={metrics.funnelStages} /> : <Empty icon="⇢" title="Sem acessos ainda" text="Abra a oferta de teste para começar a registrar o caminho." />}
            </article>

            <article className="panel retention-panel">
              <div className="panel-header"><div><span className="eyebrow">RETENÇÃO DA VSL</span><h2>Quem continua assistindo</h2></div><strong>{metrics.averageRetention}%</strong></div>
              <RetentionCurve points={metrics.retentionCurve} />
            </article>

            <article className="panel daily-panel">
              <div className="panel-header"><div><span className="eyebrow">MOVIMENTO DIÁRIO</span><h2>Visitas e checkout</h2></div></div>
              <DailyChart data={metrics.dailySeries} />
            </article>

            <article className="panel capacity-panel">
              <div className="panel-header">
                <div><span className="eyebrow">USO GRATUITO</span><h2>Capacidade protegida</h2></div>
                <span className="status-pill">Ativo</span>
              </div>
              <StorageGauge used={metrics.storageBytes} limit={metrics.storageLimitBytes} />
              <div className="capacity-list">
                <CapacityLine label="Armazenamento R2" value={formatBytes(metrics.storageBytes)} />
                <CapacityLine label="Limite configurado" value={formatBytes(metrics.storageLimitBytes)} />
                <CapacityLine label="Domínios ativos" value={String(metrics.activeDomains)} />
                <CapacityLine label="Funis publicados" value={String(metrics.publishedFunnels)} />
              </div>
              <button className="button secondary full" onClick={() => navigate("/hosting")}>Ver hospedagem</button>
            </article>
          </section>

          <section className="panel quiz-insights">
            <div className="panel-header"><div><span className="eyebrow">QUIZ INTERATIVO</span><h2>Respostas mais escolhidas</h2></div><span className="muted">{format(metrics.quizStarts)} inícios · {format(metrics.quizCompletions)} conclusões</span></div>
            {metrics.topQuizAnswers.length ? (
              <div className="answer-grid">{metrics.topQuizAnswers.map((item, index) => <article key={`${item.question}:${item.answer}`}><span>{String(index + 1).padStart(2, "0")}</span><div><small>{item.question}</small><strong>{item.answer}</strong></div><b>{format(item.count)}</b></article>)}</div>
            ) : <Empty icon="?" title="As respostas aparecerão aqui" text="Adicione um bloco de quiz, publique a página e acompanhe cada alternativa." />}
          </section>
        </>
      )}
    </>
  );
}

function Metric({ icon, label, value, note }: { icon: string; label: string; value: string; note: string }) {
  return <article className="metric-card"><div className="metric-top"><span className="metric-icon">{icon}</span><span>●</span></div><span className="metric-label">{label}</span><strong>{value}</strong><small>{note}</small></article>;
}

function HorizontalFunnel({ stages }: { stages: FunnelMetricStage[] }) {
  const width = 1000;
  const height = 330;
  const center = 168;
  const step = width / Math.max(stages.length, 1);
  const maxValue = Math.max(...stages.map((stage) => stage.value), 1);
  const points = stages.map((stage, index) => ({
    x: step * index + step / 2,
    half: stage.value > 0 ? 18 + (stage.value / maxValue) * 105 : 2
  }));
  const top = points.map((point, index) => {
    if (!index) return `M ${point.x} ${center - point.half}`;
    const previous = points[index - 1];
    const middle = (previous.x + point.x) / 2;
    return `C ${middle} ${center - previous.half}, ${middle} ${center - point.half}, ${point.x} ${center - point.half}`;
  }).join(" ");
  const bottom = [...points].reverse().map((point, reverseIndex) => {
    const index = points.length - 1 - reverseIndex;
    if (!reverseIndex) return `L ${point.x} ${center + point.half}`;
    const previous = points[index + 1];
    const middle = (previous.x + point.x) / 2;
    return `C ${middle} ${center + previous.half}, ${middle} ${center + point.half}, ${point.x} ${center + point.half}`;
  }).join(" ");
  const ribbon = `${top} ${bottom} Z`;
  return (
    <div className="funnel-flow-chart" role="img" aria-label="Funil horizontal de conversão">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="krano-flow" x1="0" x2="1">
            <stop offset="0" stopColor="#3a0000" />
            <stop offset=".48" stopColor="#b80000" />
            <stop offset="1" stopColor="#ff0000" />
          </linearGradient>
          <filter id="krano-glow"><feGaussianBlur stdDeviation="9" /></filter>
        </defs>
        <path className="flow-glow" d={ribbon} />
        <path className="flow-ribbon" d={ribbon} />
        {points.slice(0, -1).map((point, index) => <line key={index} x1={point.x + step / 2} x2={point.x + step / 2} y1="34" y2="302" />)}
      </svg>
      <div className="funnel-flow-columns">
        {stages.map((stage, index) => (
          <article key={stage.key} className={stage.dropRate >= 50 ? "leaking" : ""}>
            <small>{stage.label}</small>
            <strong>{index ? `${stage.rateFromPrevious}%` : "100%"}</strong>
            <span>{format(stage.value)}</span>
            {index > 0 && <i>{stage.dropRate}% de queda</i>}
          </article>
        ))}
      </div>
    </div>
  );
}

function VerticalFunnel({ stages }: { stages: FunnelMetricStage[] }) {
  const base = Math.max(stages[0]?.value ?? 0, 1);
  return <div className="vertical-funnel">{stages.map((stage) => <div key={stage.key} style={{ width: `${Math.max(stage.value / base * 100, 30)}%` }}><span>{stage.label}</span><strong>{format(stage.value)}</strong><small>{stage.rateFromPrevious}%</small></div>)}</div>;
}

function RetentionCurve({ points }: { points: DashboardMetrics["retentionCurve"] }) {
  return <div className="retention-bars">{points.map((point) => <div key={point.percent}><span>{point.percent}%</span><i><b style={{ height: `${Math.max(point.rate, 3)}%` }} /></i><strong>{point.rate}%</strong></div>)}</div>;
}

function DailyChart({ data }: { data: DashboardMetrics["dailySeries"] }) {
  const max = Math.max(...data.map((item) => item.pageViews), 1);
  return <div className="daily-chart">{data.map((item) => <div key={item.date} title={`${item.date}: ${item.pageViews} visitas`}><i style={{ height: `${Math.max(item.pageViews / max * 100, 2)}%` }}><b style={{ height: `${item.pageViews ? item.checkoutClicks / item.pageViews * 100 : 0}%` }} /></i><small>{item.date.slice(5)}</small></div>)}</div>;
}

function StorageGauge({ used, limit }: { used: number; limit: number }) {
  const percent = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
  return <div className="storage-gauge"><div className="gauge-label"><strong>{percent.toFixed(1)}%</strong><span>utilizado</span></div><div className="gauge-track"><i style={{ width: `${percent}%` }} /></div><div className="gauge-scale"><span>0</span><span>70%</span><span>85%</span><span>95%</span></div></div>;
}

function CapacityLine({ label, value }: { label: string; value: string }) {
  return <div className="capacity-line"><span>{label}</span><strong>{value}</strong></div>;
}

function DashboardSkeleton() {
  return <div className="metric-grid executive">{Array.from({ length: 4 }, (_, index) => <div className="metric-card skeleton" key={index} />)}</div>;
}
