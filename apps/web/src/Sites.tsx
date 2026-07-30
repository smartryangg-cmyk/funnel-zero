import { useEffect, useState, type FormEvent } from "react";
import type { PageSummary } from "../../../packages/shared/src/schemas";
import { api } from "./api";
import { Empty, Modal, Notice, PageHeader, StatusPill, navigate } from "./ui";

export function Sites() {
  const [sites, setSites] = useState<PageSummary[]>([]);
  const [showCreate, setShowCreate] = useState(new URLSearchParams(location.search).get("new") === "1");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");

  async function load() {
    try {
      setSites((await api.pages()).pages);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Não foi possível carregar os sites.");
    }
  }
  useEffect(() => { void load(); }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy("create");
    try {
      const result = await api.createPage({ name, pageType: "site" });
      setShowCreate(false);
      setName("");
      navigate(`/sites/${result.page.id}/edit`);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Não foi possível criar o site.");
    } finally {
      setBusy("");
    }
  }

  async function publish(site: PageSummary) {
    setBusy(site.id);
    try {
      const result = await api.publishPage(site.id);
      setMessage("Site publicado com sucesso.");
      await load();
      window.open(result.publicUrl, "_blank", "noopener,noreferrer");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Não foi possível publicar.");
    } finally {
      setBusy("");
    }
  }

  async function remove(site: PageSummary) {
    if (!confirm(`Excluir "${site.name}"?`)) return;
    setBusy(site.id);
    try {
      await api.deletePage(site.id);
      await load();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Não foi possível excluir.");
    } finally {
      setBusy("");
    }
  }

  return <>
    <PageHeader eyebrow="Sites" title="Hospedagem de sites" subtitle="Crie, publique e conecte seu domínio." actions={<><button className="button secondary" onClick={() => navigate("/assistant?prompt=clone")}>Clonar com IA</button><button className="button primary" onClick={() => setShowCreate(true)}>+ Novo site</button></>} />
    {message && <Notice tone={message.includes("sucesso") ? "success" : "warning"}>{message}</Notice>}
    <section className="panel v5-list-panel">
      <div className="panel-header"><div><span className="eyebrow">SEUS SITES</span><h2>{sites.length} site(s)</h2></div></div>
      {!sites.length ? <Empty icon="□" title="Nenhum site ainda" text="Crie do zero ou peça ao assistente para clonar uma página." action={<button className="button primary" onClick={() => setShowCreate(true)}>Criar site</button>} /> :
        <div className="v5-site-list">{sites.map((site) => <article key={site.id}>
          <div className="v5-site-thumb"><span>{site.name.slice(0, 1).toUpperCase()}</span></div>
          <div className="v5-site-copy"><strong>{site.name}</strong><small>{site.publicUrl ?? `krano.site/s/${site.slug}`}</small></div>
          <StatusPill status={site.isLive ? "active" : "draft"} />
          <div className="v5-row-actions">
            {site.publicUrl && <a className="button ghost" href={site.publicUrl} target="_blank" rel="noreferrer">Abrir</a>}
            <button className="button secondary" onClick={() => navigate(`/sites/${site.id}/edit`)}>Editar</button>
            {!site.isLive && <button className="button primary" disabled={busy === site.id} onClick={() => void publish(site)}>Publicar</button>}
            <button className="icon-danger" aria-label={`Excluir ${site.name}`} onClick={() => void remove(site)}>×</button>
          </div>
        </article>)}</div>}
    </section>
    {showCreate && <Modal title="Novo site" onClose={() => setShowCreate(false)}><form className="modal-form" onSubmit={(event) => void create(event)}><label className="field"><span>Nome do site</span><input autoFocus required minLength={2} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="Minha página" /></label><button className="button primary full" disabled={busy === "create"}>{busy ? "Criando…" : "Criar site"}</button></form></Modal>}
  </>;
}
