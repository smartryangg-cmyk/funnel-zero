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
        subtitle="Sua central de comando para construir, publicar e medir a operação digital."
        actions={<button className="button primary" onClick={() => navigate("/studio?new=1")}>+ Criar oferta</button>}
      />
      {error && <Notice tone="error">{error} <button className="notice-action" onClick={() => window.location.reload()}>Tentar novamente</button></Notice>}
      <section className="welcome-hero">
        <div>
          <span className="eyebrow">CENTRAL DE COMANDO</span>
          <h2>Da ideia ao tráfego, tudo no lugar certo.</h2>
          <p>Oferta, funil, páginas, VSL, rastreamento, checkout e infraestrutura em um fluxo único.</p>
          <div className="welcome-actions">
            <button className="button primary" onClick={() => navigate("/studio")}>Abrir operação</button>
            <button className="button secondary" onClick={() => navigate("/dashboard")}>Analisar resultados</button>
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
          label="Infraestrutura"
          value={state.provider?.ready ? "Conectada" : "Conectar"}
          detail={state.provider?.ready ? state.provider.accountName || "Cloudflare pronta" : "Autorize a conta uma vez"}
          ready={state.provider?.ready === true}
          href="/integrations/cloudflare"
        />
        <CommandStatus
          label="Publicação"
          value={`${format(livePages.length)} no ar`}
          detail={`${format(state.pages.length)} página(s) na operação`}
          ready={livePages.length > 0}
          href="/studio"
        />
        <CommandStatus
          label="KRATUBE"
          value={`${format(readyVideos.length)} vídeo(s)`}
          detail={readyVideos.length ? "Player pronto para configurar" : "Envie sua primeira VSL"}
          ready={readyVideos.length > 0}
          href="/kratube"
        />
        <CommandStatus
          label="Dados dos últimos 7 dias"
          value={`${format(state.metrics?.pageViews ?? 0)} visitas`}
          detail={state.metrics ? `${formatBytes(state.metrics.storageBytes)} armazenados` : "Aguardando leitura"}
          ready={(state.metrics?.pageViews ?? 0) > 0}
          href="/dashboard"
        />
      </section>

      <section className="workspace-steps">
        <QuickStep number="01" title="Oferta e funil" text="Organize estratégia, etapas e checkout." action="Abrir ofertas" href="/studio" />
        <QuickStep number="02" title="Páginas e VSL" text="Construa no mobile e configure o player." action="Construir" href="/pages" />
        <QuickStep number="03" title="Meta e GA4" text="Cole o código e deixe a KRANO validar." action="Rastrear" href="/tracking" />
        <QuickStep number="04" title="Publicar e medir" text="Coloque no ar e encontre os vazamentos." action="Analisar" href="/dashboard" />
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
  label,
  value,
  detail,
  ready,
  href
}: {
  label: string;
  value: string;
  detail: string;
  ready: boolean;
  href: string;
}) {
  return (
    <button className="command-status" onClick={() => navigate(href)}>
      <span className={`command-status-dot ${ready ? "ready" : ""}`} />
      <small>{label}</small>
      <strong>{value}</strong>
      <p>{detail}</p>
      <b>Abrir →</b>
    </button>
  );
}
