import { useEffect, useState, type FormEvent } from "react";
import type {
  DomainProviderStatus,
  DomainSummary,
  PageSummary
} from "../../../packages/shared/src/schemas";
import { api } from "./api";
import { Empty, Notice, PageHeader, StatusPill, navigate } from "./ui";

interface CloudflareZone {
  id: string;
  name: string;
  status: string;
  nameServers: string[];
}

export function Domains() {
  const [provider, setProvider] = useState<DomainProviderStatus | null>(null);
  const [zones, setZones] = useState<CloudflareZone[]>([]);
  const [message, setMessage] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showTokenConnect, setShowTokenConnect] = useState(false);

  async function load() {
    try {
      const [domainResult, zoneResult] = await Promise.all([api.domains(), api.domainZones()]);
      setProvider(domainResult.provider);
      setZones(zoneResult.zones);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Falha ao carregar os domínios.");
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("cloudflare") === "connected") {
      setMessage("Cloudflare conectada. Seus domínios já estão disponíveis na KRANO.");
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
    if (!confirm("Desconectar a KRANO da Cloudflare? Os endereços publicados continuarão no ar, mas não poderão ser alterados aqui.")) return;
    try {
      const result = await api.disconnectCloudflare();
      setMessage(result.warning ?? "Cloudflare desconectada com segurança.");
      await load();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Falha ao desconectar.");
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Integrações / Cloudflare / Domínios"
        title="Domínios-base da sua operação."
        subtitle="Aqui ficam os domínios comprados e as zonas DNS. Os endereços como oferta.seudominio.com ficam separados em Subdomínios."
        actions={<button className="button primary" onClick={() => setShowImport(true)} disabled={!provider?.connected}>+ Adicionar domínio</button>}
      />
      {message && <Notice tone={message.includes("Falha") || message.includes("não") ? "warning" : "success"}>{message}</Notice>}

      <section className="settings-grid">
        <article className={`panel cloudflare-connect-card ${provider?.connected ? "connected" : ""}`}>
          <div className="panel-header">
            <div className="provider-title"><span className="cloudflare-mark">C</span><div><span className="eyebrow">INFRAESTRUTURA</span><h2>Cloudflare</h2></div></div>
            <StatusPill status={provider?.connected ? "active" : "pending"} />
          </div>
          {provider?.connected ? (
            <>
              <div className="connection-summary"><strong>Conta conectada</strong><span>{provider.accountName || "Conta Cloudflare autorizada"}</span><small>{provider.ready ? "Pronta para gerenciar DNS e publicação" : "Finalizando a conexão segura…"}</small></div>
              <div className="permission-chips"><span>Ver zonas</span><span>Importar domínio</span><span>Publicar subdomínio</span><span>SSL automático</span></div>
              {!provider.zoneImportReady && <button className="button primary full" onClick={() => void connectCloudflare()} disabled={connecting}>{connecting ? "Abrindo Cloudflare…" : "Atualizar permissão de domínios"}</button>}
              {provider.guidedTokenAvailable && <button className="button ghost" onClick={() => setShowTokenConnect(true)}>Trocar autorização</button>}
              <button className="button secondary" onClick={() => void disconnectCloudflare()}>Desconectar</button>
            </>
          ) : (
            <>
              <h3>Conecte uma vez. O resto fica na KRANO.</h3>
              <p className="provider-copy">A autorização abre na própria Cloudflare e mostra as permissões. Sua senha nunca passa pela KRANO.</p>
              <ul className="permission-list"><li><span>✓</span>Encontrar seus domínios</li><li><span>✓</span>Publicar somente endereços escolhidos</li><li><span>✓</span>Manter a conexão revogável</li></ul>
              <button className="button primary cloudflare-button" onClick={() => void connectCloudflare()} disabled={connecting || (!provider?.oauthAvailable && !provider?.guidedTokenAvailable)}>{connecting ? "Abrindo Cloudflare…" : "Conectar KRANO à Cloudflare"}</button>
              {!provider?.oauthAvailable && provider?.guidedTokenAvailable && <small className="connection-help">A tela oficial abrirá com as permissões necessárias já selecionadas.</small>}
            </>
          )}
        </article>

        <article className="panel domain-definition-card">
          <span className="eyebrow">ORGANIZAÇÃO</span>
          <h2>Domínio não é subdomínio</h2>
          <dl>
            <div><dt>Domínio</dt><dd>seudominio.com</dd></div>
            <div><dt>Subdomínio</dt><dd>oferta.seudominio.com</dd></div>
          </dl>
          <p>Primeiro o domínio entra nesta tela. Depois você cria quantos subdomínios precisar e aponta cada um para um funil.</p>
          <button className="button secondary" onClick={() => navigate("/domains/subdomains")}>Gerenciar subdomínios</button>
        </article>
      </section>

      <section className="panel">
        <div className="panel-header"><div><span className="eyebrow">DOMÍNIOS</span><h2>Zonas DNS conectadas</h2></div><span className="muted">{zones.length} encontrado(s)</span></div>
        {!zones.length ? (
          <Empty icon="◇" title="Nenhum domínio conectado" text={provider?.connected ? "Adicione um domínio comprado fora ou ative uma zona existente na Cloudflare." : "Conecte a Cloudflare acima para listar os domínios da conta."} />
        ) : (
          <div className="domain-zone-grid">
            {zones.map((zone) => (
              <article key={zone.id}>
                <span className={`domain-health ${zone.status === "active" ? "online" : ""}`} />
                <div><strong>{zone.name}</strong><small>{zone.status === "active" ? "DNS ativo" : "Aguardando ativação"}</small></div>
                <StatusPill status={zone.status === "active" ? "active" : "pending"} />
                <button className="button ghost" disabled={zone.status !== "active"} onClick={() => navigate(`/domains/subdomains?zone=${encodeURIComponent(zone.id)}`)}>Criar subdomínio →</button>
              </article>
            ))}
          </div>
        )}
      </section>

      {showImport && provider && (
        <ImportDomain
          canImport={provider.zoneImportReady}
          onAuthorize={connectCloudflare}
          onClose={() => setShowImport(false)}
          onSaved={async (name) => {
            setShowImport(false);
            setMessage(`${name} foi preparado. Conclua a troca de DNS indicada e depois verifique novamente.`);
            await load();
          }}
        />
      )}
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

export function Subdomains() {
  const [provider, setProvider] = useState<DomainProviderStatus | null>(null);
  const [domains, setDomains] = useState<DomainSummary[]>([]);
  const [sites, setSites] = useState<PageSummary[]>([]);
  const [zones, setZones] = useState<CloudflareZone[]>([]);
  const [message, setMessage] = useState("");
  const [showAttach, setShowAttach] = useState(false);

  async function load() {
    try {
      const [domainResult, siteResult, zoneResult] = await Promise.all([
        api.domains(),
        api.pages(),
        api.domainZones()
      ]);
      setProvider(domainResult.provider);
      setDomains(domainResult.domains);
      setSites(siteResult.pages);
      setZones(zoneResult.zones);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Falha ao carregar os subdomínios.");
    }
  }

  useEffect(() => { void load(); }, []);

  async function sync() {
    try {
      const result = await api.syncDomains();
      setMessage(`${result.activeCount} endereço(s) ativo(s)${result.validatingCount ? ` e ${result.validatingCount} preparando SSL` : ""}.`);
      await load();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Falha ao verificar os endereços.");
    }
  }

  async function remove(domain: DomainSummary) {
    if (!confirm(`Remover ${domain.hostname} da KRANO?`)) return;
    try {
      await api.detachDomain(domain.id, domain.hostname);
      setMessage("Subdomínio removido do Worker.");
      await load();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Falha ao remover.");
    }
  }

  const activeZones = zones.filter((zone) => zone.status === "active");
  return (
    <>
      <PageHeader
        eyebrow="Integrações / Cloudflare / Subdomínios"
        title="Um endereço para cada funil."
        subtitle="Escolha um endereço e o site que deve abrir."
        actions={<><button className="button secondary" onClick={() => void sync()} disabled={!provider?.ready}>Verificar SSL</button><button className="button primary" onClick={() => setShowAttach(true)} disabled={!provider?.ready || !activeZones.length}>+ Criar subdomínio</button></>}
      />
      {message && <Notice tone={message.includes("Falha") || message.includes("não") ? "warning" : "success"}>{message}</Notice>}
      {!provider?.ready && <Notice><strong>Conecte a Cloudflare primeiro</strong><p>A autorização e os domínios-base ficam na tela Domínios.</p><button className="button secondary" onClick={() => navigate("/domains")}>Abrir Domínios</button></Notice>}
      {provider?.ready && !activeZones.length && <Notice><strong>Nenhum domínio ativo</strong><p>Adicione ou ative um domínio antes de criar subdomínios.</p><button className="button secondary" onClick={() => navigate("/domains")}>Adicionar domínio</button></Notice>}

      <section className="subdomain-stats">
        <article><small>Endereços publicados</small><strong>{domains.length}</strong></article>
        <article><small>SSL ativo</small><strong>{domains.filter((domain) => domain.certIssued).length}</strong></article>
        <article><small>Em validação</small><strong>{domains.filter((domain) => domain.status !== "active").length}</strong></article>
      </section>

      <section className="panel">
        <div className="panel-header"><div><span className="eyebrow">SUBDOMÍNIOS</span><h2>Publicados pela KRANO</h2></div></div>
        {!domains.length ? (
          <Empty icon="◇" title="Nenhum subdomínio publicado" text="Escolha um domínio ativo, dê um nome ao endereço e selecione o funil que deve abrir." />
        ) : (
          <div className="table-list">
            {domains.map((domain) => (
              <div key={domain.id}>
                <div><a className="domain-link" href={`https://${domain.hostname}`} target="_blank" rel="noreferrer">{domain.hostname} ↗</a><small>{domain.siteName ?? "Sem site associado"} · {domain.certIssued === false ? "SSL preparando" : "SSL ativo"}</small></div>
                <StatusPill status={domain.status} />
                <button className="danger-text" onClick={() => void remove(domain)}>Remover</button>
              </div>
            ))}
          </div>
        )}
      </section>
      {showAttach && <AttachSubdomain zones={activeZones} sites={sites} onClose={() => setShowAttach(false)} onSaved={async () => { setShowAttach(false); setMessage("Subdomínio enviado para publicação e SSL."); await load(); }} />}
    </>
  );
}

function ImportDomain({
  canImport,
  onAuthorize,
  onClose,
  onSaved
}: {
  canImport: boolean;
  onAuthorize: () => Promise<void>;
  onClose: () => void;
  onSaved: (name: string) => Promise<void>;
}) {
  const [domain, setDomain] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [imported, setImported] = useState<CloudflareZone | null>(null);

  async function submit() {
    setSaving(true);
    setError("");
    try {
      const result = await api.importDomain(domain);
      setImported(result.zone);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao importar o domínio.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="modal domain-wizard" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span className="eyebrow">DOMÍNIO-BASE</span><h2>Adicionar domínio</h2></div><button onClick={onClose}>×</button></header>
        {!canImport ? (
          <Notice><strong>Atualização de permissão necessária</strong><p>A Cloudflare abrirá a tela oficial para autorizar a importação de domínios.</p><button className="button primary full" onClick={() => void onAuthorize()}>Atualizar permissão</button></Notice>
        ) : !imported ? (
          <div className="form external-domain-flow">
            <label className="field"><span>Domínio comprado na Hostinger ou outro registrador</span><input value={domain} onChange={(event) => setDomain(event.target.value.toLowerCase().trim())} placeholder="seudominio.com.br" /></label>
            {error && <p className="form-error">{error}</p>}
            <button className="button primary full" disabled={!domain || saving} onClick={() => void submit()}>{saving ? "Preparando…" : "Preparar domínio na KRANO"}</button>
          </div>
        ) : (
          <div className="nameserver-guide">
            <span className="eyebrow">ÚNICO PASSO NO REGISTRADOR</span>
            <h3>Troque os servidores DNS de {imported.name}</h3>
            <p>A compra continua no provedor atual. Copie estes endereços na área “Servidores DNS” ou “Nameservers”.</p>
            {imported.nameServers.map((server) => <code key={server} onClick={() => void navigator.clipboard.writeText(server)}>{server}<span>copiar</span></code>)}
            <small>Depois que a Cloudflare ativar o domínio, a KRANO poderá criar os subdomínios e o SSL automaticamente.</small>
            <button className="button primary full" onClick={() => void onSaved(imported.name)}>Concluir</button>
          </div>
        )}
        <div className="form-actions"><button className="button ghost" onClick={onClose}>Fechar</button></div>
      </section>
    </div>
  );
}

function AttachSubdomain({
  zones,
  sites,
  onClose,
  onSaved
}: {
  zones: CloudflareZone[];
  sites: PageSummary[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const requestedZone = new URLSearchParams(location.search).get("zone") ?? "";
  const [zoneId, setZoneId] = useState(zones.some((zone) => zone.id === requestedZone) ? requestedZone : zones[0]?.id ?? "");
  const [subdomain, setSubdomain] = useState("oferta");
  const [siteId, setSiteId] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const zone = zones.find((item) => item.id === zoneId);
  const hostname = zone && subdomain ? `${subdomain}.${zone.name}` : "";
  const publishedSites = sites.filter((site) => site.isLive);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!hostname || !siteId) return;
    setSaving(true);
    setError("");
    try {
      await api.attachDomain({ hostname, siteId, isPrimary: true });
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao publicar o subdomínio.");
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="modal domain-wizard" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span className="eyebrow">PUBLICAÇÃO GUIADA</span><h2>Criar subdomínio</h2></div><button onClick={onClose}>×</button></header>
        <form className="form" onSubmit={(event) => void submit(event)}>
          <div className="domain-composer">
            <label className="field"><span>Nome do subdomínio</span><input required value={subdomain} onChange={(event) => setSubdomain(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/^-+/, ""))} placeholder="oferta" /></label>
            <span className="domain-dot">.</span>
            <label className="field"><span>Domínio-base</span><select required value={zoneId} onChange={(event) => setZoneId(event.target.value)}>{zones.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          </div>
          <div className="domain-preview"><small>O endereço ficará assim</small><strong>https://{hostname || "nome.seudominio.com"}</strong></div>
          <label className="field"><span>Qual site deve abrir?</span><select required value={siteId} onChange={(event) => setSiteId(event.target.value)}><option value="">Escolha um site publicado</option>{publishedSites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
          <div className="automatic-steps"><span>✓ DNS automático</span><span>✓ SSL automático</span><span>✓ Sem novo deploy</span></div>
          {!publishedSites.length && <Notice><strong>Publique um site primeiro</strong><p>O subdomínio precisa apontar para um site no ar.</p></Notice>}
          {error && <p className="form-error">{error}</p>}
          <div className="form-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary" disabled={!hostname || !siteId || saving}>{saving ? "Publicando…" : "Publicar subdomínio"}</button></div>
        </form>
      </section>
    </div>
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
          <li><span>1</span><div><strong>Abra a tela oficial</strong><p>As permissões mínimas já estarão selecionadas.</p></div></li>
          <li><span>2</span><div><strong>Crie e copie o token</strong><p>A Cloudflare mostra o código uma única vez.</p></div></li>
          <li><span>3</span><div><strong>Cole abaixo</strong><p>O código é validado e guardado somente como secret do Worker.</p></div></li>
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
