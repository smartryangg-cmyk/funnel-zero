import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps
} from "@xyflow/react";
import type {
  FunnelGraphNode,
  FunnelNodeConfig,
  FunnelNodeType,
  FunnelSummary,
  OfferSummary,
  PageSummary
} from "../../../packages/shared/src/schemas";
import { api } from "./api";
import { Empty, Modal, Notice, PageHeader, StatusPill, navigate } from "./ui";

type FlowNode = Node<{
  label: string;
  kind: FunnelNodeType;
  config: FunnelNodeConfig;
}>;

const nodeTypes = { funnelStep: FunnelNode };

export function Funnels({ selectedId }: { selectedId?: string }) {
  return selectedId ? <FunnelBuilder id={selectedId} /> : <FunnelList />;
}

function FunnelList() {
  const [funnels, setFunnels] = useState<FunnelSummary[]>([]);
  const [offers, setOffers] = useState<OfferSummary[]>([]);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [error, setError] = useState("");
  const selectedOffer = new URLSearchParams(location.search).get("offer") ?? undefined;

  async function load() {
    try {
      const [funnelsResult, offersResult] = await Promise.all([api.funnels(selectedOffer), api.offers()]);
      setFunnels(funnelsResult.funnels);
      setOffers(offersResult.offers);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao carregar funis.");
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [selectedOffer]);

  async function removeFunnel(funnel: FunnelSummary) {
    if (!confirm(`Excluir o funil "${funnel.name}"?\n\nAs páginas serão preservadas e desvinculadas. Domínios vinculados precisam ser removidos antes.`)) return;
    setDeletingId(funnel.id);
    setError("");
    try {
      await api.deleteFunnel(funnel.id);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao excluir funil.");
    } finally {
      setDeletingId("");
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Funis"
        title="Desenhe o caminho da oferta."
        subtitle="Um mapa horizontal para conectar páginas, VSL, captura e checkout."
        actions={<button className="button primary" onClick={() => setCreating(true)}>+ Novo funil</button>}
      />
      {error && <Notice tone="error">{error}</Notice>}
      {funnels.length === 0 ? (
        <section className="panel"><Empty icon="⇢" title="Nenhum funil neste filtro" text="Crie um fluxo e conecte visualmente as etapas." action={<button className="button primary" onClick={() => setCreating(true)}>Criar funil</button>} /></section>
      ) : (
        <section className="cards-list">
          {funnels.map((funnel) => (
            <article className="entity-card" key={funnel.id}>
              <div className="entity-icon">⇢</div>
              <div className="entity-main">
                <div className="entity-title"><h2>{funnel.name}</h2><StatusPill status={funnel.status} /></div>
                <p>{funnel.offerName ?? "Sem oferta"} · {funnel.graph.nodes.length} etapas · mapa v{funnel.graphVersion}</p>
              </div>
              <div className="entity-actions">
                <button className="button secondary" onClick={() => navigate(`/funnels/${funnel.id}`)}>Editar mapa</button>
                <button className="button ghost" onClick={() => { void api.duplicateFunnel(funnel.id).then((result) => navigate(`/funnels/${result.funnel.id}`)); }}>Duplicar</button>
                <button className="button danger" disabled={deletingId === funnel.id} onClick={() => void removeFunnel(funnel)}>
                  {deletingId === funnel.id ? "Excluindo…" : "Excluir"}
                </button>
              </div>
            </article>
          ))}
        </section>
      )}
      {creating && (
        <CreateFunnel
          offers={offers}
          initialOfferId={selectedOffer}
          onClose={() => setCreating(false)}
          onCreated={(id) => navigate(`/funnels/${id}`)}
        />
      )}
    </>
  );
}

function CreateFunnel({
  offers,
  initialOfferId,
  onClose,
  onCreated
}: {
  offers: OfferSummary[];
  initialOfferId?: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [offerId, setOfferId] = useState(initialOfferId ?? offers[0]?.id ?? "");
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const result = await api.createFunnel({ name, offerId: offerId || null });
      onCreated(result.funnel.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao criar funil.");
    }
  }
  return (
    <Modal title="Novo funil" onClose={onClose}>
      <form className="form" onSubmit={(event) => void submit(event)}>
        <label className="field"><span>Nome</span><input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: VSL principal" /></label>
        <label className="field"><span>Oferta</span><select value={offerId} onChange={(event) => setOfferId(event.target.value)}><option value="">Sem oferta</option>{offers.map((offer) => <option value={offer.id} key={offer.id}>{offer.name}</option>)}</select></label>
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary">Criar e editar</button></div>
      </form>
    </Modal>
  );
}

function FunnelBuilder({ id }: { id: string }) {
  const [funnel, setFunnel] = useState<FunnelSummary | null>(null);
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const fitViewOptions = useMemo(() => ({ padding: 0.25 }), []);

  useEffect(() => {
    api.funnel(id).then(async ({ funnel: value }) => {
      const pageResult = await api.pages(value.offerId ?? undefined);
      setFunnel(value);
      setPages(
        value.offerId
          ? pageResult.pages.filter((page) =>
              page.offerId === value.offerId
              && (!page.funnelId || page.funnelId === value.id)
            )
          : []
      );
      setNodes(value.graph.nodes.map((node) => ({
        id: node.id,
        type: "funnelStep",
        position: node.position,
        data: {
          label: node.label,
          kind: node.type,
          config: structuredClone(node.config ?? {})
        }
      })));
      setEdges(value.graph.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.label,
        markerEnd: { type: MarkerType.ArrowClosed },
        animated: true
      })));
    }).catch((error: Error) => setMessage(error.message));
  }, [id]);

  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => {
    setNodes((current) => applyNodeChanges(changes, current));
  }, []);
  const onEdgesChange = useCallback((changes: EdgeChange<Edge>[]) => {
    setEdges((current) => applyEdgeChanges(changes, current));
  }, []);
  const onConnect = useCallback((connection: Connection) => {
    setEdges((current) => addEdge({
      ...connection,
      id: crypto.randomUUID(),
      markerEnd: { type: MarkerType.ArrowClosed },
      animated: true
    }, current));
  }, []);

  function addNode(kind: FunnelNodeType, label: string) {
    setNodes((current) => [...current, {
      id: crypto.randomUUID(),
      type: "funnelStep",
      position: { x: 100 + current.length * 270, y: 120 + (current.length % 2) * 120 },
      data: { label, kind, config: {} }
    }]);
  }

  function duplicateSelected() {
    const selected = nodes.find((node) => node.selected);
    if (!selected) return setMessage("Selecione uma etapa para duplicar.");
    const config = structuredClone(selected.data.config);
    delete config.pageId;
    setNodes((current) => [...current, {
      ...selected,
      id: crypto.randomUUID(),
      selected: false,
      position: { x: selected.position.x + 40, y: selected.position.y + 80 },
      data: {
        ...selected.data,
        label: `${selected.data.label} — cópia`,
        config
      }
    }]);
  }

  function deleteSelected() {
    const ids = new Set(nodes.filter((node) => node.selected).map((node) => node.id));
    if (!ids.size) return setMessage("Selecione uma etapa para excluir.");
    if (!confirm("Excluir as etapas selecionadas e suas conexões?")) return;
    setNodes((current) => current.filter((node) => !ids.has(node.id)));
    setEdges((current) => current.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target)));
  }

  async function save(publish = false) {
    if (!funnel) return;
    setSaving(true);
    setMessage("");
    const graph = {
      version: funnel.graph.version + 1,
      nodes: nodes.map((node): FunnelGraphNode => ({
        id: node.id,
        type: node.data.kind,
        label: node.data.label,
        position: node.position,
        config: structuredClone(node.data.config)
      })),
      edges: edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, label: typeof edge.label === "string" ? edge.label : undefined }))
    };
    try {
      const updated = await api.updateFunnel(id, { graph });
      const publication = publish ? await api.publishFunnel(id) : null;
      setFunnel({ ...updated.funnel, status: publish ? "published" : updated.funnel.status });
      setMessage(
        publication
          ? `Funil e ${publication.linkedPages} página(s) publicados de verdade.`
          : "Mapa salvo."
      );
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  async function removeFunnel() {
    if (!funnel || !confirm(`Excluir o funil "${funnel.name}"?\n\nAs páginas serão preservadas e desvinculadas.`)) return;
    setSaving(true);
    try {
      await api.deleteFunnel(funnel.id);
      navigate("/funnels");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Falha ao excluir funil.");
      setSaving(false);
    }
  }

  const selectedNode = nodes.find((node) => node.selected) ?? null;
  const usedPageIds = new Set(
    nodes
      .filter((node) => node.id !== selectedNode?.id)
      .map((node) => node.data.config.pageId)
      .filter((pageId): pageId is string => Boolean(pageId))
  );

  function updateSelectedNode(
    transform: (data: FlowNode["data"]) => FlowNode["data"]
  ) {
    if (!selectedNode) return;
    setNodes((current) => current.map((node) =>
      node.id === selectedNode.id ? { ...node, data: transform(node.data) } : node
    ));
  }

  if (!funnel) return <div className="panel skeleton tall" />;
  return (
    <>
      <PageHeader
        eyebrow="Editor de funil"
        title={funnel.name}
        subtitle={`${funnel.offerName ?? "Sem oferta"} · conecte as etapas pelas alças laterais.`}
        actions={<><button className="button danger" onClick={() => void removeFunnel()} disabled={saving}>Excluir funil</button><button className="button secondary" onClick={() => void save(false)} disabled={saving}>Salvar</button><button className="button primary" onClick={() => void save(true)} disabled={saving}>Publicar</button></>}
      />
      <div className="builder-toolbar">
        <button onClick={() => addNode("page", "Página")}>+ Página</button>
        <button onClick={() => addNode("vsl", "VSL")}>+ VSL</button>
        <button onClick={() => addNode("lead", "Captura")}>+ Captura</button>
        <button onClick={() => addNode("checkout", "Checkout externo")}>+ Checkout</button>
        <span />
        <button onClick={duplicateSelected}>Duplicar</button>
        <button className="danger-text" onClick={deleteSelected}>Excluir</button>
      </div>
      {message && <Notice tone={message.includes("salvo") || message.includes("publicado") ? "success" : "warning"}>{message}</Notice>}
      <section className="panel builder-step-editor">
        {selectedNode ? (
          <>
            <div className="panel-header">
              <div>
                <span className="eyebrow">ETAPA SELECIONADA</span>
                <h2>Conteúdo e destino</h2>
              </div>
              <StatusPill status={selectedNode.data.config.pageId || selectedNode.data.config.url ? "active" : "pending"} />
            </div>
            <div className="settings-grid">
              <label className="field">
                <span>Nome da etapa</span>
                <input
                  value={selectedNode.data.label}
                  onChange={(event) => updateSelectedNode((data) => ({
                    ...data,
                    label: event.target.value
                  }))}
                />
              </label>
              {selectedNode.data.kind === "checkout" ? (
                <label className="field">
                  <span>URL do checkout</span>
                  <input
                    type="url"
                    value={selectedNode.data.config.url ?? ""}
                    onChange={(event) => updateSelectedNode((data) => ({
                      ...data,
                      config: { ...data.config, url: event.target.value }
                    }))}
                    placeholder="Usa o checkout da oferta quando vazio"
                  />
                </label>
              ) : (
                <label className="field">
                  <span>Página desta etapa</span>
                  <select
                    value={selectedNode.data.config.pageId ?? ""}
                    onChange={(event) => updateSelectedNode((data) => ({
                      ...data,
                      config: {
                        ...data.config,
                        pageId: event.target.value || undefined
                      }
                    }))}
                  >
                    <option value="">Escolha uma página</option>
                    {pages.map((page) => (
                      <option
                        key={page.id}
                        value={page.id}
                        disabled={usedPageIds.has(page.id)}
                      >
                        {page.name}{usedPageIds.has(page.id) ? " · já utilizada" : ""}
                      </option>
                    ))}
                  </select>
                  <small>Cada página pode ocupar somente uma etapa deste funil.</small>
                </label>
              )}
            </div>
            {selectedNode.data.kind !== "checkout" && (
              <button
                className="button secondary"
                onClick={() => navigate(
                  `/pages?offer=${funnel.offerId ?? ""}&funnel=${funnel.id}&create=1`
                )}
              >
                + Criar página para este funil
              </button>
            )}
          </>
        ) : (
          <Empty
            icon="⇢"
            title="Selecione uma etapa do mapa"
            text="Depois escolha a página correspondente ou configure o destino do checkout."
          />
        )}
      </section>
      <section className="flow-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          fitView
          fitViewOptions={fitViewOptions}
          minZoom={0.25}
          maxZoom={1.8}
        >
          <Background gap={20} size={1} />
          <MiniMap pannable zoomable />
          <Controls />
        </ReactFlow>
      </section>
    </>
  );
}

function FunnelNode({ data, selected }: NodeProps<FlowNode>) {
  const icons: Record<string, string> = { page: "▦", vsl: "▶", lead: "◎", checkout: "↗" };
  return (
    <div className={`flow-node ${selected ? "selected" : ""}`}>
      <Handle type="target" position={Position.Left} />
      <span>{icons[data.kind] ?? "◆"}</span>
      <div><strong>{data.label}</strong><small>{data.kind}</small></div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
