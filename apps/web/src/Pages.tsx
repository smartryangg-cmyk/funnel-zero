import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent
} from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type {
  AssetSummary,
  FunnelSummary,
  OfferSummary,
  PageBlock,
  PageBlockType,
  PageDocument,
  PageSummary,
  PageVersionSummary,
  TemplateSummary
} from "../../../packages/shared/src/schemas";
import { api, ApiError } from "./api";
import { Empty, Modal, Notice, PageHeader, StatusPill, navigate } from "./ui";

export function Pages({ editorId }: { editorId?: string }) {
  return editorId ? <PageEditor key={editorId} id={editorId} /> : <PageList />;
}

function PageList() {
  const params = new URLSearchParams(location.search);
  const requestedOfferId = params.get("offer") ?? "";
  const requestedFunnelId = params.get("funnel") ?? "";
  const shouldCreate = params.get("create") === "1";
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [offers, setOffers] = useState<OfferSummary[]>([]);
  const [funnels, setFunnels] = useState<FunnelSummary[]>([]);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [creating, setCreating] = useState(shouldCreate);
  const [deletingId, setDeletingId] = useState("");
  const [error, setError] = useState("");
  async function load() {
    try {
      const [pageResult, offerResult, templateResult] = await Promise.all([
        api.pages(requestedOfferId || undefined),
        api.offers(),
        api.templates()
      ]);
      const funnelResult = await api.funnels(requestedOfferId || undefined);
      setPages(pageResult.pages);
      setOffers(offerResult.offers);
      setFunnels(funnelResult.funnels);
      setTemplates(templateResult.templates);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao carregar páginas.");
    }
  }
  // A troca de contexto pela URL mantém a central sincronizada com a oferta escolhida.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [requestedOfferId]);
  useEffect(() => {
    if (shouldCreate) setCreating(true);
  }, [shouldCreate, requestedOfferId, requestedFunnelId]);

  function closeCreate() {
    setCreating(false);
    if (!shouldCreate) return;
    const nextUrl = new URL(location.href);
    nextUrl.searchParams.delete("create");
    history.replaceState({}, "", `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
  }
  async function removePage(page: PageSummary) {
    if (!confirm(`Excluir a página "${page.name}"?\n\nO rascunho e todas as versões publicadas serão removidos permanentemente.`)) return;
    setDeletingId(page.id);
    setError("");
    try {
      await api.deletePage(page.id);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao excluir página.");
    } finally {
      setDeletingId("");
    }
  }
  return (
    <>
      <PageHeader eyebrow="Páginas" title="Publique sem depender de terceiros." subtitle="Templates originais, editor por blocos, versões e URL dinâmica por oferta." actions={<button className="button primary" onClick={() => setCreating(true)}>+ Nova página</button>} />
      {error && <Notice tone="error">{error}</Notice>}
      {pages.length === 0 ? (
        <section className="panel"><Empty icon="▦" title="Nenhuma página criada" text="Comece com VSL, advertorial, quiz, captura ou obrigado." action={<button className="button primary" onClick={() => setCreating(true)}>Escolher template</button>} /></section>
      ) : (
        <section className="cards-list">
          {pages.map((page) => (
            <article className="entity-card" key={page.id}>
              <div className="entity-icon">▦</div>
              <div className="entity-main">
                <div className="entity-title"><h2>{page.name}</h2><StatusPill status={page.status} /></div>
                <p>{page.offerName ?? "Sem oferta"} · {page.pageType} · revisão {page.revision}</p>
                {page.publicUrl && <a className="public-link" href={page.publicUrl} target="_blank" rel="noreferrer">{page.publicUrl}</a>}
                {!page.isLive && page.status === "published" && <span className="publication-warning">{page.publicationIssue}</span>}
              </div>
              <div className="entity-actions">
                <button className="button secondary" onClick={() => navigate(`/pages/${page.id}/edit`)}>Editar</button>
                {page.publicUrl && <a className="button ghost" href={page.publicUrl} target="_blank" rel="noreferrer">Abrir ↗</a>}
                <button className="button danger" disabled={deletingId === page.id} onClick={() => void removePage(page)}>
                  {deletingId === page.id ? "Excluindo…" : "Excluir"}
                </button>
              </div>
            </article>
          ))}
        </section>
      )}
      {creating && (
        <CreatePage
          offers={offers}
          funnels={funnels}
          templates={templates}
          initialOfferId={requestedOfferId}
          initialFunnelId={requestedFunnelId}
          onClose={closeCreate}
          onCreated={(id) => navigate(`/pages/${id}/edit`)}
        />
      )}
    </>
  );
}

function CreatePage({
  offers,
  funnels,
  templates,
  initialOfferId,
  initialFunnelId,
  onClose,
  onCreated
}: {
  offers: OfferSummary[];
  funnels: FunnelSummary[];
  templates: TemplateSummary[];
  initialOfferId?: string;
  initialFunnelId?: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const initialFunnel = funnels.find((funnel) => funnel.id === initialFunnelId);
  const [offerId, setOfferId] = useState(
    initialFunnel?.offerId ?? initialOfferId ?? offers[0]?.id ?? ""
  );
  const [funnelId, setFunnelId] = useState(initialFunnel?.id ?? "");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [error, setError] = useState("");
  const initialContextApplied = useRef(false);
  const availableFunnels = useMemo(
    () => funnels.filter((funnel) => funnel.offerId === offerId),
    [funnels, offerId]
  );

  useEffect(() => {
    if (initialContextApplied.current) return;
    const requestedFunnel = initialFunnelId
      ? funnels.find((funnel) => funnel.id === initialFunnelId)
      : undefined;
    if (initialFunnelId && !requestedFunnel) return;
    const requestedOffer =
      requestedFunnel?.offerId ??
      initialOfferId ??
      offers[0]?.id;
    if (!requestedOffer) return;
    setOfferId(requestedOffer);
    setFunnelId(requestedFunnel?.id ?? "");
    initialContextApplied.current = true;
  }, [funnels, initialFunnelId, initialOfferId, offers]);

  useEffect(() => {
    if (!templateId && templates[0]) setTemplateId(templates[0].id);
  }, [templateId, templates]);

  useEffect(() => {
    if (funnelId && !availableFunnels.some((funnel) => funnel.id === funnelId)) {
      setFunnelId("");
    }
  }, [availableFunnels, funnelId]);

  function chooseOffer(nextOfferId: string) {
    setOfferId(nextOfferId);
    const matching = funnels.filter((funnel) => funnel.offerId === nextOfferId);
    setFunnelId(matching.length === 1 ? matching[0].id : "");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const template = templates.find((item) => item.id === templateId);
    try {
      const result = await api.createPage({
        name,
        offerId: offerId || null,
        funnelId: funnelId || null,
        pageType: template?.category ?? "sales",
        templateId: templateId || undefined
      });
      onCreated(result.page.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao criar página.");
    }
  }
  return (
    <Modal title="Criar página" onClose={onClose}>
      <form className="form" onSubmit={(event) => void submit(event)}>
        <label className="field"><span>Nome</span><input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: VSL principal" /></label>
        <label className="field"><span>Oferta</span><select required value={offerId} onChange={(event) => chooseOffer(event.target.value)}><option value="">Escolha</option>{offers.map((offer) => <option key={offer.id} value={offer.id}>{offer.name}</option>)}</select></label>
        <label className="field">
          <span>Etapa do funil</span>
          <select value={funnelId} onChange={(event) => setFunnelId(event.target.value)}>
            <option value="">Criar sem vincular a um funil</option>
            {availableFunnels.map((funnel) => (
              <option key={funnel.id} value={funnel.id}>{funnel.name}</option>
            ))}
          </select>
          <small>
            Ao escolher um funil, a página entra automaticamente em uma etapa livre do mapa.
          </small>
        </label>
        <div className="template-grid">
          {templates.map((template) => <button type="button" key={template.id} className={templateId === template.id ? "selected" : ""} onClick={() => setTemplateId(template.id)}><strong>{template.name}</strong><small>{template.category}</small></button>)}
        </div>
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary">Criar página</button></div>
      </form>
    </Modal>
  );
}

function PageEditor({ id }: { id: string }) {
  const [page, setPage] = useState<PageSummary | null>(null);
  const [doc, setDoc] = useState<PageDocument | null>(null);
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [versions, setVersions] = useState<PageVersionSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [device, setDevice] = useState<"desktop" | "tablet" | "mobile">("mobile");
  const [inspectorTab, setInspectorTab] = useState<"block" | "page">("block");
  const [message, setMessage] = useState("");
  const [publishedUrl, setPublishedUrl] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [saveState, setSaveState] = useState("Carregando…");
  const history = useRef<PageDocument[]>([]);
  const future = useRef<PageDocument[]>([]);
  const hydrated = useRef(false);
  const lastSaved = useRef("");
  const publishingRef = useRef(false);
  const pageRef = useRef<PageSummary | null>(null);
  const docRef = useRef<PageDocument | null>(null);
  const queuedSnapshot = useRef<PageDocument | null>(null);
  const saveLoop = useRef<Promise<PageSummary | null> | null>(null);
  const autosaveTimer = useRef<number | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  async function load() {
    try {
      const [pageResult, assetResult, versionResult] = await Promise.all([
        api.page(id), api.assets(), api.pageVersions(id)
      ]);
      setPage(pageResult.page);
      pageRef.current = pageResult.page;
      setDoc(pageResult.page.content);
      docRef.current = pageResult.page.content;
      lastSaved.current = JSON.stringify(pageResult.page.content);
      setAssets(assetResult.assets.filter((asset) => asset.uploadStatus === "ready"));
      setVersions(versionResult.versions);
      setSelectedId(pageResult.page.content.blocks[0]?.id ?? null);
      history.current = [];
      future.current = [];
      setTimeout(() => { hydrated.current = true; setSaveState("Tudo salvo"); }, 0);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Falha ao abrir editor.");
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { hydrated.current = false; void load(); }, [id]);

  const queueDraft = useCallback((snapshot: PageDocument): Promise<PageSummary | null> => {
    queuedSnapshot.current = structuredClone(snapshot);
    if (saveLoop.current) return saveLoop.current;

    const loop = (async () => {
      let latestPage = pageRef.current;
      while (queuedSnapshot.current) {
        const next = queuedSnapshot.current;
        queuedSnapshot.current = null;
        const serialized = JSON.stringify(next);
        if (serialized === lastSaved.current) continue;
        const currentPage = pageRef.current;
        if (!currentPage) return null;

        setSaveState("Salvando…");
        try {
          const result = await api.updatePage(currentPage.id, {
            content: next,
            revision: currentPage.revision
          });
          pageRef.current = result.page;
          latestPage = result.page;
          setPage(result.page);
          lastSaved.current = serialized;
          setSaveState(
            queuedSnapshot.current && JSON.stringify(queuedSnapshot.current) !== serialized
              ? "Alterações não salvas"
              : "Tudo salvo"
          );
        } catch (caught) {
          // Mantém sempre o snapshot mais recente para uma nova tentativa manual ou automática.
          queuedSnapshot.current ??= next;
          setSaveState(
            caught instanceof ApiError && caught.code === "REVISION_CONFLICT"
              ? "Conflito: recarregue"
              : "Falha ao salvar"
          );
          throw caught;
        }
      }
      return latestPage;
    })();
    saveLoop.current = loop;
    void loop.finally(() => {
      if (saveLoop.current === loop) saveLoop.current = null;
    }).catch(() => undefined);
    return loop;
  }, []);

  async function flushDraft(snapshot = docRef.current): Promise<PageSummary | null> {
    if (autosaveTimer.current !== null) {
      window.clearTimeout(autosaveTimer.current);
      autosaveTimer.current = null;
    }
    if (snapshot && JSON.stringify(snapshot) !== lastSaved.current) {
      return queueDraft(snapshot);
    }
    if (saveLoop.current) return saveLoop.current;
    if (queuedSnapshot.current) return queueDraft(queuedSnapshot.current);
    return pageRef.current;
  }

  useEffect(() => {
    docRef.current = doc;
    if (!hydrated.current || !doc || !pageRef.current || publishingRef.current) return;
    const serialized = JSON.stringify(doc);
    if (serialized === lastSaved.current) {
      setSaveState("Tudo salvo");
      return;
    }
    setSaveState("Alterações não salvas");
    if (autosaveTimer.current !== null) window.clearTimeout(autosaveTimer.current);
    autosaveTimer.current = window.setTimeout(() => {
      autosaveTimer.current = null;
      if (publishingRef.current) return;
      void queueDraft(doc).catch(() => undefined);
    }, 700);
    return () => {
      if (autosaveTimer.current !== null) {
        window.clearTimeout(autosaveTimer.current);
        autosaveTimer.current = null;
      }
    };
  }, [doc, queueDraft]);

  useEffect(() => {
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      const current = docRef.current;
      const dirty = current && JSON.stringify(current) !== lastSaved.current;
      if (!dirty && !queuedSnapshot.current && !saveLoop.current) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeUnload);
      const current = docRef.current;
      if (current && JSON.stringify(current) !== lastSaved.current) {
        void queueDraft(current).catch(() => undefined);
      }
    };
  }, [queueDraft]);

  function update(next: PageDocument, remember = true) {
    if (!doc) return;
    if (remember) {
      history.current.push(structuredClone(doc));
      if (history.current.length > 50) history.current.shift();
      future.current = [];
    }
    setDoc(next);
  }
  function undo() {
    if (!doc) return;
    const previous = history.current.pop();
    if (!previous) return;
    future.current.push(structuredClone(doc));
    setDoc(previous);
  }
  function redo() {
    if (!doc) return;
    const next = future.current.pop();
    if (!next) return;
    history.current.push(structuredClone(doc));
    setDoc(next);
  }
  function addBlock(type: PageBlockType) {
    if (!doc) return;
    const defaults: Record<PageBlockType, unknown> = {
      heading: "Novo título",
      paragraph: "Escreva sua mensagem aqui.",
      image: { assetId: "", src: "", alt: "" },
      video: { assetId: "", src: "", ctaAtSeconds: 10 },
      button: { label: "Continuar", href: "#checkout", revealAfterPitch: false },
      spacer: "",
      divider: "",
      leadForm: {
        label: "Quero receber",
        fields: { name: true, email: true, whatsapp: true }
      },
      quiz: {
        transitionMs: 250,
        questions: [{
          title: "Qual opção combina mais com você?",
          options: ["Opção A", "Opção B"]
        }]
      },
      html: "<strong>HTML limitado e sanitizado</strong>"
    };
    const block = { id: crypto.randomUUID(), type, content: defaults[type] };
    update({ ...doc, blocks: [...doc.blocks, block] });
    setSelectedId(block.id);
  }
  function updateBlock(idValue: string, content: unknown) {
    if (!doc) return;
    update({ ...doc, blocks: doc.blocks.map((block) => block.id === idValue ? { ...block, content } : block) });
  }
  function updateBlockSettings(idValue: string, settings: Record<string, unknown>) {
    if (!doc) return;
    update({
      ...doc,
      blocks: doc.blocks.map((block) => block.id === idValue ? { ...block, settings } : block)
    });
  }
  function duplicateBlock(idValue: string) {
    if (!doc) return;
    const index = doc.blocks.findIndex((block) => block.id === idValue);
    if (index < 0) return;
    const copy = { ...structuredClone(doc.blocks[index]), id: crypto.randomUUID() };
    const blocks = [...doc.blocks];
    blocks.splice(index + 1, 0, copy);
    update({ ...doc, blocks });
    setSelectedId(copy.id);
  }
  function deleteBlock(idValue: string) {
    if (!doc || !confirm("Excluir este bloco?")) return;
    update({ ...doc, blocks: doc.blocks.filter((block) => block.id !== idValue) });
    setSelectedId(doc.blocks.find((block) => block.id !== idValue)?.id ?? null);
  }
  function dragEnd(event: DragEndEvent) {
    if (!doc || !event.over || event.active.id === event.over.id) return;
    const from = doc.blocks.findIndex((item) => item.id === event.active.id);
    const to = doc.blocks.findIndex((item) => item.id === event.over?.id);
    update({ ...doc, blocks: arrayMove(doc.blocks, from, to) });
  }
  async function publish() {
    if (!doc || !page) return;
    publishingRef.current = true;
    setPublishing(true);
    setPublishedUrl("");
    try {
      setMessage("Publicando…");
      await flushDraft(doc);
      const result = await api.publishPage(id);
      setPage(result.page);
      pageRef.current = result.page;
      setVersions((await api.pageVersions(id)).versions);
      setPublishedUrl(result.publicUrl);
      setMessage(`Versão ${result.versionNumber} publicada e verificada no ar.`);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Falha ao publicar.");
    } finally {
      publishingRef.current = false;
      setPublishing(false);
      const latest = docRef.current;
      if (latest && JSON.stringify(latest) !== lastSaved.current) {
        void queueDraft(latest).catch(() => undefined);
      }
    }
  }
  async function removePage() {
    if (!page || !confirm(`Excluir a página "${page.name}"?\n\nO rascunho e todas as versões serão removidos permanentemente.`)) return;
    try {
      await api.deletePage(page.id);
      navigate("/pages");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Falha ao excluir página.");
    }
  }
  async function restore(versionId: string) {
    if (!confirm("Restaurar esta versão para o rascunho atual?")) return;
    const result = await api.restorePageVersion(id, versionId);
    setPage(result.page);
    pageRef.current = result.page;
    setDoc(result.page.content);
    docRef.current = result.page.content;
    lastSaved.current = JSON.stringify(result.page.content);
    setMessage("Versão restaurada no rascunho.");
  }

  const selected = doc?.blocks.find((block) => block.id === selectedId) ?? null;
  const previewStyle = useMemo(() => doc ? {
    "--preview-bg": doc.theme.background,
    "--preview-text": doc.theme.text,
    "--preview-accent": doc.theme.accent,
    "--preview-width": `${doc.theme.maxWidth ?? 920}px`,
    "--preview-align": doc.theme.contentAlign ?? "center",
    "--preview-radius": `${doc.theme.buttonRadius ?? 14}px`,
    "--preview-font": previewFont(doc.theme.font)
  } as CSSProperties : {}, [doc]);
  if (!page || !doc) return <><PageHeader eyebrow="Editor" title="Abrindo página…" subtitle="Carregando rascunho e versões." />{message && <Notice tone="error">{message}</Notice>}<div className="panel skeleton tall" /></>;

  return (
    <div className="editor-page">
      <PageHeader eyebrow="Editor profissional" title={page.name} subtitle={`${saveState} · revisão ${page.revision}`} actions={<><button className="button danger" onClick={() => void removePage()}>Excluir</button><button className="button ghost" onClick={undo} disabled={!history.current.length}>↶</button><button className="button ghost" onClick={redo} disabled={!future.current.length}>↷</button>{page.publicUrl && <a className="button secondary" target="_blank" rel="noreferrer" href={page.publicUrl}>Abrir ↗</a>}<button className="button primary" disabled={publishing} onClick={() => void publish()}>{publishing ? "Verificando…" : "Publicar"}</button></>} />
      {message && <Notice tone={message.includes("verificada") || message.includes("restaurada") ? "success" : "warning"}>{message}{publishedUrl && <> <a className="notice-link" href={publishedUrl} target="_blank" rel="noreferrer">Abrir página publicada ↗</a></>}</Notice>}
      <div className="editor-toolbar">
        <strong>Adicionar</strong>
        {(["heading", "paragraph", "image", "video", "button", "leadForm", "quiz", "divider", "spacer", "html"] as PageBlockType[]).map((type) => <button key={type} onClick={() => addBlock(type)}>+ {blockLabel(type)}</button>)}
        <span />
        <button className={device === "tablet" ? "active" : ""} onClick={() => setDevice("tablet")}>Tablet</button>
        <button className={device === "desktop" ? "active" : ""} onClick={() => setDevice("desktop")}>Desktop</button>
        <button className={device === "mobile" ? "active" : ""} onClick={() => setDevice("mobile")}>Mobile</button>
      </div>
      <div className="editor-layout">
        <aside className="blocks-panel">
          <div className="panel-title-line"><h3>Camadas</h3><small>{doc.blocks.length} blocos</small></div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd}>
            <SortableContext items={doc.blocks.map((block) => block.id)} strategy={verticalListSortingStrategy}>
              {doc.blocks.map((block) => <SortableBlock key={block.id} block={block} selected={selectedId === block.id} onSelect={() => { setSelectedId(block.id); setInspectorTab("block"); }} onDuplicate={() => duplicateBlock(block.id)} onDelete={() => deleteBlock(block.id)} />)}
            </SortableContext>
          </DndContext>
          <h3>Identidade visual</h3>
          <div className="theme-controls">
            <label>Fundo<input type="color" value={doc.theme.background} onChange={(event) => update({ ...doc, theme: { ...doc.theme, background: event.target.value } })} /></label>
            <label>Texto<input type="color" value={doc.theme.text} onChange={(event) => update({ ...doc, theme: { ...doc.theme, text: event.target.value } })} /></label>
            <label>Destaque<input type="color" value={doc.theme.accent} onChange={(event) => update({ ...doc, theme: { ...doc.theme, accent: event.target.value } })} /></label>
          </div>
          <label className="field compact"><span>Tipografia</span><select value={doc.theme.font ?? "inter"} onChange={(event) => update({ ...doc, theme: { ...doc.theme, font: event.target.value } })}><option value="inter">Inter / Sans</option><option value="editorial">Editorial / Serif</option><option value="system">Sistema</option><option value="rounded">Rounded</option></select></label>
          <label className="field compact"><span>Largura do conteúdo</span><input type="range" min={320} max={1200} step={20} value={doc.theme.maxWidth ?? 920} onChange={(event) => update({ ...doc, theme: { ...doc.theme, maxWidth: Number(event.target.value) } })} /><small>{doc.theme.maxWidth ?? 920}px</small></label>
          <label className="field compact"><span>Alinhamento padrão</span><select value={doc.theme.contentAlign ?? "center"} onChange={(event) => update({ ...doc, theme: { ...doc.theme, contentAlign: event.target.value as "left" | "center" | "right" } })}><option value="left">Esquerda</option><option value="center">Centro</option><option value="right">Direita</option></select></label>
          <label className="field compact"><span>Arredondamento dos botões</span><input type="range" min={0} max={40} value={doc.theme.buttonRadius ?? 14} onChange={(event) => update({ ...doc, theme: { ...doc.theme, buttonRadius: Number(event.target.value) } })} /></label>
        </aside>
        <section className="preview-stage">
          <div className={`page-preview ${device}`} style={previewStyle}>
            <div className="preview-safe-area">
              {doc.blocks.map((block) => <PreviewBlock key={block.id} block={block} selected={block.id === selectedId} device={device} onSelect={() => { setSelectedId(block.id); setInspectorTab("block"); }} assets={assets} />)}
            </div>
          </div>
        </section>
        <aside className="properties-panel">
          <div className="inspector-tabs"><button className={inspectorTab === "block" ? "active" : ""} onClick={() => setInspectorTab("block")}>Bloco</button><button className={inspectorTab === "page" ? "active" : ""} onClick={() => setInspectorTab("page")}>Página e SEO</button></div>
          {inspectorTab === "block" ? selected ? <><h3>Conteúdo</h3><BlockProperties block={selected} assets={assets} onChange={(content) => updateBlock(selected.id, content)} /><hr /><h3>Layout e aparência</h3><BlockStyleProperties settings={selected.settings ?? {}} onChange={(settings) => updateBlockSettings(selected.id, settings)} /></> : <p className="muted">Selecione um bloco.</p> : <PageProperties doc={doc} onChange={(next) => update(next)} />}
          <hr />
          <h3>Versões</h3>
          <div className="version-list">
            {versions.length ? versions.map((version) => <button key={version.id} onClick={() => void restore(version.id)}><strong>v{version.versionNumber}</strong><small>{new Date(version.createdAt).toLocaleString("pt-BR")}</small></button>) : <p className="muted">Publique para criar a primeira versão.</p>}
          </div>
        </aside>
      </div>
    </div>
  );
}

function SortableBlock({ block, selected, onSelect, onDuplicate, onDelete }: { block: PageBlock; selected: boolean; onSelect: () => void; onDuplicate: () => void; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: block.id });
  return <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`block-row ${selected ? "selected" : ""}`} onClick={onSelect}><button className="drag-handle" {...attributes} {...listeners}>⠿</button><span>{blockLabel(block.type)}{(block.settings?.hiddenMobile === true || block.settings?.hiddenDesktop === true) && <small>oculto</small>}</span><button className="duplicate-mini" title="Duplicar bloco" onClick={(event) => { event.stopPropagation(); onDuplicate(); }}>⧉</button><button className="delete-mini" title="Excluir bloco" onClick={(event) => { event.stopPropagation(); onDelete(); }}>×</button></div>;
}

function BlockProperties({ block, assets, onChange }: { block: PageBlock; assets: AssetSummary[]; onChange: (content: unknown) => void }) {
  const record = block.content && typeof block.content === "object" && !Array.isArray(block.content) ? block.content as Record<string, unknown> : {};
  if (block.type === "heading" || block.type === "paragraph" || block.type === "html") {
    return <><textarea rows={block.type === "heading" ? 4 : 9} value={textValue(block.content)} onChange={(event) => onChange(event.target.value)} />{block.type === "html" && <p className="warning-copy">Scripts, estilos e atributos perigosos são removidos na publicação.</p>}</>;
  }
  if (block.type === "video" || block.type === "image") {
    const filtered = assets.filter((asset) => block.type === "video" ? asset.mediaType === "video" : asset.mediaType === "image");
    return <><label className="field"><span>Arquivo da biblioteca</span><select value={textValue(record.assetId)} onChange={(event) => onChange({ ...record, assetId: event.target.value, src: event.target.value ? `/media/${event.target.value}` : "" })}><option value="">Escolha</option>{filtered.map((asset) => <option key={asset.id} value={asset.id}>{asset.originalName}</option>)}</select></label>{block.type === "video" && <><label className="field"><span>Pitch/CTA em segundos</span><input type="number" min={0} value={Number(record.ctaAtSeconds ?? 0)} onChange={(event) => onChange({ ...record, ctaAtSeconds: Number(event.target.value) })} /></label><button className="button secondary full" onClick={() => navigate("/player")}>Configurar player e retenção</button></>}{block.type === "image" && <label className="field"><span>Texto alternativo</span><input value={textValue(record.alt)} onChange={(event) => onChange({ ...record, alt: event.target.value })} /></label>}</>;
  }
  if (block.type === "button") {
    return <><label className="field"><span>Texto</span><input value={textValue(record.label)} onChange={(event) => onChange({ ...record, label: event.target.value })} /></label><label className="field"><span>Destino</span><input value={textValue(record.href)} onChange={(event) => onChange({ ...record, href: event.target.value })} placeholder="#checkout ou https://…" /></label><label className="check-line"><input type="checkbox" checked={record.revealAfterPitch === true} onChange={(event) => onChange({ ...record, revealAfterPitch: event.target.checked })} /> Revelar após o pitch da VSL</label></>;
  }
  if (block.type === "leadForm") {
    const fields = record.fields && typeof record.fields === "object" && !Array.isArray(record.fields)
      ? record.fields as Record<string, unknown>
      : { name: true, email: true, whatsapp: false };
    return <><label className="field"><span>Texto do botão</span><input value={textValue(record.label)} onChange={(event) => onChange({ ...record, label: event.target.value })} /></label><h4>Dados para capturar</h4>{(["name", "email", "whatsapp"] as const).map((field) => <label className="check-line" key={field}><input type="checkbox" checked={fields[field] === true} onChange={(event) => onChange({ ...record, fields: { ...fields, [field]: event.target.checked } })} /> {field === "name" ? "Nome" : field === "email" ? "E-mail" : "WhatsApp"}</label>)}</>;
  }
  if (block.type === "quiz") return <QuizProperties record={record} onChange={onChange} />;
  return <p className="muted">Este bloco não possui conteúdo editável.</p>;
}

function QuizProperties({ record, onChange }: { record: Record<string, unknown>; onChange: (content: unknown) => void }) {
  const questions = Array.isArray(record.questions)
    ? record.questions.map((item) => item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {})
    : [];
  function updateQuestion(index: number, next: Record<string, unknown>) {
    onChange({ ...record, questions: questions.map((question, questionIndex) => questionIndex === index ? next : question) });
  }
  return (
    <div className="quiz-properties">
      <label className="field"><span>Transição entre perguntas (ms)</span><input type="number" min={0} max={5000} value={Number(record.transitionMs ?? 250)} onChange={(event) => onChange({ ...record, transitionMs: Number(event.target.value) })} /></label>
      {questions.map((question, index) => {
        const options = Array.isArray(question.options) ? question.options.map(textValue) : [];
        return <section key={index}><header><strong>Pergunta {index + 1}</strong><button type="button" onClick={() => onChange({ ...record, questions: questions.filter((_, questionIndex) => questionIndex !== index) })}>×</button></header><input value={textValue(question.title)} onChange={(event) => updateQuestion(index, { ...question, title: event.target.value })} placeholder="Digite a pergunta" />{options.map((option, optionIndex) => <div className="option-editor" key={optionIndex}><input value={option} onChange={(event) => updateQuestion(index, { ...question, options: options.map((current, currentIndex) => currentIndex === optionIndex ? event.target.value : current) })} placeholder={`Opção ${optionIndex + 1}`} /><button type="button" onClick={() => updateQuestion(index, { ...question, options: options.filter((_, currentIndex) => currentIndex !== optionIndex) })}>×</button></div>)}<button type="button" className="button ghost full" onClick={() => updateQuestion(index, { ...question, options: [...options, `Opção ${options.length + 1}`] })}>+ Adicionar resposta</button></section>;
      })}
      <button type="button" className="button secondary full" onClick={() => onChange({ ...record, questions: [...questions, { title: `Pergunta ${questions.length + 1}`, options: ["Opção A", "Opção B"] }] })}>+ Nova pergunta</button>
    </div>
  );
}

function BlockStyleProperties({ settings, onChange }: { settings: Record<string, unknown>; onChange: (settings: Record<string, unknown>) => void }) {
  const number = (key: string, fallback: number) => Number(settings[key] ?? fallback);
  return (
    <div className="style-properties">
      <label className="field"><span>Alinhamento</span><select value={textValue(settings.align) || "inherit"} onChange={(event) => onChange({ ...settings, align: event.target.value })}><option value="inherit">Padrão da página</option><option value="left">Esquerda</option><option value="center">Centro</option><option value="right">Direita</option></select></label>
      <label className="field"><span>Largura máxima</span><div className="range-with-value"><input type="range" min={240} max={1200} step={20} value={number("maxWidth", 920)} onChange={(event) => onChange({ ...settings, maxWidth: Number(event.target.value) })} /><b>{number("maxWidth", 920)}px</b></div></label>
      <div className="two-fields">
        <label className="field"><span>Texto</span><input type="color" value={textValue(settings.textColor) || "#ffffff"} onChange={(event) => onChange({ ...settings, textColor: event.target.value })} /></label>
        <label className="field"><span>Fundo</span><input type="color" value={textValue(settings.background) || "#000000"} onChange={(event) => onChange({ ...settings, background: event.target.value, transparentBackground: false })} /></label>
      </div>
      <label className="check-line"><input type="checkbox" checked={settings.transparentBackground !== false} onChange={(event) => onChange({ ...settings, transparentBackground: event.target.checked })} /> Fundo transparente</label>
      <div className="two-fields">
        <label className="field"><span>Tamanho do texto</span><input type="number" min={10} max={120} value={number("fontSize", 0) || ""} placeholder="Automático" onChange={(event) => onChange({ ...settings, fontSize: Number(event.target.value) || 0 })} /></label>
        <label className="field"><span>Peso</span><select value={number("fontWeight", 0)} onChange={(event) => onChange({ ...settings, fontWeight: Number(event.target.value) })}><option value={0}>Automático</option><option value={400}>Regular</option><option value={600}>Semibold</option><option value={700}>Bold</option><option value={900}>Black</option></select></label>
      </div>
      <div className="two-fields">
        <label className="field"><span>Espaço interno</span><input type="number" min={0} max={120} value={number("padding", 0)} onChange={(event) => onChange({ ...settings, padding: Number(event.target.value) })} /></label>
        <label className="field"><span>Espaço abaixo</span><input type="number" min={0} max={160} value={number("marginBottom", 28)} onChange={(event) => onChange({ ...settings, marginBottom: Number(event.target.value) })} /></label>
      </div>
      <div className="two-fields">
        <label className="field"><span>Arredondamento</span><input type="number" min={0} max={100} value={number("radius", 0)} onChange={(event) => onChange({ ...settings, radius: Number(event.target.value) })} /></label>
        <label className="field"><span>Sombra</span><select value={textValue(settings.shadow) || "none"} onChange={(event) => onChange({ ...settings, shadow: event.target.value })}><option value="none">Nenhuma</option><option value="soft">Suave</option><option value="strong">Forte</option><option value="glow">Glow vermelho</option></select></label>
      </div>
      <label className="check-line"><input type="checkbox" checked={settings.hiddenMobile === true} onChange={(event) => onChange({ ...settings, hiddenMobile: event.target.checked })} /> Ocultar no mobile</label>
      <label className="check-line"><input type="checkbox" checked={settings.hiddenDesktop === true} onChange={(event) => onChange({ ...settings, hiddenDesktop: event.target.checked })} /> Ocultar no desktop</label>
    </div>
  );
}

function PageProperties({ doc, onChange }: { doc: PageDocument; onChange: (doc: PageDocument) => void }) {
  const settings = doc.settings ?? {};
  return (
    <div className="page-properties">
      <h3>Página e SEO</h3>
      <label className="field"><span>Título do navegador</span><input maxLength={120} value={settings.title ?? ""} onChange={(event) => onChange({ ...doc, settings: { ...settings, title: event.target.value } })} placeholder="Título da página" /></label>
      <label className="field"><span>Descrição</span><textarea rows={4} maxLength={240} value={settings.description ?? ""} onChange={(event) => onChange({ ...doc, settings: { ...settings, description: event.target.value } })} placeholder="Resumo para buscadores e compartilhamento" /></label>
      <label className="field"><span>Momento do pitch/CTA</span><input type="number" min={0} value={settings.pitchAtSeconds ?? 0} onChange={(event) => onChange({ ...doc, settings: { ...settings, pitchAtSeconds: Number(event.target.value) } })} /></label>
      <div className="professional-note"><strong>Publicação verificada</strong><p>Ao publicar, a KRANO salva o rascunho, ativa a oferta e verifica a rota pública antes de confirmar.</p></div>
    </div>
  );
}

function PreviewBlock({ block, selected, device, onSelect, assets }: { block: PageBlock; selected: boolean; device: "desktop" | "tablet" | "mobile"; onSelect: () => void; assets: AssetSummary[] }) {
  const record = block.content && typeof block.content === "object" && !Array.isArray(block.content) ? block.content as Record<string, unknown> : {};
  const asset = assets.find((item) => item.id === record.assetId);
  const hidden = device === "mobile" ? block.settings?.hiddenMobile === true : block.settings?.hiddenDesktop === true;
  let content;
  if (block.type === "heading") content = <h1>{textValue(block.content)}</h1>;
  else if (block.type === "paragraph" || block.type === "html") content = <p>{textValue(block.content).replace(/<[^>]+>/g, "")}</p>;
  else if (block.type === "button") content = <button className="preview-cta">{textValue(record.label) || "Continuar"}</button>;
  else if (block.type === "video") content = asset ? <video controls src={asset.url ?? undefined} /> : <div className="preview-media">▶ Escolha uma VSL</div>;
  else if (block.type === "image") content = asset ? <img src={asset.url ?? undefined} alt={textValue(record.alt)} /> : <div className="preview-media">▧ Escolha uma imagem</div>;
  else if (block.type === "divider") content = <hr />;
  else if (block.type === "spacer") content = <div className="preview-spacer" />;
  else if (block.type === "leadForm") {
    const fields = record.fields && typeof record.fields === "object" && !Array.isArray(record.fields)
      ? record.fields as Record<string, unknown>
      : { name: true, email: true, whatsapp: false };
    content = <div className="preview-form">{fields.name !== false && <input placeholder="Seu nome" />}{fields.email !== false && <input placeholder="Seu e-mail" />}{fields.whatsapp === true && <input placeholder="Seu WhatsApp" />}<button className="preview-cta">{textValue(record.label) || "Enviar"}</button></div>;
  } else if (block.type === "quiz") {
    const questions = Array.isArray(record.questions) ? record.questions : [];
    const first = questions[0] && typeof questions[0] === "object" && !Array.isArray(questions[0])
      ? questions[0] as Record<string, unknown>
      : {};
    const options = Array.isArray(first.options) ? first.options : [];
    content = <div className="preview-quiz"><small>Pergunta 1 de {questions.length || 1}</small><strong>{textValue(first.title) || "Sua pergunta aparece aqui"}</strong>{options.map((option, index) => <button key={index}>{textValue(option)}</button>)}</div>;
  }
  else content = null;
  return <div className={`preview-block ${selected ? "selected" : ""} ${hidden ? "preview-hidden" : ""}`} style={previewBlockStyle(block.settings)} onClick={onSelect}>{hidden && <span className="hidden-label">Oculto neste dispositivo</span>}{content}</div>;
}

function blockLabel(type: PageBlockType) {
  const labels: Record<PageBlockType, string> = { heading: "Título", paragraph: "Texto", image: "Imagem", video: "VSL", button: "Botão", spacer: "Espaço", divider: "Divisor", leadForm: "Captura", quiz: "Quiz", html: "HTML seguro" };
  return labels[type];
}

function textValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function previewBlockStyle(settings: Record<string, unknown> | undefined): CSSProperties {
  if (!settings) return {};
  const maxWidth = Math.min(Math.max(Number(settings.maxWidth) || 920, 240), 1200);
  const padding = Math.min(Math.max(Number(settings.padding) || 0, 0), 120);
  const radius = Math.min(Math.max(Number(settings.radius) || 0, 0), 100);
  const fontSize = Math.min(Math.max(Number(settings.fontSize) || 0, 0), 120);
  const shadows: Record<string, string> = {
    soft: "0 12px 35px #0005",
    strong: "0 22px 65px #000a",
    glow: "0 0 45px color-mix(in srgb,var(--preview-accent) 45%,transparent)"
  };
  return {
    maxWidth,
    marginBottom: Math.min(Math.max(Number(settings.marginBottom) || 0, 0), 160),
    padding,
    borderRadius: radius,
    color: textValue(settings.textColor) || undefined,
    background: settings.transparentBackground === false ? textValue(settings.background) || "#000000" : undefined,
    textAlign: ["left", "center", "right"].includes(textValue(settings.align)) ? textValue(settings.align) as CSSProperties["textAlign"] : undefined,
    fontSize: fontSize || undefined,
    fontWeight: Number(settings.fontWeight) || undefined,
    boxShadow: shadows[textValue(settings.shadow)] || undefined
  };
}

function previewFont(font: string | undefined): string {
  if (font === "editorial") return "Georgia, 'Times New Roman', serif";
  if (font === "rounded") return "'Trebuchet MS', ui-rounded, sans-serif";
  if (font === "system") return "system-ui, sans-serif";
  return "Inter, ui-sans-serif, system-ui, sans-serif";
}
