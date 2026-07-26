import { useEffect, useState } from "react";
import type {
  AssetSummary,
  DashboardMetrics,
  DomainProviderStatus,
  DomainSummary
} from "../../../packages/shared/src/schemas";
import { api } from "./api";
import { Notice, PageHeader, StatusPill, format, formatBytes, navigate } from "./ui";

interface CloudflareCenterState {
  metrics: DashboardMetrics;
  assets: AssetSummary[];
  domains: DomainSummary[];
  zones: Array<{ id: string; name: string; status: string }>;
  provider: DomainProviderStatus;
}

export function CloudflareCenter() {
  const [state, setState] = useState<CloudflareCenterState | null>(null);
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");

  async function load() {
    try {
      const [dashboard, assets, domains, zones] = await Promise.all([
        api.dashboard(30),
        api.assets(),
        api.domains(),
        api.domainZones()
      ]);
      setState({
        metrics: dashboard.metrics,
        assets: assets.assets,
        domains: domains.domains,
        zones: zones.zones,
        provider: domains.provider
      });
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível abrir a central Cloudflare.");
    }
  }

  useEffect(() => { void load(); }, []);

  async function sync() {
    setSyncing(true);
    setSyncMessage("");
    try {
      const result = await api.syncDomains();
      setSyncMessage(`${result.activeCount} domínio(s) ativo(s) e ${result.validatingCount} em validação.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "A sincronização falhou.");
    } finally {
      setSyncing(false);
    }
  }

  const readyAssets = state?.assets.filter((asset) => asset.uploadStatus === "ready") ?? [];
  const activeDomains = state?.domains.filter((domain) => domain.status === "active") ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Integrações / Cloudflare"
        title="A Cloudflare reformulada para quem quer vender."
        subtitle="Conta, domínios, hospedagem e arquivos em uma central simples — sem depender do painel técnico."
        actions={state?.provider.ready
          ? <button className="button secondary" disabled={syncing} onClick={() => void sync()}>{syncing ? "Sincronizando…" : "Verificar infraestrutura"}</button>
          : <button className="button primary" onClick={() => navigate("/domains")}>Conectar Cloudflare</button>}
      />

      {error && <Notice tone="error">{error}</Notice>}
      {syncMessage && <Notice tone="success">{syncMessage}</Notice>}

      {!state ? <div className="panel skeleton tall" /> : (
        <>
          <section className={`cloudflare-command panel ${state.provider.ready ? "connected" : ""}`}>
            <div className="cloudflare-command-status">
              <span className={`connection-orb ${state.provider.ready ? "online" : ""}`}><i /></span>
              <div>
                <span className="eyebrow">{state.provider.ready ? "INFRAESTRUTURA CONECTADA" : "AÇÃO NECESSÁRIA"}</span>
                <h2>{state.provider.ready ? state.provider.accountName || "Cloudflare conectada" : "Conecte a conta uma única vez"}</h2>
                <p>
                  {state.provider.ready
                    ? `Worker ${state.provider.workerName} sob controle da KRANO. Domínios, SSL e publicação são verificados por aqui.`
                    : "A autorização abre na própria Cloudflare, mostra as permissões e nunca pede sua senha dentro da KRANO."}
                </p>
              </div>
            </div>
            <div className="cloudflare-command-meta">
              <span><small>Autorização</small><strong>{authLabel(state.provider.authMode)}</strong></span>
              <span><small>Última verificação</small><strong>{formatDate(state.provider.lastCheckedAt)}</strong></span>
              <button className="button secondary" onClick={() => navigate("/domains")}>
                {state.provider.ready ? "Gerenciar conexão" : "Começar conexão guiada"}
              </button>
            </div>
          </section>

          <section className="cloudflare-module-grid">
            <ModuleCard
              icon="◇"
              eyebrow="DOMÍNIOS"
              title={`${format(state.zones.filter((zone) => zone.status === "active").length)} ativo(s)`}
              text="Domínios-base, zonas DNS e importação de outros registradores."
              status={state.provider.ready ? "Pronto" : "Conexão pendente"}
              href="/domains"
            />
            <ModuleCard
              icon="⌁"
              eyebrow="SUBDOMÍNIOS"
              title={`${format(activeDomains.length)} publicado(s)`}
              text="Endereços de ofertas e funis com DNS e SSL automáticos."
              status={`${activeDomains.filter((domain) => domain.certIssued).length} com SSL`}
              href="/subdomains"
            />
            <ModuleCard
              icon="▦"
              eyebrow="HOSPEDAGEM"
              title={`${format(state.metrics.publishedFunnels)} funil(is) publicado(s)`}
              text="Sites no Worker, uso gratuito e capacidade da instalação."
              status={state.metrics.freeOnly ? "FREE_ONLY ativo" : "Limites personalizados"}
              href="/hosting"
            />
            <ModuleCard
              icon="▣"
              eyebrow="GERENCIADOR"
              title={`${format(readyAssets.length)} arquivo(s) pronto(s)`}
              text="Imagens, documentos e vídeos armazenados no seu R2."
              status={formatBytes(state.metrics.storageBytes)}
              href="/media-library"
            />
            <ModuleCard
              icon="▶"
              eyebrow="KRATUBE"
              title={`${format(state.assets.filter((asset) => asset.mediaType === "video").length)} vídeo(s)`}
              text="Player, retenção e configurações de conversão."
              status="Módulo próprio"
              href="/kratube"
            />
          </section>

          <section className="cloudflare-lower-grid">
            <article className="panel infrastructure-health">
              <div className="panel-header"><div><span className="eyebrow">SAÚDE DA CONTA</span><h2>O que a KRANO está cuidando</h2></div><span className="health-score">{state.provider.ready ? "OK" : "!"}</span></div>
              <HealthLine label="Autorização da conta" ready={state.provider.ready} detail={state.provider.ready ? "Válida" : "Conectar"} />
              <HealthLine label="Publicação pelo Worker" ready={Boolean(state.provider.workerName)} detail={state.provider.workerName || "Não identificado"} />
              <HealthLine label="SSL dos domínios ativos" ready={activeDomains.every((domain) => domain.certIssued !== false)} detail={`${activeDomains.filter((domain) => domain.certIssued).length}/${activeDomains.length} emitido(s)`} />
              <HealthLine label="Armazenamento protegido" ready={state.metrics.storageBytes <= state.metrics.storageLimitBytes} detail={`${formatBytes(state.metrics.storageBytes)} usados`} />
            </article>

            <article className="panel domain-preview">
              <div className="panel-header"><div><span className="eyebrow">ENDEREÇOS</span><h2>Subdomínios recentes</h2></div><button className="button ghost" onClick={() => navigate("/subdomains")}>Ver todos →</button></div>
              {state.domains.length ? state.domains.slice(0, 4).map((domain) => (
                <button key={domain.id} onClick={() => navigate("/subdomains")}>
                  <span className={`domain-health ${domain.status === "active" ? "online" : ""}`} />
                  <div><strong>{domain.hostname}</strong><small>{domain.funnelName || "Sem funil associado"}</small></div>
                  <StatusPill status={domain.status} />
                </button>
              )) : (
                <div className="mini-cloudflare-empty">
                  <strong>Nenhum domínio próprio ainda.</strong>
                  <p>O endereço gratuito do Worker continua funcionando. Adicione um domínio quando quiser.</p>
                  <button className="button secondary" onClick={() => navigate("/subdomains")}>Criar subdomínio</button>
                </div>
              )}
            </article>
          </section>
        </>
      )}
    </>
  );
}

function ModuleCard({
  icon,
  eyebrow,
  title,
  text,
  status,
  href
}: {
  icon: string;
  eyebrow: string;
  title: string;
  text: string;
  status: string;
  href: string;
}) {
  return (
    <button className="cloudflare-module" onClick={() => navigate(href)}>
      <span className="module-icon">{icon}</span>
      <small>{eyebrow}</small>
      <strong>{title}</strong>
      <p>{text}</p>
      <footer><span>{status}</span><b>Abrir →</b></footer>
    </button>
  );
}

function HealthLine({ label, ready, detail }: { label: string; ready: boolean; detail: string }) {
  return <div className="health-line"><span className={ready ? "online" : ""}>{ready ? "✓" : "!"}</span><strong>{label}</strong><small>{detail}</small></div>;
}

function authLabel(mode: DomainProviderStatus["authMode"]): string {
  return { oauth: "OAuth oficial", legacy_token: "Token guiado", none: "Pendente" }[mode];
}

function formatDate(value: string | null): string {
  if (!value) return "Ainda não feita";
  const date = new Date(value.endsWith("Z") ? value : `${value}Z`);
  return Number.isNaN(date.getTime()) ? "Registrada" : date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}
