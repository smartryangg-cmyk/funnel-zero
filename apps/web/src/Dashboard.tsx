import { useEffect, useState } from "react";
import type { DashboardMetrics, SessionUser } from "../../../packages/shared/src/schemas";
import { api } from "./api";
import { Empty, PageHeader, firstName, format, formatBytes, navigate } from "./ui";

const metricIcons = {
  offers: "◫",
  views: "◉",
  visitors: "◎",
  play: "▶",
  retention: "◔",
  pitch: "◆",
  checkout: "↗",
  conversion: "✓"
};

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

  return (
    <>
      <PageHeader
        eyebrow="Visão geral"
        title={`Bom teste, ${firstName(user.name)}.`}
        subtitle="Seus principais sinais de oferta, VSL e checkout em um só lugar."
        actions={<button className="button primary" onClick={() => navigate("/funnels")}>+ Criar funil</button>}
      />
      <section className="filter-bar" aria-label="Filtros">
        <div className="period-tabs">
          {[1, 7, 30].map((value) => (
            <button key={value} className={days === value ? "active" : ""} onClick={() => setDays(value)}>
              {value === 1 ? "Hoje" : `${value} dias`}
            </button>
          ))}
        </div>
        <span className="filter-hint">Dados primários da instalação</span>
      </section>
      {error && <div className="notice error">{error}</div>}
      {!metrics ? <DashboardSkeleton /> : (
        <>
          <section className="metric-grid" aria-label="Métricas principais">
            <Metric icon={metricIcons.offers} label="Ofertas ativas" value={metrics.activeOffers} />
            <Metric icon={metricIcons.views} label="Visualizações" value={format(metrics.pageViews)} />
            <Metric icon={metricIcons.visitors} label="Visitantes aprox." value={format(metrics.approximateVisitors)} />
            <Metric icon={metricIcons.play} label="Inícios de VSL" value={format(metrics.vslStarts)} />
            <Metric icon={metricIcons.retention} label="Retenção média" value={`${metrics.averageRetention}%`} />
            <Metric icon={metricIcons.pitch} label="Chegaram ao pitch" value={format(metrics.pitchReached)} />
            <Metric icon={metricIcons.checkout} label="Cliques no checkout" value={format(metrics.checkoutClicks)} note={`${metrics.clickThroughRate}% CTR`} />
            <Metric icon={metricIcons.conversion} label="Conversões" value={format(metrics.conversions)} />
          </section>
          <section className="dashboard-columns">
            <article className="panel funnel-panel">
              <div className="panel-header">
                <div><span className="eyebrow">FUNIL DE CONVERSÃO</span><h2>Fluxo do período</h2></div>
                <span className="muted">{metrics.periodDays} dias</span>
              </div>
              {metrics.pageViews === 0 ? (
                <Empty icon="⇢" title="Tudo pronto para o primeiro acesso" text="Abra a oferta demonstrativa ou publique uma página para registrar eventos." />
              ) : (
                <div className="mini-funnel">
                  <FunnelStep label="Visualizações" value={metrics.pageViews} width={100} />
                  <FunnelStep label="VSL iniciada" value={metrics.vslStarts} width={74} />
                  <FunnelStep label="Pitch" value={metrics.pitchReached} width={48} />
                  <FunnelStep label="Checkout" value={metrics.checkoutClicks} width={30} />
                </div>
              )}
            </article>
            <article className="panel capacity-panel">
              <div className="panel-header">
                <div><span className="eyebrow">MODO GRATUITO</span><h2>Capacidade protegida</h2></div>
                <span className="status-pill">Ativo</span>
              </div>
              <StorageGauge used={metrics.storageBytes} limit={metrics.storageLimitBytes} />
              <div className="capacity-list">
                <CapacityLine label="R2 monitorado" value={formatBytes(metrics.storageBytes)} />
                <CapacityLine label="Limite configurado" value={formatBytes(metrics.storageLimitBytes)} />
                <CapacityLine label="Leitura do bucket" value={metrics.storageScanComplete ? "Completa" : "Parcial"} />
                <CapacityLine label="Domínios ativos" value={String(metrics.activeDomains)} />
              </div>
              <p className="capacity-note">Alertas locais em 70%, 85% e 95%. O modo gratuito não ativa serviços pagos.</p>
            </article>
          </section>
          <section className="panel readiness">
            <div>
              <span className="eyebrow">MVP OPERACIONAL</span>
              <h2>Da ideia ao sinal de compra</h2>
              <p>Crie, publique, envie a VSL e acompanhe a resposta sem sair da sua infraestrutura.</p>
            </div>
            <div className="readiness-items">
              <Readiness label="D1" detail="Dados e versões" />
              <Readiness label="R2" detail="Mídia privada" />
              <Readiness label="VSL" detail="Player rastreável" />
              <Readiness label="A/B" detail="Variantes persistentes" />
            </div>
          </section>
        </>
      )}
    </>
  );
}

function Metric({ icon, label, value, note }: { icon: string; label: string; value: string | number; note?: string }) {
  return (
    <article className="metric-card">
      <div className="metric-top"><span className="metric-icon">{icon}</span><span>—</span></div>
      <span className="metric-label">{label}</span><strong>{value}</strong>
      <small>{note ?? "Período selecionado"}</small>
    </article>
  );
}

function FunnelStep({ label, value, width }: { label: string; value: number; width: number }) {
  return <div className="funnel-step" style={{ width: `${width}%` }}><span>{label}</span><strong>{format(value)}</strong></div>;
}

function StorageGauge({ used, limit }: { used: number; limit: number }) {
  const percent = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
  return (
    <div className="storage-gauge">
      <div className="gauge-label"><strong>{percent.toFixed(1)}%</strong><span>utilizado</span></div>
      <div className="gauge-track"><i style={{ width: `${percent}%` }} /></div>
      <div className="gauge-scale"><span>0</span><span>70%</span><span>85%</span><span>95%</span></div>
    </div>
  );
}

function CapacityLine({ label, value }: { label: string; value: string }) {
  return <div className="capacity-line"><span>{label}</span><strong>{value}</strong></div>;
}

function Readiness({ label, detail }: { label: string; detail: string }) {
  return <div className="readiness-item"><span>✓</span><div><strong>{label}</strong><small>{detail}</small></div></div>;
}

function DashboardSkeleton() {
  return <div className="metric-grid">{Array.from({ length: 8 }, (_, index) => <div className="metric-card skeleton" key={index} />)}</div>;
}
