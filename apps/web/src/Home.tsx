import { useEffect, useMemo, useState } from "react";
import type { AssetSummary, DashboardMetrics, DomainSummary, PageSummary, SessionUser } from "../../../packages/shared/src/schemas";
import { api } from "./api";
import { Notice, PageHeader, firstName, format, formatBytes, navigate } from "./ui";

export function Home({ user }: { user: SessionUser }) {
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [domains, setDomains] = useState<DomainSummary[]>([]);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void Promise.all([api.pages(), api.assets(), api.domains(), api.dashboard(7)])
      .then(([pageResult, assetResult, domainResult, metricResult]) => {
        setPages(pageResult.pages);
        setAssets(assetResult.assets);
        setDomains(domainResult.domains);
        setMetrics(metricResult.metrics);
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Não foi possível carregar a visão geral."));
  }, []);

  const videos = assets.filter((asset) => asset.mediaType === "video" && asset.uploadStatus === "ready");
  const liveSites = pages.filter((page) => page.isLive);
  const chart = useMemo(() => metrics?.dailySeries.slice(-7) ?? [], [metrics]);
  const maxVisits = Math.max(1, ...chart.map((point) => point.pageViews));

  return (
    <>
      <PageHeader
        eyebrow="Visão geral"
        title={`Olá, ${firstName(user.name)}.`}
        subtitle="Sua hospedagem, sem complicação."
        actions={<button className="button primary" onClick={() => navigate("/assistant")}>Pedir ao assistente</button>}
      />
      {error && <Notice tone="error">{error}</Notice>}

      <section className="v5-summary-grid">
        <Summary label="Sites no ar" value={format(liveSites.length)} detail={`${pages.length} no total`} href="/sites" />
        <Summary label="Vídeos" value={format(videos.length)} detail={formatBytes(videos.reduce((sum, item) => sum + item.byteSize, 0))} href="/videos" />
        <Summary label="Domínios" value={format(domains.length)} detail={`${domains.filter((item) => item.status === "active").length} ativos`} href="/domains" />
        <Summary label="Visitas em 7 dias" value={format(metrics?.pageViews ?? 0)} detail="Todos os sites" href="/sites" />
      </section>

      <section className="v5-two-columns">
        <article className="panel v5-chart-panel">
          <div className="panel-header"><div><span className="eyebrow">TRÁFEGO</span><h2>Visitas nos sites</h2></div><small>7 dias</small></div>
          <div className="v5-bar-chart" aria-label="Visitas dos últimos 7 dias">
            {chart.length ? chart.map((point) => (
              <div key={point.date}>
                <i style={{ height: `${Math.max(6, point.pageViews / maxVisits * 100)}%` }} />
                <small>{new Date(`${point.date}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "short" }).slice(0, 3)}</small>
              </div>
            )) : <p className="muted">Os dados aparecerão após as primeiras visitas.</p>}
          </div>
        </article>
        <article className="panel v5-start-panel">
          <span className="eyebrow">ATALHOS</span>
          <h2>O que você quer fazer?</h2>
          <button onClick={() => navigate("/sites?new=1")}><span>＋</span><div><strong>Criar site</strong><small>Comece com uma página limpa</small></div></button>
          <button onClick={() => navigate("/videos/upload")}><span>↑</span><div><strong>Enviar vídeo</strong><small>Hospede e configure o player</small></div></button>
          <button onClick={() => navigate("/assistant?prompt=clone")}><span>✦</span><div><strong>Clonar página</strong><small>Informe o link ao assistente</small></div></button>
        </article>
      </section>
    </>
  );
}

function Summary({ label, value, detail, href }: { label: string; value: string; detail: string; href: string }) {
  return <button className="v5-summary-card" onClick={() => navigate(href)}><small>{label}</small><strong>{value}</strong><span>{detail}</span><b>Ver detalhes →</b></button>;
}
