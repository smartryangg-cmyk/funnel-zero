import { useEffect, useState } from "react";
import type {
  MetaAccountInsight,
  MetaAdAccount,
  MetaAdsStatus,
  MetaCampaign
} from "../../../packages/shared/src/schemas";
import { api } from "./api";
import { Notice, PageHeader, format } from "./ui";

export function MetaAds() {
  const [status, setStatus] = useState<MetaAdsStatus | null>(null);
  const [accounts, setAccounts] = useState<MetaAdAccount[]>([]);
  const [accountId, setAccountId] = useState("");
  const [campaigns, setCampaigns] = useState<MetaCampaign[]>([]);
  const [insight, setInsight] = useState<MetaAccountInsight | null>(null);
  const [period, setPeriod] = useState(7);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyCampaign, setBusyCampaign] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    api.metaAdsStatus()
      .then(async (nextStatus) => {
        if (!active) return;
        setStatus(nextStatus);
        if (nextStatus.connected) {
          const result = await api.metaAdAccounts();
          if (!active) return;
          setAccounts(result.accounts);
          const saved = localStorage.getItem("krano:meta-account");
          const selected = result.accounts.find((account) => account.id === saved)?.id
            ?? result.accounts[0]?.id
            ?? "";
          setAccountId(selected);
        }
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : "Não foi possível consultar a Meta.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!accountId) {
      setCampaigns([]);
      setInsight(null);
      return;
    }
    localStorage.setItem("krano:meta-account", accountId);
    let active = true;
    setLoading(true);
    Promise.all([api.metaCampaigns(accountId), api.metaInsights(accountId, period)])
      .then(([campaignResult, insightResult]) => {
        if (!active) return;
        setCampaigns(campaignResult.campaigns);
        setInsight(insightResult.insight);
        setError("");
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : "Não foi possível carregar os anúncios.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [accountId, period]);

  async function connect() {
    setBusy(true);
    setError("");
    try {
      const result = await api.startMetaAdsOAuth();
      window.location.assign(result.authorizeUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível iniciar a conexão.");
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!window.confirm("Desconectar o perfil da Meta desta instalação?")) return;
    setBusy(true);
    try {
      await api.disconnectMetaAds();
      setStatus((current) => current ? { ...current, connected: false, profile: null } : current);
      setAccounts([]);
      setAccountId("");
      setCampaigns([]);
      setInsight(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível desconectar.");
    } finally {
      setBusy(false);
    }
  }

  async function changeCampaignStatus(campaign: MetaCampaign, status: "ACTIVE" | "PAUSED") {
    if (!accountId) return;
    const action = status === "PAUSED" ? "pausar" : "reativar";
    if (!window.confirm(`Deseja ${action} a campanha “${campaign.name || campaign.id}”?`)) return;
    setBusyCampaign(campaign.id);
    setError("");
    try {
      await api.updateMetaCampaignStatus(accountId, campaign.id, status);
      setCampaigns((current) => current.map((item) => item.id === campaign.id
        ? { ...item, status, effective_status: status }
        : item));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "A Meta não confirmou a alteração.");
    } finally {
      setBusyCampaign("");
    }
  }

  const currency = accounts.find((account) => account.id === accountId)?.currency ?? "BRL";
  const purchases = actionValue(insight, ["purchase", "omni_purchase"]);

  return (
    <>
      <PageHeader
        eyebrow="Meta Ads"
        title="Anúncios dentro da KRANO"
        subtitle="Acompanhe contas, campanhas e resultados sem sair da central."
        actions={status?.connected
          ? <button className="button secondary" disabled={busy} onClick={() => void disconnect()}>Desconectar</button>
          : <button className="button primary" disabled={busy || loading || !status?.configured} onClick={() => void connect()}>
              {busy ? "Abrindo Meta…" : "Conectar Facebook"}
            </button>}
      />

      {new URLSearchParams(window.location.search).get("connection") === "success" && (
        <Notice tone="success">Perfil conectado. Suas contas de anúncio já podem ser consultadas.</Notice>
      )}
      {new URLSearchParams(window.location.search).get("connection") === "failed" && (
        <Notice tone="error">A Meta não concluiu a autorização. Revise as permissões do aplicativo e tente novamente.</Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}

      {!loading && status && !status.configured && (
        <section className="panel meta-setup">
          <span className="eyebrow">CONFIGURAÇÃO ÚNICA</span>
          <h2>Prepare o aplicativo da Meta</h2>
          <p>O proprietário da instalação precisa adicionar dois segredos no Worker e cadastrar a URL de retorno abaixo no aplicativo da Meta.</p>
          <div className="meta-setup-grid">
            <div><small>Segredos do Worker</small><code>META_APP_ID</code><code>META_APP_SECRET</code></div>
            <div><small>URL de redirecionamento OAuth válida</small><code>{status.redirectUri}</code></div>
          </div>
          <p className="muted">Permissões solicitadas: {status.requiredPermissions.join(", ")}. A Meta pode exigir verificação da empresa e análise do aplicativo antes de liberar contas externas.</p>
        </section>
      )}

      {status?.configured && !status.connected && (
        <section className="panel meta-connect">
          <div className="meta-connect-icon" aria-hidden="true">M</div>
          <div><h2>Conecte o perfil que administra seus anúncios</h2><p>A KRANO abrirá a autorização oficial da Meta. Sua senha não passa pela KRANO.</p></div>
          <button className="button primary" disabled={busy} onClick={() => void connect()}>Conectar agora</button>
        </section>
      )}

      {status?.connected && (
        <>
          <section className="meta-toolbar">
            <div className="meta-profile"><span>{status.profile?.name.slice(0, 1).toUpperCase()}</span><div><small>Perfil conectado</small><strong>{status.profile?.name}</strong></div></div>
            <label className="field compact"><span>Conta de anúncios</span><select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.name || account.account_id || account.id}</option>)}
            </select></label>
            <label className="field compact"><span>Período</span><select value={period} onChange={(event) => setPeriod(Number(event.target.value))}>
              <option value={7}>Últimos 7 dias</option><option value={30}>Últimos 30 dias</option><option value={90}>Últimos 90 dias</option>
            </select></label>
          </section>

          <section className="metric-grid meta-metrics">
            <Metric label="Investimento" value={money(insight?.spend, currency)} />
            <Metric label="Impressões" value={format(number(insight?.impressions))} />
            <Metric label="Cliques" value={format(number(insight?.clicks))} />
            <Metric label="CTR" value={`${number(insight?.ctr).toFixed(2)}%`} />
            <Metric label="CPC" value={money(insight?.cpc, currency)} />
            <Metric label="Compras atribuídas" value={format(purchases)} />
          </section>

          <section className="panel meta-campaigns">
            <div className="panel-header"><div><span className="eyebrow">CAMPANHAS</span><h2>Visão operacional</h2></div><small className="muted">{campaigns.length} encontrada(s)</small></div>
            {loading ? <div className="skeleton recent-skeleton" /> : campaigns.length ? (
              <div className="meta-campaign-list">
                {campaigns.map((campaign) => (
                  <article key={campaign.id}>
                    <span className={`meta-campaign-state ${campaign.effective_status?.toLowerCase()}`} />
                    <div><strong>{campaign.name || "Campanha sem nome"}</strong><small>{campaign.objective || "Objetivo não informado"} · {campaign.id}</small></div>
                    <div className="meta-campaign-action">
                      <b>{campaign.effective_status || campaign.status || "UNKNOWN"}</b>
                      {(campaign.effective_status === "ACTIVE" || campaign.status === "ACTIVE") ? (
                        <button disabled={busyCampaign === campaign.id} onClick={() => void changeCampaignStatus(campaign, "PAUSED")}>Pausar</button>
                      ) : (campaign.effective_status === "PAUSED" || campaign.status === "PAUSED") ? (
                        <button disabled={busyCampaign === campaign.id} onClick={() => void changeCampaignStatus(campaign, "ACTIVE")}>Reativar</button>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            ) : <p className="muted">Nenhuma campanha disponível nesta conta para o período selecionado.</p>}
          </section>
        </>
      )}
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <article className="metric-card"><span className="metric-label">{label}</span><strong>{value}</strong><small>Dados oficiais da conta Meta</small></article>;
}

function number(value: string | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: string | undefined, currency: string): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(number(value));
}

function actionValue(insight: MetaAccountInsight | null, types: string[]): number {
  const found = insight?.actions?.find((action) => types.includes(action.action_type));
  return number(found?.value);
}
