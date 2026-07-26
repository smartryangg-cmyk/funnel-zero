import { useEffect, useState, type FormEvent } from "react";
import type {
  DomainProviderStatus,
  DomainSummary,
  FunnelSummary,
  IntegrationSettings,
  PageSummary,
  PageVersionSummary
} from "../../../packages/shared/src/schemas";
import { api } from "./api";
import { Empty, Notice, PageHeader, StatusPill } from "./ui";

export function Domains() {
  const [provider, setProvider] = useState<DomainProviderStatus | null>(null);
  const [domains, setDomains] = useState<DomainSummary[]>([]);
  const [funnels, setFunnels] = useState<FunnelSummary[]>([]);
  const [accountId, setAccountId] = useState("");
  const [workerName, setWorkerName] = useState("");
  const [message, setMessage] = useState("");
  const [showAttach, setShowAttach] = useState(false);

  async function load() {
    try {
      const [result, funnelResult] = await Promise.all([api.domains(), api.funnels()]);
      setProvider(result.provider);
      setDomains(result.domains);
      setFunnels(funnelResult.funnels);
      setAccountId(result.provider.accountId);
      setWorkerName(result.provider.workerName);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Falha ao carregar domínios.");
    }
  }
  useEffect(() => { void load(); }, []);

  async function saveProvider(event: FormEvent) {
    event.preventDefault();
    try {
      await api.saveDomainProvider({ accountId, workerName });
      setMessage("Dados do provedor salvos. O token continua protegido como secret do Worker.");
      await load();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Falha ao salvar.");
    }
  }
  async function sync() {
    try {
      const result = await api.syncDomains();
      setMessage(`${result.remoteCount} domínio(s) encontrado(s) na Cloudflare.`);
      await load();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Falha ao sincronizar.");
    }
  }
  async function remove(domain: DomainSummary) {
    const confirmation = prompt(`Para remover o roteamento, digite exatamente:\n${domain.hostname}`);
    if (confirmation !== domain.hostname) return;
    try {
      await api.detachDomain(domain.id, confirmation);
      setMessage("Domínio removido do Worker.");
      await load();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Falha ao remover.");
    }
  }

  return (
    <>
      <PageHeader eyebrow="Domínios" title="Roteamento com confirmação explícita." subtitle="O endereço workers.dev já funciona como domínio de teste. Domínios próprios só mudam após confirmação." actions={<><button className="button secondary" onClick={() => void sync()} disabled={!provider?.tokenAvailable}>Sincronizar</button><button className="button primary" onClick={() => setShowAttach(true)} disabled={!provider?.tokenAvailable}>+ Conectar domínio</button></>} />
      {message && <Notice tone={message.includes("salv") || message.includes("encontrado") || message.includes("removido") ? "success" : "warning"}>{message}</Notice>}
      <section className="settings-grid">
        <article className="panel">
          <div className="panel-header"><div><span className="eyebrow">PROVEDOR OPCIONAL</span><h2>Cloudflare Domains API</h2></div><StatusPill status={provider?.tokenAvailable ? "active" : "pending"} /></div>
          <form className="form" onSubmit={(event) => void saveProvider(event)}>
            <label className="field"><span>Account ID</span><input required value={accountId} onChange={(event) => setAccountId(event.target.value)} placeholder="32 caracteres" /></label>
            <label className="field"><span>Nome do Worker</span><input required value={workerName} onChange={(event) => setWorkerName(event.target.value)} placeholder="funnel-zero-development" /></label>
            <button className="button secondary">Salvar provedor</button>
          </form>
          <div className="safe-callout"><strong>Token nunca entra no banco.</strong><p>Configure localmente: <code>npx wrangler secret put CLOUDFLARE_API_TOKEN</code>. Permissão mínima: Workers Scripts Write; Zone Read apenas para listar zonas.</p></div>
        </article>
        <article className="panel">
          <span className="eyebrow">DOMÍNIO DE TESTE ATUAL</span>
          <h2>workers.dev</h2>
          <p>A instalação publicada já está acessível sem custo e sem alterar DNS. Use-o enquanto valida a oferta.</p>
          <a className="button secondary" href={location.origin} target="_blank" rel="noreferrer">{location.host} ↗</a>
        </article>
      </section>
      <section className="panel">
        <div className="panel-header"><div><span className="eyebrow">DOMÍNIOS PRÓPRIOS</span><h2>Conectados</h2></div></div>
        {!domains.length ? <Empty icon="◇" title="Nenhum domínio próprio conectado" text="Isso não impede o funcionamento: o domínio de teste workers.dev continua ativo." /> : <div className="table-list">{domains.map((domain) => <div key={domain.id}><div><strong>{domain.hostname}</strong><small>{domain.funnelName ?? "Sem funil associado"}</small></div><StatusPill status={domain.status} /><button className="danger-text" onClick={() => void remove(domain)}>Remover</button></div>)}</div>}
      </section>
      {showAttach && <AttachDomain funnels={funnels} onClose={() => setShowAttach(false)} onSaved={async () => { setShowAttach(false); await load(); }} />}
    </>
  );
}

function AttachDomain({ funnels, onClose, onSaved }: { funnels: FunnelSummary[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [zones, setZones] = useState<Array<{ id: string; name: string; status: string }>>([]);
  const [hostname, setHostname] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [funnelId, setFunnelId] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { api.domainZones().then((result) => { setZones(result.zones); setZoneId(result.zones[0]?.id ?? ""); }).catch((caught: Error) => setError(caught.message)); }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const zone = zones.find((item) => item.id === zoneId);
    if (!zone) return;
    try {
      await api.attachDomain({ hostname, confirmation, zoneId, zoneName: zone.name, funnelId: funnelId || null, isPrimary: true });
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao conectar.");
    }
  }
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="modal" onMouseDown={(event) => event.stopPropagation()}><header><h2>Conectar domínio</h2><button onClick={onClose}>×</button></header><Notice>Esta ação altera o roteamento real na sua conta Cloudflare.</Notice><form className="form" onSubmit={(event) => void submit(event)}><label className="field"><span>Domínio ou subdomínio</span><input required value={hostname} onChange={(event) => setHostname(event.target.value.toLowerCase())} placeholder="oferta.seudominio.com" /></label><label className="field"><span>Zona</span><select required value={zoneId} onChange={(event) => setZoneId(event.target.value)}>{zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name} · {zone.status}</option>)}</select></label><label className="field"><span>Funil</span><select value={funnelId} onChange={(event) => setFunnelId(event.target.value)}><option value="">Sem associação</option>{funnels.map((funnel) => <option key={funnel.id} value={funnel.id}>{funnel.name}</option>)}</select></label><label className="field"><span>Confirme digitando o domínio</span><input required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>{error && <p className="form-error">{error}</p>}<div className="form-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary" disabled={!hostname || confirmation !== hostname}>Conectar e alterar rota</button></div></form></section></div>;
}

export function Settings() {
  const [settings, setSettings] = useState<IntegrationSettings | null>(null);
  const [funnels, setFunnels] = useState<FunnelSummary[]>([]);
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [versions, setVersions] = useState<PageVersionSummary[]>([]);
  const [offerId, setOfferId] = useState("");
  const [metaPixelId, setMetaPixelId] = useState("");
  const [ga4Id, setGa4Id] = useState("");
  const [checkoutName, setCheckoutName] = useState("Checkout principal");
  const [checkoutUrl, setCheckoutUrl] = useState("");
  const [pageId, setPageId] = useState("");
  const [funnelId, setFunnelId] = useState("");
  const [message, setMessage] = useState("");
  const [secret, setSecret] = useState<{ url: string; value: string } | null>(null);

  async function load() {
    try {
      const [integrations, funnelResult, pageResult] = await Promise.all([api.integrations(), api.funnels(), api.pages()]);
      setSettings(integrations);
      setFunnels(funnelResult.funnels);
      setPages(pageResult.pages);
      const selected = offerId || integrations.offers[0]?.id || "";
      setOfferId(selected);
      const offer = integrations.offers.find((item) => item.id === selected);
      setMetaPixelId(textValue(offer?.pixelConfig.metaPixelId));
      setGa4Id(textValue(offer?.pixelConfig.ga4Id));
      setFunnelId(funnelResult.funnels[0]?.id ?? "");
      setPageId(pageResult.pages[0]?.id ?? "");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Falha ao carregar integrações.");
    }
  }
  // A carga inicial pertence ao ciclo de vida desta rota; as demais mutações chamam load explicitamente.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!settings) return;
    const offer = settings.offers.find((item) => item.id === offerId);
    setMetaPixelId(textValue(offer?.pixelConfig.metaPixelId));
    setGa4Id(textValue(offer?.pixelConfig.ga4Id));
  }, [offerId, settings]);
  useEffect(() => {
    if (!pageId) return setVersions([]);
    api.pageVersions(pageId).then((result) => setVersions(result.versions)).catch(() => setVersions([]));
  }, [pageId]);

  async function savePixels(event: FormEvent) {
    event.preventDefault();
    try { await api.savePixels(offerId, { metaPixelId, ga4Id }); setMessage("Pixels validados e salvos."); await load(); }
    catch (caught) { setMessage(caught instanceof Error ? caught.message : "Falha nos pixels."); }
  }
  async function createCheckout(event: FormEvent) {
    event.preventDefault();
    try { await api.createCheckout({ offerId, name: checkoutName, checkoutUrl }); setMessage("Checkout externo conectado."); await load(); }
    catch (caught) { setMessage(caught instanceof Error ? caught.message : "Falha no checkout."); }
  }
  async function createWebhook(checkoutId: string) {
    const result = await api.createWebhook(checkoutId);
    setSecret({ url: result.webhook.url, value: result.webhook.secret });
    setMessage("Webhook criado. Copie o segredo agora; ele não será mostrado novamente.");
    await load();
  }
  async function createExperiment(event: FormEvent) {
    event.preventDefault();
    if (versions.length < 2) return setMessage("Publique pelo menos duas versões da mesma página.");
    try {
      await api.createExperiment({ funnelId, name: `Teste ${new Date().toLocaleDateString("pt-BR")}`, variants: versions.slice(0, 2).reverse().map((version, index) => ({ name: `Variante ${index ? "B" : "A"} · v${version.versionNumber}`, pageVersionId: version.id })) });
      setMessage("Teste A/B criado. Inicie quando estiver pronto.");
      await load();
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "Falha no teste."); }
  }
  async function toggleExperiment(id: string, status: string) {
    await api.updateExperiment(id, { status });
    await load();
  }
  if (!settings) return <><PageHeader eyebrow="Configurações" title="Integrações e experimentos" subtitle="Carregando…" />{message && <Notice tone="error">{message}</Notice>}<div className="panel skeleton tall" /></>;
  return (
    <>
      <PageHeader eyebrow="Configurações" title="Conecte só o necessário." subtitle="Checkout externo, pixels com diagnóstico, webhooks idempotentes e A/B indicativo." />
      {message && <Notice tone={message.includes("Falha") || message.includes("pelo menos") ? "warning" : "success"}>{message}</Notice>}
      <section className="settings-grid">
        <article className="panel"><span className="eyebrow">PIXELS</span><h2>Meta e GA4</h2><form className="form" onSubmit={(event) => void savePixels(event)}><label className="field"><span>Oferta</span><select required value={offerId} onChange={(event) => setOfferId(event.target.value)}>{settings.offers.map((offer) => <option key={offer.id} value={offer.id}>{offer.name}</option>)}</select></label><label className="field"><span>Meta Pixel ID</span><input value={metaPixelId} onChange={(event) => setMetaPixelId(event.target.value)} placeholder="Somente números" /></label><label className="field"><span>GA4 Measurement ID</span><input value={ga4Id} onChange={(event) => setGa4Id(event.target.value.toUpperCase())} placeholder="G-XXXXXXXX" /></label><button className="button secondary">Validar e salvar</button></form></article>
        <article className="panel"><span className="eyebrow">CHECKOUT EXTERNO</span><h2>Destino da oferta</h2><form className="form" onSubmit={(event) => void createCheckout(event)}><label className="field"><span>Nome</span><input required value={checkoutName} onChange={(event) => setCheckoutName(event.target.value)} /></label><label className="field"><span>URL HTTPS</span><input type="url" required value={checkoutUrl} onChange={(event) => setCheckoutUrl(event.target.value)} placeholder="https://…" /></label><button className="button secondary">Conectar checkout</button></form></article>
      </section>
      <section className="settings-grid">
        <article className="panel"><div className="panel-header"><div><span className="eyebrow">WEBHOOKS</span><h2>Conversões</h2></div></div>{settings.checkouts.length ? <div className="table-list">{settings.checkouts.map((checkout) => <div key={checkout.id}><div><strong>{checkout.name}</strong><small>{checkout.checkoutUrl}</small></div><button onClick={() => void createWebhook(checkout.id)}>Gerar webhook</button></div>)}</div> : <Empty icon="↗" title="Conecte um checkout primeiro" text="O endpoint registra conversões por evento externo." />}{secret && <div className="secret-box"><strong>Copie agora</strong><label>URL<input readOnly value={secret.url} onFocus={(event) => event.currentTarget.select()} /></label><label>Secret<input readOnly value={secret.value} onFocus={(event) => event.currentTarget.select()} /></label><small>Envie no cabeçalho X-Funnel-Zero-Secret.</small></div>}</article>
        <article className="panel"><span className="eyebrow">TESTE A/B</span><h2>Versões publicadas</h2><form className="form" onSubmit={(event) => void createExperiment(event)}><label className="field"><span>Funil</span><select value={funnelId} onChange={(event) => setFunnelId(event.target.value)}>{funnels.map((funnel) => <option key={funnel.id} value={funnel.id}>{funnel.name}</option>)}</select></label><label className="field"><span>Página</span><select value={pageId} onChange={(event) => setPageId(event.target.value)}>{pages.map((page) => <option key={page.id} value={page.id}>{page.name}</option>)}</select></label><p className="muted">{versions.length} versão(ões) publicada(s). As duas mais recentes serão A/B 50/50.</p><button className="button secondary" disabled={versions.length < 2}>Criar teste</button></form></article>
      </section>
      <section className="panel"><div className="panel-header"><div><span className="eyebrow">EXPERIMENTOS</span><h2>Leitura indicativa</h2></div><span className="muted">Amostra pequena não prova vencedor</span></div>{settings.experiments.length ? <div className="experiment-list">{settings.experiments.map((experiment) => <article key={experiment.id}><div><strong>{experiment.name}</strong><StatusPill status={experiment.status} /></div>{experiment.variants.map((variant) => <p key={variant.id}>{variant.name}: {variant.views} views · {variant.conversions} conversões</p>)}<button onClick={() => void toggleExperiment(experiment.id, experiment.status === "running" ? "paused" : "running")}>{experiment.status === "running" ? "Pausar" : "Iniciar"}</button></article>)}</div> : <Empty icon="A/B" title="Nenhum teste criado" text="Publique duas versões da mesma página para comparar." />}</section>
      <section className="panel danger-zone"><span className="eyebrow">OPERAÇÃO</span><h2>Backup, restauração e remoção</h2><p>Comandos locais possuem confirmação explícita e nunca incluem secrets:</p><div className="command-row"><code>npm run backup</code><code>npm run restore -- "pasta"</code><code>npm run uninstall</code></div></section>
    </>
  );
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}
