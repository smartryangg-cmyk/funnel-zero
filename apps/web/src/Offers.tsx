import { useEffect, useState, type FormEvent } from "react";
import type { OfferSummary } from "../../../packages/shared/src/schemas";
import { api, ApiError } from "./api";
import { Empty, Modal, Notice, PageHeader, StatusPill, navigate } from "./ui";

export function Offers() {
  const [offers, setOffers] = useState<OfferSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<OfferSummary | null>(null);
  const [deletingId, setDeletingId] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try {
      setOffers((await api.offers()).offers);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao carregar ofertas.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function changeStatus(offer: OfferSummary, status: OfferSummary["status"]) {
    try {
      await api.updateOffer(offer.id, { status });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao atualizar.");
    }
  }

  async function removeOffer(offer: OfferSummary) {
    const warning = [
      `Excluir a oferta "${offer.name}"?`,
      `${offer.funnelCount} funil(is) e ${offer.pageCount} página(s) serão preservados como rascunho, mas perderão o vínculo com a oferta.`,
      "Pixels, checkout e segredos desta oferta serão removidos."
    ].join("\n\n");
    if (!confirm(warning)) return;
    setDeletingId(offer.id);
    setError("");
    try {
      await api.deleteOffer(offer.id);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao excluir oferta.");
    } finally {
      setDeletingId("");
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Ofertas"
        title="O que você quer validar?"
        subtitle="Agrupe funis, páginas, checkout e pixels por oferta."
        actions={<button className="button primary" onClick={() => setCreating(true)}>+ Nova oferta</button>}
      />
      {error && <Notice tone="error">{error}</Notice>}
      {loading ? <div className="panel skeleton tall" /> : offers.length === 0 ? (
        <section className="panel"><Empty icon="◫" title="Crie sua primeira oferta" text="Ela será o contêiner para o funil, a VSL, as integrações e as métricas." action={<button className="button primary" onClick={() => setCreating(true)}>Criar oferta</button>} /></section>
      ) : (
        <section className="cards-list">
          {offers.map((offer) => (
            <article className="entity-card" key={offer.id}>
              <div className="entity-icon">◫</div>
              <div className="entity-main">
                <div className="entity-title"><h2>{offer.name}</h2><StatusPill status={offer.status} /></div>
                <p>/o/{offer.slug} · {offer.funnelCount} funil(is) · {offer.pageCount} página(s)</p>
                <div className="entity-tags">
                  <span>{offer.checkoutUrl ? "Checkout conectado" : "Checkout pendente"}</span>
                  <span>{Object.values(offer.pixelConfig).some(Boolean) ? "Pixels configurados" : "Pixels pendentes"}</span>
                </div>
              </div>
              <div className="entity-actions">
                <button className="button secondary" onClick={() => navigate(`/funnels?offer=${offer.id}`)}>Abrir funis</button>
                <button className="button ghost" onClick={() => setEditing(offer)}>Editar</button>
                {offer.status !== "active" ? (
                  <button className="button ghost" onClick={() => void changeStatus(offer, "active")}>Ativar</button>
                ) : (
                  <button className="button ghost" onClick={() => void changeStatus(offer, "archived")}>Arquivar</button>
                )}
                <button
                  className="button danger"
                  disabled={deletingId === offer.id}
                  onClick={() => void removeOffer(offer)}
                >
                  {deletingId === offer.id ? "Excluindo…" : "Excluir"}
                </button>
              </div>
            </article>
          ))}
        </section>
      )}
      {creating && <OfferForm title="Nova oferta" onClose={() => setCreating(false)} onSaved={async () => { setCreating(false); await load(); }} />}
      {editing && <OfferForm title="Editar oferta" offer={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); }} />}
    </>
  );
}

function OfferForm({
  title,
  offer,
  onClose,
  onSaved
}: {
  title: string;
  offer?: OfferSummary;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(offer?.name ?? "");
  const [slug, setSlug] = useState(offer?.slug ?? "");
  const [checkoutUrl, setCheckoutUrl] = useState(offer?.checkoutUrl ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      if (offer) await api.updateOffer(offer.id, { name, slug, checkoutUrl });
      else await api.createOffer({ name, slug: slug || undefined, checkoutUrl: checkoutUrl || undefined });
      await onSaved();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form className="form" onSubmit={(event) => void submit(event)}>
        <label className="field"><span>Nome</span><input required maxLength={160} value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Método Próxima Série" /></label>
        <label className="field"><span>Slug público</span><input maxLength={80} value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="Gerado automaticamente" /></label>
        <label className="field"><span>Checkout externo</span><input type="url" value={checkoutUrl} onChange={(event) => setCheckoutUrl(event.target.value)} placeholder="https://checkout.exemplo.com" /></label>
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary" disabled={saving}>{saving ? "Salvando…" : "Salvar oferta"}</button></div>
      </form>
    </Modal>
  );
}
