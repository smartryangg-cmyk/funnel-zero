import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
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
  return editorId ? <PageEditor id={editorId} /> : <PageList />;
}

function PageList() {
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [offers, setOffers] = useState<OfferSummary[]>([]);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  async function load() {
    try {
      const [pageResult, offerResult, templateResult] = await Promise.all([
        api.pages(), api.offers(), api.templates()
      ]);
      setPages(pageResult.pages);
      setOffers(offerResult.offers);
      setTemplates(templateResult.templates);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao carregar páginas.");
    }
  }
  useEffect(() => { void load(); }, []);
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
              </div>
              <div className="entity-actions">
                <button className="button secondary" onClick={() => navigate(`/pages/${page.id}/edit`)}>Editar</button>
                {page.publicUrl && <a className="button ghost" href={page.publicUrl} target="_blank" rel="noreferrer">Abrir ↗</a>}
              </div>
            </article>
          ))}
        </section>
      )}
      {creating && <CreatePage offers={offers} templates={templates} onClose={() => setCreating(false)} onCreated={(id) => navigate(`/pages/${id}/edit`)} />}
    </>
  );
}

function CreatePage({
  offers,
  templates,
  onClose,
  onCreated
}: {
  offers: OfferSummary[];
  templates: TemplateSummary[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [offerId, setOfferId] = useState(offers[0]?.id ?? "");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const template = templates.find((item) => item.id === templateId);
    try {
      const result = await api.createPage({
        name,
        offerId: offerId || null,
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
        <label className="field"><span>Oferta</span><select required value={offerId} onChange={(event) => setOfferId(event.target.value)}><option value="">Escolha</option>{offers.map((offer) => <option key={offer.id} value={offer.id}>{offer.name}</option>)}</select></label>
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
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [message, setMessage] = useState("");
  const [saveState, setSaveState] = useState("Carregando…");
  const history = useRef<PageDocument[]>([]);
  const future = useRef<PageDocument[]>([]);
  const hydrated = useRef(false);
  const lastSaved = useRef("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  async function load() {
    try {
      const [pageResult, assetResult, versionResult] = await Promise.all([
        api.page(id), api.assets(), api.pageVersions(id)
      ]);
      setPage(pageResult.page);
      setDoc(pageResult.page.content);
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

  useEffect(() => {
    if (!hydrated.current || !doc || !page) return;
    const serialized = JSON.stringify(doc);
    if (serialized === lastSaved.current) {
      setSaveState("Tudo salvo");
      return;
    }
    setSaveState("Alterações não salvas");
    const timer = window.setTimeout(() => {
      void (async () => {
        setSaveState("Salvando…");
        try {
          const result = await api.updatePage(page.id, { content: doc, revision: page.revision });
          setPage(result.page);
          lastSaved.current = JSON.stringify(result.page.content);
          setSaveState("Tudo salvo");
        } catch (caught) {
          setSaveState(caught instanceof ApiError && caught.code === "REVISION_CONFLICT" ? "Conflito: recarregue" : "Falha ao salvar");
        }
      })();
    }, 900);
    return () => window.clearTimeout(timer);
  }, [doc, page]);

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
      leadForm: { label: "Quero receber" },
      quiz: { questions: [] },
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
    try {
      setMessage("Publicando…");
      const result = await api.publishPage(id);
      setPage(result.page);
      setVersions((await api.pageVersions(id)).versions);
      setMessage(`Versão ${result.versionNumber} publicada.`);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Falha ao publicar.");
    }
  }
  async function restore(versionId: string) {
    if (!confirm("Restaurar esta versão para o rascunho atual?")) return;
    const result = await api.restorePageVersion(id, versionId);
    setPage(result.page);
    setDoc(result.page.content);
    lastSaved.current = JSON.stringify(result.page.content);
    setMessage("Versão restaurada no rascunho.");
  }

  const selected = doc?.blocks.find((block) => block.id === selectedId) ?? null;
  const previewStyle = useMemo(() => doc ? {
    "--preview-bg": doc.theme.background,
    "--preview-text": doc.theme.text,
    "--preview-accent": doc.theme.accent
  } as CSSProperties : {}, [doc]);
  if (!page || !doc) return <><PageHeader eyebrow="Editor" title="Abrindo página…" subtitle="Carregando rascunho e versões." />{message && <Notice tone="error">{message}</Notice>}<div className="panel skeleton tall" /></>;

  return (
    <div className="editor-page">
      <PageHeader eyebrow="Editor de páginas" title={page.name} subtitle={`${saveState} · revisão ${page.revision}`} actions={<><button className="button ghost" onClick={undo} disabled={!history.current.length}>↶</button><button className="button ghost" onClick={redo} disabled={!future.current.length}>↷</button>{page.publicUrl && <a className="button secondary" target="_blank" rel="noreferrer" href={page.publicUrl}>Abrir ↗</a>}<button className="button primary" onClick={() => void publish()}>Publicar</button></>} />
      {message && <Notice tone={message.includes("publicada") || message.includes("restaurada") ? "success" : "warning"}>{message}</Notice>}
      <div className="editor-toolbar">
        {(["heading", "paragraph", "image", "video", "button", "leadForm", "quiz", "divider", "spacer", "html"] as PageBlockType[]).map((type) => <button key={type} onClick={() => addBlock(type)}>+ {blockLabel(type)}</button>)}
        <span />
        <button className={device === "desktop" ? "active" : ""} onClick={() => setDevice("desktop")}>Desktop</button>
        <button className={device === "mobile" ? "active" : ""} onClick={() => setDevice("mobile")}>Mobile</button>
      </div>
      <div className="editor-layout">
        <aside className="blocks-panel">
          <h3>Estrutura</h3>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd}>
            <SortableContext items={doc.blocks.map((block) => block.id)} strategy={verticalListSortingStrategy}>
              {doc.blocks.map((block) => <SortableBlock key={block.id} block={block} selected={selectedId === block.id} onSelect={() => setSelectedId(block.id)} onDelete={() => deleteBlock(block.id)} />)}
            </SortableContext>
          </DndContext>
          <h3>Tema</h3>
          <div className="theme-controls">
            <label>Fundo<input type="color" value={doc.theme.background} onChange={(event) => update({ ...doc, theme: { ...doc.theme, background: event.target.value } })} /></label>
            <label>Texto<input type="color" value={doc.theme.text} onChange={(event) => update({ ...doc, theme: { ...doc.theme, text: event.target.value } })} /></label>
            <label>Destaque<input type="color" value={doc.theme.accent} onChange={(event) => update({ ...doc, theme: { ...doc.theme, accent: event.target.value } })} /></label>
          </div>
        </aside>
        <section className="preview-stage">
          <div className={`page-preview ${device}`} style={previewStyle}>
            {doc.blocks.map((block) => <PreviewBlock key={block.id} block={block} selected={block.id === selectedId} onSelect={() => setSelectedId(block.id)} assets={assets} />)}
          </div>
        </section>
        <aside className="properties-panel">
          <h3>Propriedades</h3>
          {selected ? <BlockProperties block={selected} assets={assets} onChange={(content) => updateBlock(selected.id, content)} /> : <p className="muted">Selecione um bloco.</p>}
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

function SortableBlock({ block, selected, onSelect, onDelete }: { block: PageBlock; selected: boolean; onSelect: () => void; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: block.id });
  return <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`block-row ${selected ? "selected" : ""}`} onClick={onSelect}><button className="drag-handle" {...attributes} {...listeners}>⠿</button><span>{blockLabel(block.type)}</span><button className="delete-mini" onClick={(event) => { event.stopPropagation(); onDelete(); }}>×</button></div>;
}

function BlockProperties({ block, assets, onChange }: { block: PageBlock; assets: AssetSummary[]; onChange: (content: unknown) => void }) {
  const record = block.content && typeof block.content === "object" && !Array.isArray(block.content) ? block.content as Record<string, unknown> : {};
  if (block.type === "heading" || block.type === "paragraph" || block.type === "html") {
    return <><textarea rows={block.type === "heading" ? 4 : 9} value={textValue(block.content)} onChange={(event) => onChange(event.target.value)} />{block.type === "html" && <p className="warning-copy">Scripts, estilos e atributos perigosos são removidos na publicação.</p>}</>;
  }
  if (block.type === "video" || block.type === "image") {
    const filtered = assets.filter((asset) => block.type === "video" ? asset.mediaType === "video" : asset.mediaType === "image");
    return <><label className="field"><span>Arquivo da biblioteca</span><select value={textValue(record.assetId)} onChange={(event) => onChange({ ...record, assetId: event.target.value, src: event.target.value ? `/media/${event.target.value}` : "" })}><option value="">Escolha</option>{filtered.map((asset) => <option key={asset.id} value={asset.id}>{asset.originalName}</option>)}</select></label>{block.type === "video" && <label className="field"><span>Pitch/CTA em segundos</span><input type="number" min={0} value={Number(record.ctaAtSeconds ?? 0)} onChange={(event) => onChange({ ...record, ctaAtSeconds: Number(event.target.value) })} /></label>}{block.type === "image" && <label className="field"><span>Texto alternativo</span><input value={textValue(record.alt)} onChange={(event) => onChange({ ...record, alt: event.target.value })} /></label>}</>;
  }
  if (block.type === "button") {
    return <><label className="field"><span>Texto</span><input value={textValue(record.label)} onChange={(event) => onChange({ ...record, label: event.target.value })} /></label><label className="field"><span>Destino</span><input value={textValue(record.href)} onChange={(event) => onChange({ ...record, href: event.target.value })} placeholder="#checkout ou https://…" /></label><label className="check-line"><input type="checkbox" checked={record.revealAfterPitch === true} onChange={(event) => onChange({ ...record, revealAfterPitch: event.target.checked })} /> Revelar após o pitch da VSL</label></>;
  }
  if (block.type === "leadForm") {
    return <label className="field"><span>Texto do botão</span><input value={textValue(record.label)} onChange={(event) => onChange({ ...record, label: event.target.value })} /></label>;
  }
  return <p className="muted">Este bloco não possui conteúdo editável.</p>;
}

function PreviewBlock({ block, selected, onSelect, assets }: { block: PageBlock; selected: boolean; onSelect: () => void; assets: AssetSummary[] }) {
  const record = block.content && typeof block.content === "object" && !Array.isArray(block.content) ? block.content as Record<string, unknown> : {};
  const asset = assets.find((item) => item.id === record.assetId);
  let content;
  if (block.type === "heading") content = <h1>{textValue(block.content)}</h1>;
  else if (block.type === "paragraph" || block.type === "html") content = <p>{textValue(block.content).replace(/<[^>]+>/g, "")}</p>;
  else if (block.type === "button") content = <button className="preview-cta">{textValue(record.label) || "Continuar"}</button>;
  else if (block.type === "video") content = asset ? <video controls src={asset.url ?? undefined} /> : <div className="preview-media">▶ Escolha uma VSL</div>;
  else if (block.type === "image") content = asset ? <img src={asset.url ?? undefined} alt={textValue(record.alt)} /> : <div className="preview-media">▧ Escolha uma imagem</div>;
  else if (block.type === "divider") content = <hr />;
  else if (block.type === "spacer") content = <div className="preview-spacer" />;
  else if (block.type === "leadForm") content = <div className="preview-form"><input placeholder="Seu nome" /><input placeholder="Seu e-mail" /><button className="preview-cta">{textValue(record.label) || "Enviar"}</button></div>;
  else if (block.type === "quiz") content = <div className="preview-media">Quiz · configure as perguntas no JSON</div>;
  else content = null;
  return <div className={`preview-block ${selected ? "selected" : ""}`} onClick={onSelect}>{content}</div>;
}

function blockLabel(type: PageBlockType) {
  const labels: Record<PageBlockType, string> = { heading: "Título", paragraph: "Texto", image: "Imagem", video: "VSL", button: "Botão", spacer: "Espaço", divider: "Divisor", leadForm: "Captura", quiz: "Quiz", html: "HTML seguro" };
  return labels[type];
}

function textValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}
