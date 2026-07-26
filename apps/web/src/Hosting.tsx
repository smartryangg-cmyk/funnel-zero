import { useEffect, useState } from "react";
import type {
  AssetSummary,
  DashboardMetrics,
  DomainProviderStatus,
  DomainSummary
} from "../../../packages/shared/src/schemas";
import { api } from "./api";
import { Notice, PageHeader, format, formatBytes, navigate } from "./ui";

interface HostingState {
  metrics: DashboardMetrics;
  assets: AssetSummary[];
  domains: DomainSummary[];
  provider: DomainProviderStatus;
}

export function Hosting() {
  const [state, setState] = useState<HostingState | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    Promise.all([api.dashboard(30), api.assets(), api.domains()])
      .then(([dashboard, assets, domains]) => {
        if (!active) return;
        setState({
          metrics: dashboard.metrics,
          assets: assets.assets,
          domains: domains.domains,
          provider: domains.provider
        });
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : "Falha ao carregar a hospedagem.");
      });
    return () => { active = false; };
  }, []);

  const videos = state?.assets.filter((asset) => asset.mediaType === "video") ?? [];
  const images = state?.assets.filter((asset) => asset.mediaType === "image") ?? [];
  const storagePercent = state?.metrics.storageLimitBytes
    ? Math.min(state.metrics.storageBytes / state.metrics.storageLimitBytes * 100, 100)
    : 0;

  return (
    <>
      <PageHeader
        eyebrow="Hospedagem"
        title="A infraestrutura trabalha. Você só vê a KRANO."
        subtitle="Sites, domínios, arquivos e vídeos organizados em um painel único."
        actions={<button className="button primary" onClick={() => navigate("/media-library")}>+ Enviar arquivo</button>}
      />
      {error && <Notice tone="error">{error}</Notice>}
      {!state ? <div className="panel skeleton tall" /> : (
        <>
          <section className="hosting-hero panel">
            <div>
              <span className={`connection-light ${state.provider.ready ? "online" : ""}`} />
              <span className="eyebrow">{state.provider.ready ? "CONTA CONECTADA" : "CONEXÃO PENDENTE"}</span>
              <h2>{state.provider.ready ? "Cloudflare pronta em segundo plano" : "Conecte uma vez e esqueça a infraestrutura"}</h2>
              <p>
                {state.provider.ready
                  ? `Conta ${state.provider.accountName || "Cloudflare"} ativa. Publicações, mídia e domínios são gerenciados daqui.`
                  : "Autorize a KRANO. Depois disso, o cliente não precisa entrar no painel da Cloudflare para operar."}
              </p>
            </div>
            <button className="button secondary" onClick={() => navigate("/domains")}>
              {state.provider.ready ? "Gerenciar domínios" : "Conectar conta"}
            </button>
          </section>

          <section className="hosting-grid">
            <HostingCard icon="▦" label="Sites e funis publicados" value={format(state.metrics.publishedFunnels)} action="Abrir funis" onClick={() => navigate("/funnels")} />
            <HostingCard icon="▶" label="Vídeos hospedados" value={format(videos.length)} action="Abrir player" onClick={() => navigate("/player")} />
            <HostingCard icon="▣" label="Imagens e arquivos" value={format(images.length + state.assets.filter((asset) => asset.mediaType === "document").length)} action="Gerenciar" onClick={() => navigate("/media-library")} />
            <HostingCard icon="◇" label="Domínios ativos" value={format(state.metrics.activeDomains)} action="Adicionar domínio" onClick={() => navigate("/domains")} />
          </section>

          <section className="dashboard-columns">
            <article className="panel capacity-panel">
              <div className="panel-header">
                <div><span className="eyebrow">USO GRATUITO</span><h2>Capacidade da conta</h2></div>
                <span className="status-pill">Protegido</span>
              </div>
              <div className="storage-gauge">
                <div className="gauge-label"><strong>{storagePercent.toFixed(1)}%</strong><span>utilizado</span></div>
                <div className="gauge-track"><i style={{ width: `${storagePercent}%` }} /></div>
              </div>
              <div className="capacity-list">
                <Capacity label="Armazenamento usado" value={formatBytes(state.metrics.storageBytes)} />
                <Capacity label="Limite protegido" value={formatBytes(state.metrics.storageLimitBytes)} />
                <Capacity label="Arquivos prontos" value={format(state.assets.filter((asset) => asset.uploadStatus === "ready").length)} />
                <Capacity label="Domínios pendentes" value={format(state.metrics.pendingDomains)} />
              </div>
              <p className="capacity-note">O modo gratuito bloqueia ações que ultrapassem os limites configurados.</p>
            </article>

            <article className="panel domain-onboarding">
              <span className="eyebrow">DOMÍNIO PRÓPRIO</span>
              <h2>Comprou na Hostinger ou em outro registrador?</h2>
              <ol>
                <li><span>1</span><div><strong>Digite o domínio na KRANO</strong><small>Nós validamos e preparamos a publicação.</small></div></li>
                <li><span>2</span><div><strong>Siga a troca guiada de DNS</strong><small>Esse único passo acontece no local onde o domínio foi comprado.</small></div></li>
                <li><span>3</span><div><strong>Gerencie tudo por aqui</strong><small>SSL, status e publicação continuam na KRANO.</small></div></li>
              </ol>
              <button className="button primary" onClick={() => navigate("/domains")}>Adicionar meu domínio</button>
            </article>
          </section>
        </>
      )}
    </>
  );
}

function HostingCard({
  icon,
  label,
  value,
  action,
  onClick
}: {
  icon: string;
  label: string;
  value: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <article className="hosting-card">
      <span>{icon}</span><small>{label}</small><strong>{value}</strong>
      <button onClick={onClick}>{action} →</button>
    </article>
  );
}

function Capacity({ label, value }: { label: string; value: string }) {
  return <div className="capacity-line"><span>{label}</span><strong>{value}</strong></div>;
}
