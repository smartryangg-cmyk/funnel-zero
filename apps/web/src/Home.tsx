import { useEffect, useState } from "react";
import type {
  AssetSummary,
  DashboardMetrics,
  DomainProviderStatus,
  OfferSummary,
  PageSummary,
  SessionUser
} from "../../../packages/shared/src/schemas";
import { api } from "./api";
import { Empty, Notice, PageHeader, StatusPill, firstName, format, formatBytes, navigate } from "./ui";

interface CommandCenterState {
  offers: OfferSummary[];
  pages: PageSummary[];
  assets: AssetSummary[];
  metrics: DashboardMetrics | null;
  provider: DomainProviderStatus | null;
}

export function Home({ user }: { user: SessionUser }) {
  const [state, setState] = useState<CommandCenterState>({
    offers: [],
    pages: [],
    assets: [],
    metrics: null,
    provider: null
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void Promise.allSettled([
      api.offers(),
      api.pages(),
      api.assets(),
      api.dashboard(7),
      api.domains()
    ])
      .then(([offerResult, pageResult, assetResult, dashboardResult, domainResult]) => {
        if (!active) return;
        if (offerResult.status === "rejected") throw offerResult.reason;
        if (pageResult.status === "rejected") throw pageResult.reason;
        setState({
          offers: offerResult.value.offers,
          pages: pageResult.value.pages,
          assets: assetResult.status === "fulfilled" ? assetResult.value.assets : [],
          metrics: dashboardResult.status === "fulfilled" ? dashboardResult.value.metrics : null,
          provider: domainResult.status === "fulfilled" ? domainResult.value.provider : null
        });
        setError("");
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : "Não foi possível carregar sua central.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const livePages = state.pages.filter((page) => page.isLive);
  const readyVideos = state.assets.filter(
    (asset) => asset.mediaType === "video" && asset.uploadStatus === "ready"
  );
  const readiness = [
    state.offers.length > 0,
    livePages.length > 0,
    readyVideos.length > 0,
    state.provider?.ready === true
  ].filter(Boolean).length;

  return (
    <>
      <PageHeader
        eyebrow="Início"
        title={`Bem-vindo, ${firstName(user.name)}.`}
        subtitle="Crie, publique e acompanhe sua operação sem trocar de ferramenta."
        actions={<button className="button primary" onClick={() => navigate("/studio?new=1")}>Criar novo funil</button>}
      />
      {error && <Notice tone="error">{error} <button className="notice-action" onClick={() => window.location.reload()}>Tentar novamente</button></Notice>}
      <section className="welcome-hero">
        <div>
          <span className="eyebrow">COMECE POR AQUI</span>
          <h2>O caminho mais curto até sua página no ar.</h2>
          <p>Conecte as contas uma vez. Depois, crie o funil, adicione o vídeo e acompanhe os resultados.</p>
          <div className="welcome-actions">
            <button className="button primary" onClick={() => navigate("/studio")}>Criar um funil</button>
            <button className="button secondary" onClick={() => navigate("/integrations/cloudflare")}>Ver conexões</button>
          </div>
        </div>
        <div className="welcome-score">
          <small>PRONTIDÃO DA OPERAÇÃO</small>
          <strong>{readiness}/4</strong>
          <span>{readiness === 4 ? "base pronta" : "etapas concluídas"}</span>
          <i>{livePages.length} página(s) no ar</i>
        </div>
      </section>

      <section className="command-status-grid" aria-label="Estado da operação">
        <CommandStatus
          icon="CF"
          tone="neutral"
          label="Cloudflare"
          value={state.provider?.ready ? "Conectada" : "Conectar"}
          detail={state.provider?.ready ? state.provider.accountName || "Cloudflare pronta" : "Autorize a conta uma vez"}
          ready={state.provider?.ready === true}
          href="/integrations/cloudflare"
        />
        <CommandStatus
          icon="WEB"
          tone="neutral"
          label="Sites publicados"
          value={`${format(livePages.length)} no ar`}
          detail={`${format(state.pages.length)} página(s) na operação`}
          ready={livePages.length > 0}
          href="/studio"
        />
        <CommandStatus
          icon="PLAY"
          tone="neutral"
          label="Vídeos"
          value={`${format(readyVideos.length)} vídeo(s)`}
          detail={readyVideos.length ? "Player pronto para configurar" : "Envie sua primeira VSL"}
          ready={readyVideos.length > 0}
          href="/kratube"
        />
        <CommandStatus
          icon="DATA"
          tone="neutral"
          label="Últimos 7 dias"
          value={`${format(state.metrics?.pageViews ?? 0)} visitas`}
          detail={state.metrics ? `${formatBytes(state.metrics.storageBytes)} armazenados` : "Aguardando leitura"}
          ready={(state.metrics?.pageViews ?? 0) > 0}
          href="/dashboard"
        />
      </section>

      <section className="workspace-steps">
        <QuickStep number="01" title="Conecte suas contas" text="Autorize Cloudflare e Meta com orientação passo a passo." action="Conectar" href="/integrations/cloudflare" />
        <QuickStep number="02" title="Crie o funil" text="Organize páginas, oferta, checkout e domínio." action="Criar" href="/studio" />
        <QuickStep number="03" title="Adicione a VSL" text="Hospede o vídeo e configure o player de conversão." action="Enviar vídeo" href="/kratube" />
        <QuickStep number="04" title="Acompanhe os dados" text="Veja visitas, campanhas, vendas e conversão." action="Analisar" href="/dashboard" />
      </section>
      <section className="panel recent-work">
        <div className="panel-header"><div><span className="eyebrow">CONTINUE DE ONDE PAROU</span><h2>Ofertas recentes</h2></div><button className="button ghost" onClick={() => navigate("/studio")}>Ver todas →</button></div>
        {loading ? <div className="skeleton recent-skeleton" /> : state.offers.length ? (
          <div className="recent-offers">{state.offers.slice(0, 4).map((offer) => <button key={offer.id} onClick={() => navigate(`/studio?offer=${offer.id}`)}><span>◫</span><div><strong>{offer.name}</strong><small>{offer.funnelCount} funis · {offer.pageCount} páginas</small></div><StatusPill status={offer.status} /></button>)}</div>
        ) : <Empty icon="◫" title="Sua primeira oferta começa aqui" text="A KRANO organizará todas as ferramentas dentro dela." action={<button className="button primary" onClick={() => navigate("/studio?new=1")}>Criar oferta</button>} />}
      </section>
    </>
  );
}

function QuickStep({ number, title, text, action, href }: { number: string; title: string; text: string; action: string; href: string }) {
  return <article><span>{number}</span><h3>{title}</h3><p>{text}</p><button onClick={() => navigate(href)}>{action} →</button></article>;
}

function CommandStatus({
  icon,
  tone,
  label,
  value,
  detail,
  ready,
  href
}: {
  icon: string;
  tone: "neutral";
  label: string;
  value: string;
  detail: string;
  ready: boolean;
  href: string;
}) {
  return (
    <button className={`command-status tone-${tone}`} onClick={() => navigate(href)}>
      <span className="command-status-icon" aria-hidden="true">{icon}</span>
      <span className={`command-status-dot ${ready ? "ready" : ""}`} />
      <small>{label}</small>
      <strong>{value}</strong>
      <p>{detail}</p>
      <b>Abrir →</b>
    </button>
  );
}
