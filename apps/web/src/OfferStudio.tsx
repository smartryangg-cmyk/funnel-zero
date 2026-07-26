import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { FunnelSummary, OfferSummary, PageSummary } from "../../../packages/shared/src/schemas";
import { api } from "./api";
import { Empty, Modal, Notice, PageHeader, StatusPill, navigate } from "./ui";

export function OfferStudio() {
  const params = new URLSearchParams(location.search);
  const requestedNewOffer = params.get("new") === "1";
  const [offers, setOffers] = useState<OfferSummary[]>([]);
  const [funnels, setFunnels] = useState<FunnelSummary[]>([]);
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [editing, setEditing] = useState<OfferSummary | null | "new">(
    requestedNewOffer ? "new" : null
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const focusOffer = params.get("offer");

  async function load() {
    setLoading(true);
    try {
      const [offerResult, funnelResult, pageResult] = await Promise.all([
        api.offers(), api.funnels(), api.pages()
      ]);
      setOffers(offerResult.offers);
      setFunnels(funnelResult.funnels);
      setPages(pageResult.pages);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao abrir a central de ofertas.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (requestedNewOffer) setEditing("new");
  }, [requestedNewOffer]);

  const orderedOffers = useMemo(() => focusOffer
    ? [...offers].sort(
        (left, right) =>
          Number(right.id === focusOffer) - Number(left.id === focusOffer)
      )
    : offers, [offers, focusOffer]);

  async function createFunnel(offer: OfferSummary) {
    try {
      const result = await api.createFunnel({ name: `${offer.name} — Funil principal`, offerId: offer.id });
      navigate(`/funnels/${result.funnel.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao criar o funil.");
    }
  }

  async function removeOffer(offer: OfferSummary) {
    if (!confirm(`Excluir a oferta "${offer.name}"?\n\nPáginas e funis serão preservados como rascunho, mas rastreamento, checkout e segredos da oferta serão removidos.`)) return;
    try {
      await api.deleteOffer(offer.id);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao excluir oferta.");
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Ofertas e funis"
        title="Cada oferta é um espaço de trabalho completo."
        subtitle="Mapa do funil, páginas, rastreamento e checkout no mesmo lugar."
        actions={<button className="button primary" onClick={() => setEditing("new")}>+ Nova oferta</button>}
      />
      {error && <Notice tone="error">{error}</Notice>}
      {loading ? <div className="panel skeleton tall" /> : !offers.length ? (
        <section className="panel"><Empty icon="◫" title="Crie sua primeira oferta" text="Depois você adiciona o funil, os cards das páginas, Meta, GA4 e checkout." action={<button className="button primary" onClick={() => setEditing("new")}>Criar oferta</button>} /></section>
      ) : (
        <section className="offer-workspaces">
          {orderedOffers.map((offer) => {
            const offerFunnels = funnels.filter((funnel) => funnel.offerId === offer.id);
            const offerPages = pages.filter((page) => page.offerId === offer.id);
            const metaReady = typeof offer.pixelConfig.metaPixelId === "string" && Boolean(offer.pixelConfig.metaPixelId);
            const ga4Ready = typeof offer.pixelConfig.ga4Id === "string" && Boolean(offer.pixelConfig.ga4Id);
            return (
              <article className={`offer-workspace ${focusOffer === offer.id ? "focused" : ""}`} key={offer.id}>
                <header className="offer-workspace-header">
                  <div className="offer-workspace-title"><span>◫</span><div><small>OFERTA</small><h2>{offer.name}</h2><p>/o/{offer.slug}</p></div><StatusPill status={offer.status} /></div>
                  <div className="offer-workspace-actions"><button className="button secondary" onClick={() => setEditing(offer)}>Configurar oferta</button><button className="button danger" onClick={() => void removeOffer(offer)}>Excluir</button></div>
                </header>
                <div className="offer-command-grid">
                  <section className="offer-area funnel-area">
                    <div className="offer-area-header"><div><span className="area-icon">⇢</span><div><strong>Mapa do funil</strong><small>Organize o caminho do lead</small></div></div><button onClick={() => void createFunnel(offer)}>+ Novo funil</button></div>
                    {offerFunnels.length ? <div className="inline-funnels">{offerFunnels.map((funnel) => <button key={funnel.id} onClick={() => navigate(`/funnels/${funnel.id}`)}><span>{funnel.graph.nodes.length}</span><div><strong>{funnel.name}</strong><small>{funnel.graph.nodes.length} etapas · {funnel.status}</small></div><b>Editar →</b></button>)}</div> : <MiniEmpty text="Nenhum mapa criado." action="Criar funil" onClick={() => void createFunnel(offer)} />}
                  </section>
                  <section className="offer-area pages-area">
                    <div className="offer-area-header"><div><span className="area-icon">▦</span><div><strong>Páginas do funil</strong><small>Cada card é uma página publicável</small></div></div><button onClick={() => navigate(`/pages?offer=${offer.id}${offerFunnels.length === 1 ? `&funnel=${offerFunnels[0].id}` : ""}&create=1`)}>+ Nova página</button></div>
                    {offerPages.length ? <div className="inline-pages">{offerPages.map((page) => <article key={page.id}><div><span className={`page-live-dot ${page.isLive ? "online" : ""}`} /><StatusPill status={page.status} /></div><strong>{page.name}</strong><small>{page.pageType} · revisão {page.revision}</small><div><button onClick={() => navigate(`/pages/${page.id}/edit`)}>Construir</button>{page.publicUrl && <a href={page.publicUrl} target="_blank" rel="noreferrer">Abrir ↗</a>}</div></article>)}</div> : <MiniEmpty text="Nenhuma página nesta oferta." action="Criar página" onClick={() => navigate(`/pages?offer=${offer.id}${offerFunnels.length === 1 ? `&funnel=${offerFunnels[0].id}` : ""}&create=1`)} />}
                  </section>
                </div>
                <footer className="offer-integrations">
                  <button onClick={() => navigate(`/tracking?offer=${offer.id}`)}><span>◎</span><div><strong>Rastreamento</strong><small>Meta {metaReady ? "conectada" : "pendente"} · GA4 {ga4Ready ? "conectado" : "pendente"}</small></div><b>Configurar →</b></button>
                  <button onClick={() => navigate(`/settings?offer=${offer.id}#checkout`)}><span>↗</span><div><strong>Checkout e conversões</strong><small>{offer.checkoutUrl ? "Destino conectado" : "Aguardando URL do checkout"}</small></div><b>Configurar →</b></button>
                  <button onClick={() => navigate(`/dashboard?offer=${offer.id}`)}><span>⌁</span><div><strong>Métricas</strong><small>Conversão, retenção e vazamentos</small></div><b>Analisar →</b></button>
                </footer>
              </article>
            );
          })}
        </section>
      )}
      {editing && <OfferWorkspaceForm offer={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); }} />}
    </>
  );
}

function OfferWorkspaceForm({ offer, onClose, onSaved }: { offer?: OfferSummary; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(offer?.name ?? "");
  const [slug, setSlug] = useState(offer?.slug ?? "");
  const [checkoutUrl, setCheckoutUrl] = useState(offer?.checkoutUrl ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      if (offer) await api.updateOffer(offer.id, { name, slug, checkoutUrl });
      else await api.createOffer({ name, slug: slug || undefined, checkoutUrl: checkoutUrl || undefined });
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao salvar oferta.");
    } finally {
      setSaving(false);
    }
  }
  return <Modal title={offer ? "Configurar oferta" : "Nova oferta"} onClose={onClose}><form className="form" onSubmit={(event) => void submit(event)}><label className="field"><span>Nome da oferta</span><input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Método Próxima Série" /></label><label className="field"><span>Endereço amigável</span><input value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="Gerado automaticamente" /></label><label className="field"><span>URL do checkout (opcional)</span><input type="url" value={checkoutUrl} onChange={(event) => setCheckoutUrl(event.target.value)} placeholder="https://checkout.exemplo.com" /></label>{error && <p className="form-error">{error}</p>}<div className="form-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary" disabled={saving}>{saving ? "Salvando…" : "Salvar oferta"}</button></div></form></Modal>;
}

function MiniEmpty({ text, action, onClick }: { text: string; action: string; onClick: () => void }) {
  return <div className="mini-empty"><span>＋</span><p>{text}</p><button onClick={onClick}>{action}</button></div>;
}
