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
  const [message, setMessage] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [showAttach, setShowAttach] = useState(false);
  const [showTokenConnect, setShowTokenConnect] = useState(false);
  const canImportExternal = provider?.zoneImportReady === true;

  async function load() {
    try {
      const [result, funnelResult] = await Promise.all([api.domains(), api.funnels()]);
      setProvider(result.provider);
      setDomains(result.domains);
      setFunnels(funnelResult.funnels);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Falha ao carregar domínios.");
    }
  }
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("cloudflare") === "connected") {
      setMessage("Cloudflare conectada. Seus domínios já podem ser publicados por aqui.");
      history.replaceState({}, "", "/domains");
    } else if (params.get("cloudflare") === "error") {
      setMessage(params.get("message") ?? "A conexão com a Cloudflare não foi concluída.");
      history.replaceState({}, "", "/domains");
    }
    void load();
  }, []);

  async function connectCloudflare() {
    if (!provider?.oauthAvailable) {
      setShowTokenConnect(true);
      return;
    }
    setConnecting(true);
    try {
      const result = await api.startCloudflareOAuth();
      location.assign(result.authorizeUrl);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Falha ao iniciar a conexão.");
      setConnecting(false);
    }
  }
  async function disconnectCloudflare() {
    if (
      !confirm(
        "Desconectar a KRANO da Cloudflare? Os domínios publicados continuarão no ar, mas não poderão ser alterados aqui."
      )
    ) {
      return;
    }
    try {
      const result = await api.disconnectCloudflare();
      setMessage(result.warning ?? "Cloudflare desconectada com segurança.");
      await load();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Falha ao desconectar.");
    }
  }
  async function sync() {
    try {
      const result = await api.syncDomains();
      setMessage(
        `${result.activeCount} domínio(s) ativo(s)` +
        (result.validatingCount ? ` e ${result.validatingCount} preparando SSL.` : ".")
      );
      await load();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Falha ao sincronizar.");
    }
  }
  async function remove(domain: DomainSummary) {
    if (!confirm(`Remover ${domain.hostname} da KRANO?`)) return;
    try {
      await api.detachDomain(domain.id, domain.hostname);
      setMessage("Domínio removido do Worker.");
      await load();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Falha ao remover.");
    }
  }

  return (
    <>
      <PageHeader eyebrow="Integrações / Cloudflare / Domínios" title="Seus endereços, dentro da KRANO." subtitle="Domínios da Cloudflare são automáticos. Domínios comprados fora entram por um guia simples e ficam gerenciados aqui." actions={<><button className="button secondary" onClick={() => void sync()} disabled={!provider?.ready}>Verificar tudo</button><button className="button primary" onClick={() => setShowAttach(true)} disabled={!provider?.ready}>+ Adicionar domínio</button></>} />
      {message && <Notice tone={message.includes("não") || message.includes("Falha") || message.includes("erro") ? "warning" : "success"}>{message}</Notice>}
      <section className="settings-grid">
        <article className={`panel cloudflare-connect-card ${provider?.connected ? "connected" : ""}`}>
          <div className="panel-header"><div className="provider-title"><span className="cloudflare-mark">C</span><div><span className="eyebrow">INFRAESTRUTURA</span><h2>Cloudflare</h2></div></div><StatusPill status={provider?.connected ? "active" : "pending"} /></div>
          {provider?.connected ? (
            <>
              <div className="connection-summary"><strong>Conta conectada</strong><span>{provider.accountName || "Conta Cloudflare autorizada"}</span><small>{!canImportExternal ? "Atualize a permissão uma vez para importar domínios externos" : provider.ready ? "Pronta para publicar domínios" : "Finalizando a conexão segura…"}</small></div>
              <div className="permission-chips"><span>Ver domínios</span><span>Importar domínio externo</span><span>Publicar rotas</span><span>SSL automático</span></div>
              {!canImportExternal && <button className="button primary full" onClick={() => void connectCloudflare()} disabled={connecting}>{connecting ? "Abrindo Cloudflare…" : "Atualizar permissão de domínios"}</button>}
              {provider.guidedTokenAvailable && <button className="button ghost" onClick={() => setShowTokenConnect(true)}>Trocar autorização</button>}
              <button className="button secondary" onClick={() => void disconnectCloudflare()}>Desconectar</button>
            </>
          ) : (
            <>
              <h3>Conecte uma vez. O resto é automático.</h3>
              <p className="provider-copy">Você será levado à Cloudflare para escolher a conta e revisar as permissões. A KRANO nunca pede sua senha.</p>
              <ul className="permission-list"><li><span>✓</span>Encontrar os domínios da conta</li><li><span>✓</span>Publicar somente os endereços escolhidos</li><li><span>✓</span>Manter a conexão segura e revogável</li></ul>
              <button className="button primary cloudflare-button" onClick={() => void connectCloudflare()} disabled={connecting || (!provider?.oauthAvailable && !provider?.guidedTokenAvailable)}>{connecting ? "Abrindo Cloudflare…" : "Conectar KRANO à Cloudflare"}</button>
              {!provider?.oauthAvailable && provider?.guidedTokenAvailable && <small className="connection-help">A Cloudflare abrirá com as permissões necessárias já preenchidas.</small>}
              {!provider?.oauthAvailable && !provider?.guidedTokenAvailable && <small className="connection-help">Execute novamente o instalador desta versão para habilitar a conexão guiada.</small>}
            </>
          )}
        </article>
        <article className="panel">
          <span className="eyebrow">ENDEREÇO GRATUITO ATIVO</span>
          <h2>Seu domínio de teste já funciona</h2>
          <p>Use este endereço agora mesmo enquanto decide qual domínio próprio publicar. Nada fica bloqueado.</p>
          <div className="test-domain"><span className="live-dot" />{location.host}</div>
          <a className="button secondary" href={location.origin} target="_blank" rel="noreferrer">Abrir endereço ↗</a>
        </article>
      </section>
      <section className="panel">
        <div className="panel-header"><div><span className="eyebrow">DOMÍNIOS PRÓPRIOS</span><h2>Publicados pela KRANO</h2></div></div>
        {!domains.length ? <Empty icon="◇" title="Nenhum domínio próprio publicado" text={provider?.ready ? "Clique em “Publicar domínio”. Você só escolhe o endereço e o funil; a Cloudflare cuida do restante." : "Conecte a Cloudflare acima. Enquanto isso, o endereço gratuito continua funcionando."} /> : <div className="table-list">{domains.map((domain) => <div key={domain.id}><div><a className="domain-link" href={`https://${domain.hostname}`} target="_blank" rel="noreferrer">{domain.hostname} ↗</a><small>{domain.funnelName ?? "Todos os funis"} · {domain.certIssued === false ? "SSL preparando" : "SSL ativo"}</small></div><StatusPill status={domain.status} /><button className="danger-text" onClick={() => void remove(domain)}>Remover</button></div>)}</div>}
      </section>
      {showAttach && <AttachDomain funnels={funnels} canImportExternal={canImportExternal} onAuthorize={connectCloudflare} onClose={() => setShowAttach(false)} onSaved={async () => { setShowAttach(false); await load(); }} />}
      {showTokenConnect && provider?.tokenTemplateUrl && (
        <ConnectCloudflareToken
          templateUrl={provider.tokenTemplateUrl}
          onClose={() => setShowTokenConnect(false)}
          onConnected={async (accountName) => {
            setShowTokenConnect(false);
            setMessage(`Cloudflare conectada com segurança: ${accountName}.`);
            await load();
          }}
        />
      )}
    </>
  );
}

function ConnectCloudflareToken({
  templateUrl,
  onClose,
  onConnected
}: {
  templateUrl: string;
  onClose: () => void;
  onConnected: (accountName: string) => Promise<void>;
}) {
  const [apiToken, setApiToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function connect(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const result = await api.connectCloudflareToken(apiToken);
      setApiToken("");
      await onConnected(result.provider.accountName);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "A Cloudflare recusou a autorização.");
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="modal cloudflare-token-modal" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span className="eyebrow">CONEXÃO GUIADA</span><h2>Autorize a KRANO</h2></div><button onClick={onClose}>×</button></header>
        <ol className="guided-connection-steps">
          <li><span>1</span><div><strong>Abra a tela oficial</strong><p>As permissões mínimas já estarão selecionadas para esta instalação.</p></div></li>
          <li><span>2</span><div><strong>Crie e copie o token</strong><p>A Cloudflare mostra o código uma única vez.</p></div></li>
          <li><span>3</span><div><strong>Cole abaixo</strong><p>O código será validado e guardado somente como secret do Worker.</p></div></li>
        </ol>
        <a className="button primary full" href={templateUrl} target="_blank" rel="noreferrer">Abrir autorização na Cloudflare ↗</a>
        <form className="form token-connect-form" onSubmit={(event) => void connect(event)}>
          <label className="field"><span>Token gerado pela Cloudflare</span><input type="password" autoComplete="off" required value={apiToken} onChange={(event) => setApiToken(event.target.value.trim())} placeholder="cfut_..." /></label>
          {error && <p className="form-error">{error}</p>}
          <div className="form-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button secondary" disabled={!apiToken || saving}>{saving ? "Validando…" : "Concluir conexão"}</button></div>
        </form>
      </section>
    </div>
  );
}

function AttachDomain({
  funnels,
  canImportExternal,
  onAuthorize,
  onClose,
  onSaved
}: {
  funnels: FunnelSummary[];
  canImportExternal: boolean;
  onAuthorize: () => Promise<void>;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [zones, setZones] = useState<Array<{ id: string; name: string; status: string; nameServers: string[] }>>([]);
  const [mode, setMode] = useState<"existing" | "external">("existing");
  const [zoneId, setZoneId] = useState("");
  const [subdomain, setSubdomain] = useState("oferta");
  const [externalDomain, setExternalDomain] = useState("");
  const [imported, setImported] = useState<{ name: string; status: string; nameServers: string[] } | null>(null);
  const [funnelId, setFunnelId] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const publishedFunnels = funnels.filter((funnel) => funnel.status === "published");

  async function loadZones() {
    const result = await api.domainZones();
    setZones(result.zones);
    const activeZones = result.zones.filter((zone) => zone.status === "active");
    setZoneId((current) => current || activeZones[0]?.id || "");
  }
  useEffect(() => { void loadZones().catch((caught: Error) => setError(caught.message)); }, []);

  const activeZones = zones.filter((item) => item.status === "active");
  const zone = activeZones.find((item) => item.id === zoneId);
  const hostname = zone ? `${subdomain ? `${subdomain}.` : ""}${zone.name}` : "";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!zone || !hostname) return;
    setSaving(true);
    setError("");
    try {
      await api.attachDomain({ hostname, funnelId, isPrimary: true });
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao conectar.");
      setSaving(false);
    }
  }
  async function importDomain() {
    setSaving(true);
    setError("");
    try {
      const result = await api.importDomain(externalDomain);
      setImported(result.zone);
      await loadZones();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao importar o domínio.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="modal domain-wizard" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span className="eyebrow">PUBLICAÇÃO GUIADA</span><h2>Qual endereço você quer usar?</h2></div><button onClick={onClose}>×</button></header>
        <div className="tracking-tabs domain-tabs">
          <button className={mode === "existing" ? "active" : ""} onClick={() => setMode("existing")}>Já está na Cloudflare</button>
          <button className={mode === "external" ? "active" : ""} onClick={() => setMode("external")}>Comprei em outro lugar</button>
        </div>
        {mode === "existing" ? (
          <form className="form" onSubmit={(event) => void submit(event)}>
            <div className="domain-composer">
              <label className="field"><span>Nome do endereço</span><input value={subdomain} onChange={(event) => setSubdomain(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/^-+/, ""))} placeholder="oferta" /></label>
              <span className="domain-dot">.</span>
              <label className="field"><span>Seu domínio</span><select required value={zoneId} onChange={(event) => setZoneId(event.target.value)}>{activeZones.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            </div>
            <div className="domain-preview"><small>O endereço ficará assim</small><strong>https://{hostname || "escolha um domínio ativo"}</strong></div>
            <label className="field"><span>Qual funil deve abrir?</span><select required value={funnelId} onChange={(event) => setFunnelId(event.target.value)}><option value="">Escolha um funil publicado</option>{publishedFunnels.map((funnel) => <option key={funnel.id} value={funnel.id}>{funnel.name}</option>)}</select></label>
            <div className="automatic-steps"><span>✓ DNS automático</span><span>✓ SSL automático</span><span>✓ Sem novo deploy</span></div>
            {!activeZones.length && !error && <p className="form-help">Nenhum domínio ativo encontrado. Use a aba “Comprei em outro lugar”.</p>}
            {error && <p className="form-error">{error}</p>}
            <Notice>A rota e o certificado são criados sem abrir o painel Cloudflare.</Notice>
            {!publishedFunnels.length && <Notice><strong>Publique o funil primeiro</strong><p>O domínio só é ativado depois que existe pelo menos uma página realmente publicada.</p></Notice>}
            <div className="form-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary" disabled={!hostname || !funnelId || saving}>{saving ? "Publicando…" : "Publicar neste endereço"}</button></div>
          </form>
        ) : (
          <div className="form external-domain-flow">
            <label className="field"><span>Domínio comprado na Hostinger ou outro registrador</span><input value={externalDomain} onChange={(event) => setExternalDomain(event.target.value.toLowerCase().trim())} placeholder="seudominio.com.br" /></label>
            {!canImportExternal && <Notice><strong>Atualização de permissão necessária</strong><p>A Cloudflare mostrará a tela oficial para autorizar a importação de domínios. Isso acontece uma única vez.</p><button className="button primary full" onClick={() => void onAuthorize()}>Atualizar permissão</button></Notice>}
            {!imported ? (
              <button className="button primary full" disabled={!canImportExternal || !externalDomain || saving} onClick={() => void importDomain()}>{saving ? "Preparando…" : "Preparar domínio na KRANO"}</button>
            ) : (
              <div className="nameserver-guide">
                <span className="eyebrow">ÚNICO PASSO NO REGISTRADOR</span>
                <h3>Troque os servidores DNS de {imported.name}</h3>
                <p>A compra continua no provedor atual. Copie estes dois endereços na área “Servidores DNS” ou “Nameservers”.</p>
                {imported.nameServers.map((server) => <code key={server} onClick={() => void navigator.clipboard.writeText(server)}>{server}<span>copiar</span></code>)}
                <small>Depois da ativação, volte aqui, clique em “Verificar tudo” e publique o subdomínio. Essa troca não pode ser feita sem autorização do registrador.</small>
              </div>
            )}
            {error && <p className="form-error">{error}</p>}
            <div className="form-actions"><button type="button" className="button ghost" onClick={onClose}>Fechar</button>{imported && <button className="button secondary" onClick={() => { setMode("existing"); setImported(null); }}>Já alterei o DNS</button>}</div>
          </div>
        )}
      </section>
    </div>
  );
}

export function Settings() {
  const requestedOfferId = new URLSearchParams(location.search).get("offer") ?? "";
  const requestedSection = location.hash.slice(1);
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
      const selected = integrations.offers.some((offer) => offer.id === requestedOfferId)
        ? requestedOfferId
        : offerId || integrations.offers[0]?.id || "";
      setOfferId(selected);
      const offer = integrations.offers.find((item) => item.id === selected);
      setMetaPixelId(textValue(offer?.pixelConfig.metaPixelId));
      setGa4Id(textValue(offer?.pixelConfig.ga4Id));
      const selectedFunnels = funnelResult.funnels.filter((funnel) => funnel.offerId === selected);
      const selectedPages = pageResult.pages.filter((page) => page.offerId === selected);
      setFunnelId((current) =>
        selectedFunnels.some((funnel) => funnel.id === current)
          ? current
          : selectedFunnels[0]?.id ?? ""
      );
      setPageId((current) =>
        selectedPages.some((page) => page.id === current)
          ? current
          : selectedPages[0]?.id ?? ""
      );
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Falha ao carregar integrações.");
    }
  }
  // A URL pode abrir diretamente uma oferta; as demais mutações chamam load explicitamente.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [requestedOfferId]);
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
  useEffect(() => {
    if (!settings || !requestedSection) return;
    const timer = window.setTimeout(() => {
      document.getElementById(requestedSection)?.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [settings, requestedSection]);

  const offerFunnels = funnels.filter((funnel) => funnel.offerId === offerId);
  const funnelPages = pages.filter((page) =>
    page.offerId === offerId && (!funnelId || page.funnelId === funnelId)
  );
  const offerCheckouts = settings?.checkouts.filter(
    (checkout) => checkout.offerId === offerId
  ) ?? [];
  const offerFunnelIds = new Set(offerFunnels.map((funnel) => funnel.id));
  const offerExperiments = settings?.experiments.filter(
    (experiment) => offerFunnelIds.has(experiment.funnelId)
  ) ?? [];

  function selectOffer(nextOfferId: string) {
    setOfferId(nextOfferId);
    const matchingFunnels = funnels.filter((funnel) => funnel.offerId === nextOfferId);
    const nextFunnelId = matchingFunnels[0]?.id ?? "";
    setFunnelId(nextFunnelId);
    setPageId(
      pages.find((page) =>
        page.offerId === nextOfferId && (!nextFunnelId || page.funnelId === nextFunnelId)
      )?.id ?? ""
    );
    const nextUrl = new URL(location.href);
    if (nextOfferId) nextUrl.searchParams.set("offer", nextOfferId);
    else nextUrl.searchParams.delete("offer");
    history.replaceState({}, "", `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
  }

  function selectFunnel(nextFunnelId: string) {
    setFunnelId(nextFunnelId);
    setPageId(
      pages.find((page) =>
        page.offerId === offerId && (!nextFunnelId || page.funnelId === nextFunnelId)
      )?.id ?? ""
    );
  }

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
        <article className="panel"><span className="eyebrow">PIXELS</span><h2>Meta e GA4</h2><form className="form" onSubmit={(event) => void savePixels(event)}><label className="field"><span>Oferta</span><select required value={offerId} onChange={(event) => selectOffer(event.target.value)}>{settings.offers.map((offer) => <option key={offer.id} value={offer.id}>{offer.name}</option>)}</select></label><label className="field"><span>Meta Pixel ID</span><input value={metaPixelId} onChange={(event) => setMetaPixelId(event.target.value)} placeholder="Somente números" /></label><label className="field"><span>GA4 Measurement ID</span><input value={ga4Id} onChange={(event) => setGa4Id(event.target.value.toUpperCase())} placeholder="G-XXXXXXXX" /></label><button className="button secondary">Validar e salvar</button></form></article>
        <article className="panel" id="checkout"><span className="eyebrow">CHECKOUT EXTERNO</span><h2>Destino da oferta</h2><form className="form" onSubmit={(event) => void createCheckout(event)}><label className="field"><span>Nome</span><input required value={checkoutName} onChange={(event) => setCheckoutName(event.target.value)} /></label><label className="field"><span>URL HTTPS</span><input type="url" required value={checkoutUrl} onChange={(event) => setCheckoutUrl(event.target.value)} placeholder="https://…" /></label><button className="button secondary">Conectar checkout</button></form></article>
      </section>
      <section className="settings-grid">
        <article className="panel"><div className="panel-header"><div><span className="eyebrow">WEBHOOKS</span><h2>Conversões</h2></div></div>{offerCheckouts.length ? <div className="table-list">{offerCheckouts.map((checkout) => <div key={checkout.id}><div><strong>{checkout.name}</strong><small>{checkout.checkoutUrl}</small></div><button onClick={() => void createWebhook(checkout.id)}>Gerar webhook</button></div>)}</div> : <Empty icon="↗" title="Conecte um checkout primeiro" text="O endpoint registra conversões por evento externo." />}{secret && <div className="secret-box"><strong>Copie agora</strong><label>URL<input readOnly value={secret.url} onFocus={(event) => event.currentTarget.select()} /></label><label>Secret<input readOnly value={secret.value} onFocus={(event) => event.currentTarget.select()} /></label><small>Envie no cabeçalho X-Funnel-Zero-Secret.</small></div>}</article>
        <article className="panel"><span className="eyebrow">TESTE A/B</span><h2>Versões publicadas</h2><form className="form" onSubmit={(event) => void createExperiment(event)}><label className="field"><span>Funil</span><select value={funnelId} onChange={(event) => selectFunnel(event.target.value)}>{offerFunnels.map((funnel) => <option key={funnel.id} value={funnel.id}>{funnel.name}</option>)}</select></label><label className="field"><span>Página</span><select value={pageId} onChange={(event) => setPageId(event.target.value)}>{funnelPages.map((page) => <option key={page.id} value={page.id}>{page.name}</option>)}</select></label><p className="muted">{versions.length} versão(ões) publicada(s). As duas mais recentes serão A/B 50/50.</p><button className="button secondary" disabled={versions.length < 2}>Criar teste</button></form></article>
      </section>
      <section className="panel"><div className="panel-header"><div><span className="eyebrow">EXPERIMENTOS</span><h2>Leitura indicativa</h2></div><span className="muted">Amostra pequena não prova vencedor</span></div>{offerExperiments.length ? <div className="experiment-list">{offerExperiments.map((experiment) => <article key={experiment.id}><div><strong>{experiment.name}</strong><StatusPill status={experiment.status} /></div>{experiment.variants.map((variant) => <p key={variant.id}>{variant.name}: {variant.views} views · {variant.conversions} conversões</p>)}<button onClick={() => void toggleExperiment(experiment.id, experiment.status === "running" ? "paused" : "running")}>{experiment.status === "running" ? "Pausar" : "Iniciar"}</button></article>)}</div> : <Empty icon="A/B" title="Nenhum teste criado" text="Publique duas versões da mesma página para comparar." />}</section>
      <section className="panel danger-zone"><span className="eyebrow">OPERAÇÃO</span><h2>Backup, restauração e remoção</h2><p>Comandos locais possuem confirmação explícita e nunca incluem secrets:</p><div className="command-row"><code>npm run backup</code><code>npm run restore -- "pasta"</code><code>npm run uninstall</code></div></section>
    </>
  );
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}
