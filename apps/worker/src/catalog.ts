import type {
  FunnelGraph,
  FunnelNodeType,
  PageDocument,
  SessionUser
} from "../../../packages/shared/src/schemas";
import { inspectFunnelGraph, isPublicRouteReady } from "../../../packages/shared/src/schemas";
import { randomId } from "./crypto";
import { errorResponse, json, readJson, requireSameOrigin } from "./http";
import {
  audit,
  makeUniqueSlug,
  optionalString,
  parseBodyRecord,
  parseHttpUrl,
  requiredString,
  safeJson,
  slugify,
  ValidationError
} from "./platform";

interface OfferRow {
  id: string;
  name: string;
  slug: string;
  status: "draft" | "active" | "archived";
  checkout_url: string | null;
  pixel_config_json: string;
  funnel_count: number;
  page_count: number;
  updated_at: string;
}

interface FunnelRow {
  id: string;
  offer_id: string | null;
  offer_name: string | null;
  offer_slug: string | null;
  name: string;
  slug: string;
  status: "draft" | "published" | "archived";
  graph_version: number;
  graph_json: string;
  published_at: string | null;
  updated_at: string;
}

interface PageRow {
  id: string;
  funnel_id: string | null;
  offer_id: string | null;
  offer_name: string | null;
  offer_slug: string | null;
  offer_status: "draft" | "active" | "archived" | null;
  funnel_status: "draft" | "published" | "archived" | null;
  name: string;
  slug: string;
  page_type: string;
  status: "draft" | "published" | "archived";
  revision: number | null;
  content_json: string | null;
  published_version_id: string | null;
  published_at: string | null;
  updated_at: string;
}

interface TemplateRow {
  id: string;
  name: string;
  slug: string;
  category: string;
  content_json: string;
  is_system: number;
}

interface VersionRow {
  id: string;
  version_number: number;
  content_json: string;
  created_at: string;
}

const DEFAULT_DOCUMENT: PageDocument = {
  version: 1,
  theme: { background: "#000000", text: "#f5f7fb", accent: "#f00000" },
  blocks: [
    { id: "headline", type: "heading", content: "Uma página pronta para a sua ideia" },
    {
      id: "body",
      type: "paragraph",
      content: "Edite os blocos, publique e acompanhe os sinais do funil."
    },
    {
      id: "cta",
      type: "button",
      content: { label: "Continuar", href: "#oferta" }
    }
  ]
};

function mapOffer(row: OfferRow) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    checkoutUrl: row.checkout_url,
    pixelConfig: safeJson<Record<string, unknown>>(row.pixel_config_json, {}),
    funnelCount: Number(row.funnel_count),
    pageCount: Number(row.page_count),
    updatedAt: row.updated_at
  };
}

function mapFunnel(row: FunnelRow) {
  return {
    id: row.id,
    offerId: row.offer_id,
    offerName: row.offer_name,
    name: row.name,
    slug: row.slug,
    status: row.status,
    graphVersion: row.graph_version,
    graph: safeJson<FunnelGraph>(row.graph_json, { version: 1, nodes: [], edges: [] }),
    publishedAt: row.published_at,
    updatedAt: row.updated_at
  };
}

function mapPage(row: PageRow, origin: string) {
  const content = safeJson<PageDocument>(row.content_json, DEFAULT_DOCUMENT);
  const isLive = isPublicRouteReady({
    pageStatus: row.status,
    publishedVersionId: row.published_version_id,
    offerId: row.offer_id,
    offerStatus: row.offer_status,
    funnelId: row.funnel_id,
    funnelStatus: row.funnel_status
  });
  const publicationIssue = isLive
    ? null
    : row.status !== "published"
      ? "Publique uma versão para gerar a URL."
      : !row.offer_id
        ? "Vincule esta página a uma oferta antes de publicar."
        : row.offer_status !== "active"
          ? "A oferta precisa estar ativa."
          : row.funnel_id && row.funnel_status !== "published"
            ? "O funil vinculado precisa estar publicado."
            : "A versão publicada ainda não está disponível.";
  return {
    id: row.id,
    funnelId: row.funnel_id,
    offerId: row.offer_id,
    offerName: row.offer_name,
    name: row.name,
    slug: row.slug,
    pageType: row.page_type,
    status: row.status,
    revision: Number(row.revision ?? 0),
    content,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    publicUrl: isLive
      ? `${origin}/o/${row.offer_slug ?? slugify(row.offer_name ?? "oferta")}/${row.slug}`
      : null,
    isLive,
    publicationIssue
  };
}

function validateStatus(value: unknown, allowed: readonly string[], fallback: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new ValidationError("Status inválido.");
  }
  return value;
}

function validateGraph(value: unknown): FunnelGraph {
  const body = parseBodyRecord(value);
  const nodes = Array.isArray(body.nodes) ? body.nodes : [];
  const edges = Array.isArray(body.edges) ? body.edges : [];
  if (nodes.length > 100 || edges.length > 200) throw new ValidationError("O mapa excedeu o limite.");
  const allowedTypes: FunnelNodeType[] = ["page", "vsl", "lead", "checkout"];
  const parsedNodes = nodes.map((item, index) => {
    const node = parseBodyRecord(item);
    const position = parseBodyRecord(node.position ?? {});
    const rawType = optionalString(node.type, 40) ?? "page";
    if (!allowedTypes.includes(rawType as FunnelNodeType)) {
      throw new ValidationError(`Tipo de etapa inválido na posição ${index + 1}.`);
    }
    const rawConfig = node.config && typeof node.config === "object" && !Array.isArray(node.config)
      ? node.config as Record<string, unknown>
      : {};
    const config = { ...rawConfig };
    for (const key of ["pageId", "assetId", "ctaLabel"] as const) {
      if (key in config) {
        const parsed = optionalString(config[key], key === "ctaLabel" ? 160 : 100);
        if (parsed) config[key] = parsed;
        else delete config[key];
      }
    }
    if ("url" in config) {
      const parsed = parseHttpUrl(config.url);
      if (parsed) config.url = parsed;
      else delete config.url;
    }
    return {
      id: optionalString(node.id, 100) ?? randomId(),
      type: rawType as FunnelNodeType,
      label: optionalString(node.label, 120) ?? `Etapa ${index + 1}`,
      position: {
        x: Number.isFinite(Number(position.x)) ? Number(position.x) : index * 260,
        y: Number.isFinite(Number(position.y)) ? Number(position.y) : 100
      },
      config
    };
  });
  const ids = new Set(parsedNodes.map((node) => node.id));
  if (ids.size !== parsedNodes.length) {
    throw new ValidationError("O mapa possui etapas duplicadas. Recarregue e tente novamente.");
  }
  const parsedEdges = edges
    .map((item) => {
      const edge = parseBodyRecord(item);
      return {
        id: optionalString(edge.id, 100) ?? randomId(),
        source: requiredString(edge.source, "Origem", 100),
        target: requiredString(edge.target, "Destino", 100),
        label: optionalString(edge.label, 80) ?? undefined
      };
    });
  if (parsedEdges.some((edge) =>
    !ids.has(edge.source) || !ids.has(edge.target) || edge.source === edge.target
  )) {
    throw new ValidationError("O mapa possui uma conexão inválida.");
  }
  const edgeIds = new Set<string>();
  const connections = new Set<string>();
  for (const edge of parsedEdges) {
    const connection = `${edge.source}\u0000${edge.target}`;
    if (edgeIds.has(edge.id) || connections.has(connection)) {
      throw new ValidationError("O mapa possui uma conexão duplicada.");
    }
    edgeIds.add(edge.id);
    connections.add(connection);
  }
  const graph: FunnelGraph = {
    version: Math.max(Math.trunc(Number(body.version) || 1), 1),
    nodes: parsedNodes,
    edges: parsedEdges
  };
  const inspection = inspectFunnelGraph(graph);
  if (inspection.duplicatePageIds.length) {
    throw new ValidationError("Uma mesma página não pode ocupar duas etapas do funil.");
  }
  return graph;
}

function validateDocument(value: unknown): PageDocument {
  const body = parseBodyRecord(value);
  const theme = parseBodyRecord(body.theme ?? {});
  const blocks = Array.isArray(body.blocks) ? body.blocks : [];
  if (blocks.length > 120) throw new ValidationError("A página excedeu 120 blocos.");
  const raw = JSON.stringify(value);
  if (raw.length > 500_000) throw new ValidationError("O conteúdo da página é muito grande.");
  return {
    version: Number(body.version) || 1,
    theme: {
      background: optionalString(theme.background, 20) ?? "#070b16",
      text: optionalString(theme.text, 20) ?? "#f5f7fb",
      accent: optionalString(theme.accent, 20) ?? "#f00000",
      font: optionalString(theme.font, 80) ?? undefined,
      maxWidth: Math.min(Math.max(Number(theme.maxWidth) || 920, 320), 1440),
      contentAlign: ["left", "center", "right"].includes(String(theme.contentAlign))
        ? theme.contentAlign as "left" | "center" | "right"
        : "center",
      buttonRadius: Math.min(Math.max(Number(theme.buttonRadius) || 14, 0), 999)
    },
    blocks: blocks.map((item) => {
      const block = parseBodyRecord(item);
      const allowed = [
        "heading",
        "paragraph",
        "image",
        "video",
        "button",
        "spacer",
        "divider",
        "leadForm",
        "quiz",
        "html"
      ] as const;
      const type = allowed.includes(block.type as typeof allowed[number])
        ? block.type as typeof allowed[number]
        : "paragraph";
      return {
        id: optionalString(block.id, 100) ?? randomId(),
        type,
        content: block.content ?? "",
        settings:
          block.settings && typeof block.settings === "object"
            ? block.settings as Record<string, unknown>
            : undefined
      };
    }),
    settings:
      body.settings && typeof body.settings === "object"
        ? body.settings
        : undefined
  };
}

interface FunnelLinkRow {
  id: string;
  offer_id: string | null;
  graph_json: string;
}

interface PageLinkRow {
  id: string;
  offer_id: string | null;
  funnel_id: string | null;
  status?: string;
  content_json?: string | null;
}

async function ensureOfferExists(env: Env, offerId: string | null): Promise<void> {
  if (!offerId) return;
  const found = await env.DB.prepare("SELECT id FROM offers WHERE id = ?")
    .bind(offerId)
    .first<{ id: string }>();
  if (!found) throw new ValidationError("A oferta selecionada não existe mais.");
}

async function resolvePageRelationship(
  env: Env,
  requestedOfferId: string | null,
  requestedFunnelId: string | null
): Promise<{ offerId: string | null; funnelId: string | null }> {
  let offerId = requestedOfferId;
  if (requestedFunnelId) {
    const funnel = await env.DB.prepare("SELECT id, offer_id FROM funnels WHERE id = ?")
      .bind(requestedFunnelId)
      .first<{ id: string; offer_id: string | null }>();
    if (!funnel) throw new ValidationError("O funil selecionado não existe mais.");
    if (funnel.offer_id && offerId && funnel.offer_id !== offerId) {
      throw new ValidationError("A página e o funil precisam pertencer à mesma oferta.");
    }
    if (!funnel.offer_id && offerId) {
      throw new ValidationError("Vincule o funil à oferta antes de adicionar páginas.");
    }
    offerId = funnel.offer_id ?? offerId;
  }
  await ensureOfferExists(env, offerId);
  return { offerId, funnelId: requestedFunnelId };
}

function graphStorageStatements(env: Env, funnelId: string, graph: FunnelGraph): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `UPDATE funnels SET graph_json = ?, graph_version = graph_version + 1,
       updated_at = datetime('now') WHERE id = ?`
    ).bind(JSON.stringify(graph), funnelId),
    env.DB.prepare("DELETE FROM funnel_edges WHERE funnel_id = ?").bind(funnelId),
    env.DB.prepare("DELETE FROM funnel_nodes WHERE funnel_id = ?").bind(funnelId)
  ];
  for (const node of graph.nodes) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO funnel_nodes(id, funnel_id, node_type, label, position_x, position_y, config_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        node.id,
        funnelId,
        node.type,
        node.label,
        node.position.x,
        node.position.y,
        JSON.stringify(node.config ?? {})
      )
    );
  }
  for (const edge of graph.edges) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO funnel_edges(id, funnel_id, source_node_id, target_node_id, label)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(edge.id, funnelId, edge.source, edge.target, edge.label ?? null)
    );
  }
  return statements;
}

function nodeTypeForPage(pageType: string): FunnelNodeType {
  if (["vsl", "video"].includes(pageType)) return "vsl";
  if (["lead", "capture", "quiz"].includes(pageType)) return "lead";
  return "page";
}

async function preparePageGraphChange(
  env: Env,
  page: { id: string; name: string; pageType: string },
  previousFunnelId: string | null,
  nextFunnelId: string | null
): Promise<D1PreparedStatement[]> {
  const funnelIds = [...new Set(
    [previousFunnelId, nextFunnelId].filter((value): value is string => Boolean(value))
  )];
  if (!funnelIds.length) return [];

  const graphs = new Map<string, FunnelGraph>();
  const changedFunnelIds = new Set<string>();
  for (const funnelId of funnelIds) {
    const row = await env.DB.prepare("SELECT id, offer_id, graph_json FROM funnels WHERE id = ?")
      .bind(funnelId)
      .first<FunnelLinkRow>();
    if (!row) throw new ValidationError("O funil selecionado não existe mais.");
    graphs.set(
      funnelId,
      validateGraph(safeJson<FunnelGraph>(row.graph_json, { version: 1, nodes: [], edges: [] }))
    );
  }

  let preferredNodeId: string | null = null;
  for (const [funnelId, graph] of graphs) {
    for (const node of graph.nodes) {
      if (node.config?.pageId !== page.id) continue;
      if (nextFunnelId && graph === graphs.get(nextFunnelId)) preferredNodeId = node.id;
      const config = { ...(node.config ?? {}) };
      delete config.pageId;
      node.config = config;
      changedFunnelIds.add(funnelId);
    }
  }

  if (nextFunnelId) {
    const graph = graphs.get(nextFunnelId)!;
    const desiredType = nodeTypeForPage(page.pageType);
    let target = preferredNodeId
      ? graph.nodes.find((node) => node.id === preferredNodeId)
      : undefined;
    target ??= graph.nodes.find((node) =>
      node.type === desiredType && !node.config?.pageId
    );
    target ??= graph.nodes.find((node) =>
      node.type !== "checkout" && !node.config?.pageId
    );
    if (!target) {
      const previous = graph.nodes.at(-1);
      target = {
        id: randomId(),
        type: desiredType,
        label: page.name,
        position: {
          x: Math.max(...graph.nodes.map((node) => node.position.x), -180) + 280,
          y: previous?.position.y ?? 120
        },
        config: {}
      };
      graph.nodes.push(target);
      if (previous) {
        graph.edges.push({
          id: randomId(),
          source: previous.id,
          target: target.id
        });
      }
    }
    target.config = { ...(target.config ?? {}), pageId: page.id };
    if (!target.label.trim() || /^Etapa \d+$/.test(target.label) || target.label === "Página principal") {
      target.label = page.name;
    }
    changedFunnelIds.add(nextFunnelId);
  }

  for (const funnelId of changedFunnelIds) {
    const graph = graphs.get(funnelId);
    if (graph) graph.version += 1;
  }
  return funnelIds.flatMap((funnelId) =>
    graphStorageStatements(env, funnelId, graphs.get(funnelId)!)
  );
}

async function validateGraphPageLinks(
  env: Env,
  funnelId: string,
  offerId: string | null,
  graph: FunnelGraph
): Promise<{ rows: PageLinkRow[]; statements: D1PreparedStatement[] }> {
  const inspection = inspectFunnelGraph(graph);
  if (inspection.duplicatePageIds.length) {
    throw new ValidationError("Uma página foi vinculada a mais de uma etapa.");
  }
  const uniquePageIds = [...new Set(inspection.pageIds)];
  let rows: PageLinkRow[] = [];
  if (uniquePageIds.length) {
    const placeholders = uniquePageIds.map(() => "?").join(", ");
    rows = (
      await env.DB.prepare(
        `SELECT id, offer_id, funnel_id FROM pages WHERE id IN (${placeholders})`
      ).bind(...uniquePageIds).all<PageLinkRow>()
    ).results;
    if (rows.length !== uniquePageIds.length) {
      throw new ValidationError("Uma das páginas vinculadas não existe mais.");
    }
    for (const row of rows) {
      if (row.funnel_id && row.funnel_id !== funnelId) {
        throw new ValidationError("Uma página selecionada já pertence a outro funil.");
      }
      if (row.offer_id && row.offer_id !== offerId) {
        throw new ValidationError("Todas as páginas precisam pertencer à oferta do funil.");
      }
      if (!offerId && row.offer_id) {
        throw new ValidationError("Vincule o funil à oferta da página antes de salvar.");
      }
    }
  }

  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      "UPDATE pages SET funnel_id = NULL, updated_at = datetime('now') WHERE funnel_id = ?"
    ).bind(funnelId)
  ];
  for (const pageId of uniquePageIds) {
    statements.push(
      env.DB.prepare(
        `UPDATE pages SET funnel_id = ?, offer_id = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).bind(funnelId, offerId, pageId)
    );
  }
  return { rows, statements };
}

type FunnelReadiness =
  | {
      ready: true;
      offerId: string;
      pageIds: string[];
      graph: FunnelGraph;
    }
  | {
      ready: false;
      code: string;
      message: string;
      details?: Record<string, unknown>;
    };

async function inspectFunnelReadiness(env: Env, funnelId: string): Promise<FunnelReadiness | null> {
  const current = await env.DB.prepare(
    `SELECT f.id, f.offer_id, f.graph_json, o.checkout_url
     FROM funnels f LEFT JOIN offers o ON o.id = f.offer_id WHERE f.id = ?`
  ).bind(funnelId).first<{
    id: string;
    offer_id: string | null;
    graph_json: string;
    checkout_url: string | null;
  }>();
  if (!current) return null;
  if (!current.offer_id) {
    return {
      ready: false,
      code: "FUNNEL_WITHOUT_OFFER",
      message: "Vincule o funil a uma oferta antes de publicar."
    };
  }

  let graph: FunnelGraph;
  try {
    graph = validateGraph(
      safeJson<FunnelGraph>(current.graph_json, { version: 1, nodes: [], edges: [] })
    );
  } catch (error) {
    return {
      ready: false,
      code: "FUNNEL_GRAPH_INVALID",
      message: error instanceof Error ? error.message : "O mapa do funil está inválido."
    };
  }
  if (!graph.nodes.length) {
    return {
      ready: false,
      code: "FUNNEL_EMPTY",
      message: "Adicione pelo menos uma etapa antes de publicar."
    };
  }
  const inspection = inspectFunnelGraph(graph);
  if (inspection.disconnectedNodeIds.length) {
    return {
      ready: false,
      code: "FUNNEL_DISCONNECTED",
      message: "Conecte todas as etapas do mapa antes de publicar.",
      details: { nodeIds: inspection.disconnectedNodeIds }
    };
  }
  if (inspection.unlinkedContentNodeIds.length) {
    return {
      ready: false,
      code: "FUNNEL_UNLINKED_STEPS",
      message: "Escolha uma página para cada etapa de conteúdo.",
      details: { nodeIds: inspection.unlinkedContentNodeIds }
    };
  }
  if (!inspection.pageIds.length) {
    return {
      ready: false,
      code: "FUNNEL_WITHOUT_PAGE",
      message: "O funil precisa ter ao menos uma página publicável."
    };
  }
  const checkoutWithoutDestination = graph.nodes.some((node) =>
    node.type === "checkout" && !node.config?.url && !current.checkout_url
  );
  if (checkoutWithoutDestination) {
    return {
      ready: false,
      code: "CHECKOUT_WITHOUT_DESTINATION",
      message: "Configure a URL do checkout na etapa ou na oferta."
    };
  }

  const pageIds = [...new Set(inspection.pageIds)];
  const placeholders = pageIds.map(() => "?").join(", ");
  const pages = (
    await env.DB.prepare(
      `SELECT p.id, p.offer_id, p.funnel_id, p.status, d.content_json
       FROM pages p LEFT JOIN page_drafts d ON d.page_id = p.id
       WHERE p.id IN (${placeholders})`
    ).bind(...pageIds).all<PageLinkRow>()
  ).results;
  if (pages.length !== pageIds.length) {
    return {
      ready: false,
      code: "FUNNEL_PAGE_MISSING",
      message: "Uma página do mapa foi excluída. Escolha outra página."
    };
  }
  const invalidPage = pages.find((page) =>
    page.offer_id !== current.offer_id
    || page.funnel_id !== funnelId
    || page.status === "archived"
    || !page.content_json
  );
  if (invalidPage) {
    return {
      ready: false,
      code: "FUNNEL_PAGE_NOT_PUBLISHABLE",
      message: "Revise os vínculos: todas as etapas precisam de uma página editável da mesma oferta.",
      details: { pageId: invalidPage.id }
    };
  }
  const hasContent = pages.some((page) => {
    const document = safeJson<PageDocument | null>(page.content_json, null);
    return Boolean(document?.blocks.length);
  });
  if (!hasContent) {
    return {
      ready: false,
      code: "FUNNEL_WITHOUT_PUBLISHABLE_CONTENT",
      message: "Adicione conteúdo a pelo menos uma página antes de publicar."
    };
  }
  return { ready: true, offerId: current.offer_id, pageIds, graph };
}

type ReadyFunnel = Extract<FunnelReadiness, { ready: true }>;

interface PublicationPageRow {
  id: string;
  content_json: string;
  next_version: number;
}

async function prepareFunnelPublication(
  env: Env,
  user: SessionUser,
  funnelId: string,
  readiness: ReadyFunnel
): Promise<{
  statements: D1PreparedStatement[];
  versionNumbers: Map<string, number>;
}> {
  const placeholders = readiness.pageIds.map(() => "?").join(", ");
  const rows = (
    await env.DB.prepare(
      `SELECT p.id, d.content_json,
         COALESCE(MAX(v.version_number), 0) + 1 AS next_version
       FROM pages p
       JOIN page_drafts d ON d.page_id = p.id
       LEFT JOIN page_versions v ON v.page_id = p.id
       WHERE p.id IN (${placeholders})
       GROUP BY p.id, d.content_json`
    ).bind(...readiness.pageIds).all<PublicationPageRow>()
  ).results;
  if (rows.length !== readiness.pageIds.length) {
    throw new ValidationError(
      "Não foi possível preparar todas as páginas do funil para publicação."
    );
  }

  const statements: D1PreparedStatement[] = [];
  const versionNumbers = new Map<string, number>();
  for (const row of rows) {
    const versionId = randomId();
    const versionNumber = Number(row.next_version);
    versionNumbers.set(row.id, versionNumber);
    statements.push(
      env.DB.prepare(
        `INSERT INTO page_versions(
           id, page_id, version_number, content_json, created_by
         ) VALUES (?, ?, ?, ?, ?)`
      ).bind(versionId, row.id, versionNumber, row.content_json, user.id),
      env.DB.prepare(
        `UPDATE pages
         SET status = 'published', published_version_id = ?,
           published_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ?`
      ).bind(versionId, row.id)
    );
  }
  statements.push(
    env.DB.prepare(
      `UPDATE funnels SET status = 'published', published_at = datetime('now'),
       updated_at = datetime('now') WHERE id = ?`
    ).bind(funnelId),
    env.DB.prepare(
      "UPDATE offers SET status = 'active', updated_at = datetime('now') WHERE id = ?"
    ).bind(readiness.offerId)
  );
  return { statements, versionNumbers };
}

async function listOffers(env: Env): Promise<OfferRow[]> {
  const result = await env.DB.prepare(
    `SELECT o.*,
      (SELECT COUNT(*) FROM funnels f WHERE f.offer_id = o.id AND f.status != 'archived') AS funnel_count,
      (SELECT COUNT(*) FROM pages p WHERE p.offer_id = o.id AND p.status != 'archived') AS page_count
     FROM offers o ORDER BY o.updated_at DESC`
  ).all<OfferRow>();
  return result.results;
}

async function listFunnels(env: Env, offerId: string | null): Promise<FunnelRow[]> {
  const where = offerId ? "WHERE f.offer_id = ?" : "";
  const statement = env.DB.prepare(
    `SELECT f.*, o.name AS offer_name FROM funnels f
     LEFT JOIN offers o ON o.id = f.offer_id ${where}
     ORDER BY f.updated_at DESC`
  );
  const result = offerId
    ? await statement.bind(offerId).all<FunnelRow>()
    : await statement.all<FunnelRow>();
  return result.results;
}

async function listPages(env: Env, offerId: string | null): Promise<PageRow[]> {
  const where = offerId ? "WHERE p.offer_id = ?" : "";
  const statement = env.DB.prepare(
    `SELECT p.*, o.name AS offer_name, o.slug AS offer_slug, o.status AS offer_status,
       f.status AS funnel_status, d.revision, d.content_json
     FROM pages p
     LEFT JOIN offers o ON o.id = p.offer_id
     LEFT JOIN funnels f ON f.id = p.funnel_id
     LEFT JOIN page_drafts d ON d.page_id = p.id
     ${where} ORDER BY p.updated_at DESC`
  );
  const result = offerId
    ? await statement.bind(offerId).all<PageRow>()
    : await statement.all<PageRow>();
  return result.results;
}

async function createOffer(request: Request, env: Env, user: SessionUser): Promise<Response> {
  const body = parseBodyRecord(await readJson(request, 64_000));
  const id = randomId();
  const name = requiredString(body.name, "Nome");
  const slug = makeUniqueSlug(name, body.slug);
  const checkoutUrl = parseHttpUrl(body.checkoutUrl);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO offers(id, name, slug, status, checkout_url, created_by)
       VALUES (?, ?, ?, 'draft', ?, ?)`
    ).bind(id, name, slug, checkoutUrl, user.id),
    audit(env, user.id, "offer.created", "offer", id)
  ]);
  return json({ offer: mapOffer((await listOffers(env)).find((item) => item.id === id)!) }, { status: 201 });
}

async function updateOffer(
  request: Request,
  env: Env,
  user: SessionUser,
  id: string
): Promise<Response> {
  const body = parseBodyRecord(await readJson(request, 64_000));
  const current = await env.DB.prepare("SELECT * FROM offers WHERE id = ?").bind(id).first<OfferRow>();
  if (!current) return errorResponse(404, "NOT_FOUND", "Oferta não encontrada.");
  const name = body.name === undefined ? current.name : requiredString(body.name, "Nome");
  const slug =
    body.slug === undefined ? current.slug : slugify(requiredString(body.slug, "Slug", 80));
  const status = validateStatus(body.status, ["draft", "active", "archived"], current.status);
  const checkoutUrl =
    body.checkoutUrl === undefined ? current.checkout_url : parseHttpUrl(body.checkoutUrl);
  const pixels =
    body.pixelConfig === undefined
      ? current.pixel_config_json
      : JSON.stringify(parseBodyRecord(body.pixelConfig));
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE offers SET name = ?, slug = ?, status = ?, checkout_url = ?,
       pixel_config_json = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(name, slug, status, checkoutUrl, pixels, id),
    audit(env, user.id, "offer.updated", "offer", id)
  ]);
  const row = (await listOffers(env)).find((item) => item.id === id)!;
  return json({ offer: mapOffer(row) });
}

async function deleteOffer(env: Env, user: SessionUser, id: string): Promise<Response> {
  const current = await env.DB.prepare(
    `SELECT o.*,
      (SELECT COUNT(*) FROM funnels f WHERE f.offer_id = o.id) AS funnel_count,
      (SELECT COUNT(*) FROM pages p WHERE p.offer_id = o.id) AS page_count
     FROM offers o WHERE o.id = ?`
  ).bind(id).first<OfferRow>();
  if (!current) return errorResponse(404, "NOT_FOUND", "Oferta não encontrada.");
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE pages SET offer_id = NULL, status = 'draft', published_version_id = NULL,
       published_at = NULL, updated_at = datetime('now') WHERE offer_id = ?`
    ).bind(id),
    env.DB.prepare(
      `UPDATE funnels SET offer_id = NULL, status = 'draft', published_at = NULL,
       updated_at = datetime('now') WHERE offer_id = ?`
    ).bind(id),
    env.DB.prepare("DELETE FROM offers WHERE id = ?").bind(id),
    audit(env, user.id, "offer.deleted", "offer", id, {
      name: current.name,
      detachedFunnels: Number(current.funnel_count),
      detachedPages: Number(current.page_count)
    })
  ]);
  return json({
    ok: true,
    detachedFunnels: Number(current.funnel_count),
    detachedPages: Number(current.page_count)
  });
}

async function createFunnel(request: Request, env: Env, user: SessionUser): Promise<Response> {
  const body = parseBodyRecord(await readJson(request, 128_000));
  const id = randomId();
  const name = requiredString(body.name, "Nome");
  const slug = makeUniqueSlug(name, body.slug);
  const offerId = optionalString(body.offerId, 100);
  await ensureOfferExists(env, offerId);
  const firstNodeId = randomId();
  const graph: FunnelGraph = {
    version: 1,
    nodes: [
      {
        id: firstNodeId,
        type: "page",
        label: "Página principal",
        position: { x: 80, y: 120 },
        config: {}
      }
    ],
    edges: []
  };
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO funnels(id, offer_id, name, slug, graph_json, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(id, offerId, name, slug, JSON.stringify(graph), user.id),
    env.DB.prepare(
      `INSERT INTO funnel_nodes(id, funnel_id, node_type, label, position_x, position_y)
       VALUES (?, ?, 'page', 'Página principal', 80, 120)`
    ).bind(firstNodeId, id),
    audit(env, user.id, "funnel.created", "funnel", id)
  ]);
  return json({ funnel: mapFunnel((await listFunnels(env, null)).find((item) => item.id === id)!) }, { status: 201 });
}

async function updateFunnel(
  request: Request,
  env: Env,
  user: SessionUser,
  id: string
): Promise<Response> {
  const body = parseBodyRecord(await readJson(request, 1_000_000));
  const current = await env.DB.prepare(
    "SELECT f.*, o.name AS offer_name FROM funnels f LEFT JOIN offers o ON o.id = f.offer_id WHERE f.id = ?"
  ).bind(id).first<FunnelRow>();
  if (!current) return errorResponse(404, "NOT_FOUND", "Funil não encontrado.");
  const graph = body.graph === undefined
    ? safeJson<FunnelGraph>(current.graph_json, { version: 1, nodes: [], edges: [] })
    : validateGraph(body.graph);
  const name = body.name === undefined ? current.name : requiredString(body.name, "Nome");
  const status = validateStatus(
    body.status,
    ["draft", "published", "archived"],
    current.status
  );
  const offerId =
    body.offerId === undefined ? current.offer_id : optionalString(body.offerId, 100);
  await ensureOfferExists(env, offerId);
  const linkSync = await validateGraphPageLinks(env, id, offerId, graph);
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `UPDATE funnels SET name = ?, offer_id = ?, status = ?,
       updated_at = datetime('now') WHERE id = ?`
    ).bind(name, offerId, status, id),
    ...graphStorageStatements(env, id, graph),
    ...linkSync.statements
  ];
  statements.push(audit(env, user.id, "funnel.updated", "funnel", id));
  await env.DB.batch(statements);
  return json({ funnel: mapFunnel((await listFunnels(env, null)).find((item) => item.id === id)!) });
}

async function publishFunnel(env: Env, user: SessionUser, id: string): Promise<Response> {
  const readiness = await inspectFunnelReadiness(env, id);
  if (!readiness) return errorResponse(404, "NOT_FOUND", "Funil não encontrado.");
  if (!readiness.ready) {
    return errorResponse(409, readiness.code, readiness.message, readiness.details);
  }
  const publication = await prepareFunnelPublication(env, user, id, readiness);
  await env.DB.batch([
    ...publication.statements,
    audit(env, user.id, "funnel.published", "funnel", id, {
      linkedPages: readiness.pageIds.length
    })
  ]);
  return json({ ok: true, linkedPages: readiness.pageIds.length });
}

async function deleteFunnel(env: Env, user: SessionUser, id: string): Promise<Response> {
  const current = await env.DB.prepare(
    `SELECT f.*,
      (SELECT COUNT(*) FROM pages p WHERE p.funnel_id = f.id) AS page_count,
      (SELECT COUNT(*) FROM domains d WHERE d.funnel_id = f.id) AS domain_count
     FROM funnels f WHERE f.id = ?`
  ).bind(id).first<FunnelRow & { page_count: number; domain_count: number }>();
  if (!current) return errorResponse(404, "NOT_FOUND", "Funil não encontrado.");
  if (Number(current.domain_count) > 0) {
    return errorResponse(
      409,
      "FUNNEL_HAS_DOMAINS",
      "Remova ou transfira os domínios vinculados antes de excluir este funil.",
      { domainCount: Number(current.domain_count) }
    );
  }
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE pages SET funnel_id = NULL, updated_at = datetime('now') WHERE funnel_id = ?"
    ).bind(id),
    env.DB.prepare("DELETE FROM funnels WHERE id = ?").bind(id),
    audit(env, user.id, "funnel.deleted", "funnel", id, {
      name: current.name,
      preservedPages: Number(current.page_count)
    })
  ]);
  return json({ ok: true, preservedPages: Number(current.page_count) });
}

async function duplicateFunnel(env: Env, user: SessionUser, id: string): Promise<Response> {
  const current = await env.DB.prepare(
    "SELECT f.*, o.name AS offer_name FROM funnels f LEFT JOIN offers o ON o.id = f.offer_id WHERE f.id = ?"
  ).bind(id).first<FunnelRow>();
  if (!current) return errorResponse(404, "NOT_FOUND", "Funil não encontrado.");
  const newId = randomId();
  const graph = safeJson<FunnelGraph>(current.graph_json, { version: 1, nodes: [], edges: [] });
  const nodeMap = new Map<string, string>();
  const copyGraph: FunnelGraph = {
    version: 1,
    nodes: graph.nodes.map((node) => {
      const nodeId = randomId();
      nodeMap.set(node.id, nodeId);
      const config = { ...(node.config ?? {}) };
      delete config.pageId;
      return { ...node, id: nodeId, config };
    }),
    edges: graph.edges.map((edge) => ({
      ...edge,
      id: randomId(),
      source: nodeMap.get(edge.source) ?? edge.source,
      target: nodeMap.get(edge.target) ?? edge.target
    }))
  };
  await env.DB.prepare(
    `INSERT INTO funnels(id, offer_id, name, slug, graph_json, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    newId,
    current.offer_id,
    `${current.name} — cópia`,
    makeUniqueSlug(current.slug),
    JSON.stringify(copyGraph),
    user.id
  ).run();
  return updateFunnel(
    new Request("https://local/api", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ graph: copyGraph })
    }),
    env,
    user,
    newId
  );
}

async function createPage(
  request: Request,
  env: Env,
  user: SessionUser,
  origin: string
): Promise<Response> {
  const body = parseBodyRecord(await readJson(request, 640_000));
  const id = randomId();
  const name = requiredString(body.name, "Nome");
  const slug = slugify(optionalString(body.slug, 80) ?? name) || `pagina-${id.slice(0, 6)}`;
  const relationship = await resolvePageRelationship(
    env,
    optionalString(body.offerId, 100),
    optionalString(body.funnelId, 100)
  );
  const { funnelId, offerId } = relationship;
  const pageType = optionalString(body.pageType, 40) ?? "sales";
  let content = DEFAULT_DOCUMENT;
  if (body.templateId) {
    const template = await env.DB.prepare("SELECT content_json FROM templates WHERE id = ?")
      .bind(requiredString(body.templateId, "Template", 100))
      .first<{ content_json: string }>();
    if (template) content = safeJson<PageDocument>(template.content_json, DEFAULT_DOCUMENT);
  }
  if (body.content) content = validateDocument(body.content);
  const graphStatements = await preparePageGraphChange(
    env,
    { id, name, pageType },
    null,
    funnelId
  );
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO pages(id, funnel_id, offer_id, name, slug, page_type, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, funnelId, offerId, name, slug, pageType, user.id),
    env.DB.prepare(
      `INSERT INTO page_drafts(page_id, content_json, updated_by) VALUES (?, ?, ?)`
    ).bind(id, JSON.stringify(content), user.id),
    ...graphStatements,
    audit(env, user.id, "page.created", "page", id)
  ]);
  const row = (await listPages(env, null)).find((item) => item.id === id)!;
  return json({ page: mapPage(row, origin) }, { status: 201 });
}

async function updatePage(
  request: Request,
  env: Env,
  user: SessionUser,
  id: string,
  origin: string
): Promise<Response> {
  const body = parseBodyRecord(await readJson(request, 640_000));
  const current = await env.DB.prepare(
    `SELECT p.*, o.name AS offer_name, o.slug AS offer_slug, d.revision, d.content_json FROM pages p
     LEFT JOIN offers o ON o.id = p.offer_id LEFT JOIN page_drafts d ON d.page_id = p.id
     WHERE p.id = ?`
  ).bind(id).first<PageRow>();
  const hasOfferId = Object.prototype.hasOwnProperty.call(body, "offerId");
  const hasFunnelId = Object.prototype.hasOwnProperty.call(body, "funnelId");
  const requestedOfferId = hasOfferId ? optionalString(body.offerId, 100) : current?.offer_id ?? null;
  const requestedFunnelId = hasFunnelId ? optionalString(body.funnelId, 100) : current?.funnel_id ?? null;
  const relationship = await resolvePageRelationship(env, requestedOfferId, requestedFunnelId);
  const relationshipChanged = current !== null && (
    relationship.offerId !== current.offer_id || relationship.funnelId !== current.funnel_id
  );
  if (!current) return errorResponse(404, "NOT_FOUND", "Página não encontrada.");
  const name = body.name === undefined ? current.name : requiredString(body.name, "Nome");
  const slug =
    body.slug === undefined ? current.slug : slugify(requiredString(body.slug, "Slug", 80));
  const requestedStatus = validateStatus(
    body.status,
    ["draft", "published", "archived"],
    current.status
  );
  const status = relationshipChanged && requestedStatus === "published"
    ? "draft"
    : requestedStatus;
  const content =
    body.content === undefined
      ? safeJson<PageDocument>(current.content_json, DEFAULT_DOCUMENT)
      : validateDocument(body.content);
  const revision = Number(body.revision ?? current.revision ?? 0);
  if (body.content !== undefined && revision !== Number(current.revision ?? 0)) {
    return errorResponse(
      409,
      "REVISION_CONFLICT",
      "Esta página foi alterada em outra sessão. Recarregue antes de salvar."
    );
  }
  const graphStatements = relationshipChanged || hasFunnelId
    ? await preparePageGraphChange(
        env,
        { id, name, pageType: current.page_type },
        current.funnel_id,
        relationship.funnelId
      )
    : [];
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `UPDATE pages SET name = ?, slug = ?, status = ?, offer_id = ?, funnel_id = ?,
       published_version_id = CASE WHEN ? = 1 THEN NULL ELSE published_version_id END,
       published_at = CASE WHEN ? = 1 THEN NULL ELSE published_at END,
       updated_at = datetime('now') WHERE id = ?`
    ).bind(
      name,
      slug,
      status,
      relationship.offerId,
      relationship.funnelId,
      relationshipChanged ? 1 : 0,
      relationshipChanged ? 1 : 0,
      id
    ),
    ...graphStatements
  ];
  if (body.content !== undefined) {
    statements.push(
      env.DB.prepare(
        `UPDATE page_drafts SET content_json = ?, revision = revision + 1,
         updated_by = ?, updated_at = datetime('now') WHERE page_id = ?`
      ).bind(JSON.stringify(content), user.id, id)
    );
  }
  statements.push(audit(env, user.id, "page.saved", "page", id));
  await env.DB.batch(statements);
  const row = (await listPages(env, null)).find((item) => item.id === id)!;
  return json({ page: mapPage(row, origin) });
}

async function publishPage(
  env: Env,
  user: SessionUser,
  id: string,
  origin: string
): Promise<Response> {
  const current = await env.DB.prepare(
    `SELECT p.*, o.name AS offer_name, o.slug AS offer_slug, o.status AS offer_status,
       f.status AS funnel_status, d.revision, d.content_json FROM pages p
     LEFT JOIN offers o ON o.id = p.offer_id
     LEFT JOIN funnels f ON f.id = p.funnel_id
     LEFT JOIN page_drafts d ON d.page_id = p.id
     WHERE p.id = ?`
  ).bind(id).first<PageRow>();
  if (!current?.content_json) return errorResponse(404, "NOT_FOUND", "Página não encontrada.");
  if (!current.offer_id || !current.offer_slug) {
    return errorResponse(
      409,
      "PAGE_WITHOUT_OFFER",
      "Vincule a página a uma oferta antes de publicar."
    );
  }
  const publishedFunnel = Boolean(
    current.funnel_id && current.funnel_status !== "published"
  );
  let nextVersion: number;
  let statements: D1PreparedStatement[];
  let linkedPagesPublished = 1;
  if (current.funnel_id) {
    const readiness = await inspectFunnelReadiness(env, current.funnel_id);
    if (!readiness) {
      return errorResponse(409, "FUNNEL_MISSING", "O funil vinculado não existe mais.");
    }
    if (!readiness.ready) {
      return errorResponse(409, readiness.code, readiness.message, readiness.details);
    }
    const publication = await prepareFunnelPublication(
      env,
      user,
      current.funnel_id,
      readiness
    );
    nextVersion = publication.versionNumbers.get(id) ?? 1;
    statements = publication.statements;
    linkedPagesPublished = readiness.pageIds.length;
  } else {
    nextVersion =
      (await env.DB.prepare(
        "SELECT COALESCE(MAX(version_number), 0) + 1 AS value FROM page_versions WHERE page_id = ?"
      ).bind(id).first<number>("value")) ?? 1;
    const versionId = randomId();
    statements = [
      env.DB.prepare(
        `INSERT INTO page_versions(id, page_id, version_number, content_json, created_by)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(versionId, id, nextVersion, current.content_json, user.id),
      env.DB.prepare(
        `UPDATE pages SET status = 'published', published_version_id = ?,
         published_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
      ).bind(versionId, id),
      env.DB.prepare(
        "UPDATE offers SET status = 'active', updated_at = datetime('now') WHERE id = ?"
      ).bind(current.offer_id)
    ];
  }
  statements.push(audit(env, user.id, "page.published", "page", id, {
    version: nextVersion,
    activatedOffer: current.offer_status !== "active",
    publishedFunnel,
    linkedPagesPublished
  }));
  await env.DB.batch(statements);
  const row = (await listPages(env, null)).find((item) => item.id === id)!;
  const page = mapPage(row, origin);
  if (!page.isLive || !page.publicUrl) {
    return errorResponse(
      500,
      "PUBLICATION_NOT_LIVE",
      "A versão foi salva, mas a rota pública não ficou disponível. Tente publicar novamente."
    );
  }
  return json({
    page,
    versionNumber: nextVersion,
    live: true,
    publicUrl: page.publicUrl,
    activatedOffer: current.offer_status !== "active",
    publishedFunnel
  });
}

async function deletePage(env: Env, user: SessionUser, id: string): Promise<Response> {
  const current = await env.DB.prepare(
    "SELECT id, name, status, page_type, funnel_id FROM pages WHERE id = ?"
  )
    .bind(id)
    .first<{
      id: string;
      name: string;
      status: string;
      page_type: string;
      funnel_id: string | null;
    }>();
  if (!current) return errorResponse(404, "NOT_FOUND", "Página não encontrada.");
  const graphStatements = await preparePageGraphChange(
    env,
    { id, name: current.name, pageType: current.page_type },
    current.funnel_id,
    null
  );
  await env.DB.batch([
    ...graphStatements,
    env.DB.prepare("DELETE FROM pages WHERE id = ?").bind(id),
    audit(env, user.id, "page.deleted", "page", id, {
      name: current.name,
      wasPublished: current.status === "published"
    })
  ]);
  return json({ ok: true });
}

async function restoreVersion(
  env: Env,
  user: SessionUser,
  pageId: string,
  versionId: string,
  origin: string
): Promise<Response> {
  const version = await env.DB.prepare(
    "SELECT content_json FROM page_versions WHERE id = ? AND page_id = ?"
  ).bind(versionId, pageId).first<{ content_json: string }>();
  if (!version) return errorResponse(404, "NOT_FOUND", "Versão não encontrada.");
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE page_drafts SET content_json = ?, revision = revision + 1,
       updated_by = ?, updated_at = datetime('now') WHERE page_id = ?`
    ).bind(version.content_json, user.id, pageId),
    audit(env, user.id, "page.version_restored", "page", pageId, { versionId })
  ]);
  const row = (await listPages(env, null)).find((item) => item.id === pageId)!;
  return json({ page: mapPage(row, origin) });
}

export async function handleCatalogApi(
  request: Request,
  env: Env,
  user: SessionUser,
  url: URL
): Promise<Response | null> {
  const mutating = ["POST", "PATCH", "PUT", "DELETE"].includes(request.method);
  if (mutating && !requireSameOrigin(request)) {
    return errorResponse(403, "ORIGIN_INVALID", "Origem inválida.");
  }
  try {
    if (url.pathname === "/api/offers") {
      if (request.method === "GET") return json({ offers: (await listOffers(env)).map(mapOffer) });
      if (request.method === "POST") return createOffer(request, env, user);
    }
    const offerMatch = url.pathname.match(/^\/api\/offers\/([^/]+)$/);
    if (offerMatch && request.method === "PATCH") return updateOffer(request, env, user, offerMatch[1]);
    if (offerMatch && request.method === "DELETE") return deleteOffer(env, user, offerMatch[1]);

    if (url.pathname === "/api/funnels") {
      if (request.method === "GET") {
        return json({
          funnels: (await listFunnels(env, url.searchParams.get("offerId"))).map(mapFunnel)
        });
      }
      if (request.method === "POST") return createFunnel(request, env, user);
    }
    const funnelMatch = url.pathname.match(/^\/api\/funnels\/([^/]+)$/);
    if (funnelMatch && request.method === "GET") {
      const row = (await listFunnels(env, null)).find((item) => item.id === funnelMatch[1]);
      return row ? json({ funnel: mapFunnel(row) }) : errorResponse(404, "NOT_FOUND", "Funil não encontrado.");
    }
    if (funnelMatch && request.method === "PATCH") {
      return updateFunnel(request, env, user, funnelMatch[1]);
    }
    if (funnelMatch && request.method === "DELETE") {
      return deleteFunnel(env, user, funnelMatch[1]);
    }
    const publishFunnelMatch = url.pathname.match(/^\/api\/funnels\/([^/]+)\/publish$/);
    if (publishFunnelMatch && request.method === "POST") {
      return publishFunnel(env, user, publishFunnelMatch[1]);
    }
    const duplicateMatch = url.pathname.match(/^\/api\/funnels\/([^/]+)\/duplicate$/);
    if (duplicateMatch && request.method === "POST") {
      return duplicateFunnel(env, user, duplicateMatch[1]);
    }

    if (url.pathname === "/api/pages") {
      if (request.method === "GET") {
        return json({
          pages: (await listPages(env, url.searchParams.get("offerId"))).map((row) =>
            mapPage(row, url.origin)
          )
        });
      }
      if (request.method === "POST") return createPage(request, env, user, url.origin);
    }
    const pageMatch = url.pathname.match(/^\/api\/pages\/([^/]+)$/);
    if (pageMatch && request.method === "GET") {
      const row = (await listPages(env, null)).find((item) => item.id === pageMatch[1]);
      return row
        ? json({ page: mapPage(row, url.origin) })
        : errorResponse(404, "NOT_FOUND", "Página não encontrada.");
    }
    if (pageMatch && request.method === "PATCH") {
      return updatePage(request, env, user, pageMatch[1], url.origin);
    }
    if (pageMatch && request.method === "DELETE") {
      return deletePage(env, user, pageMatch[1]);
    }
    const pagePublishMatch = url.pathname.match(/^\/api\/pages\/([^/]+)\/publish$/);
    if (pagePublishMatch && request.method === "POST") {
      return publishPage(env, user, pagePublishMatch[1], url.origin);
    }
    const versionsMatch = url.pathname.match(/^\/api\/pages\/([^/]+)\/versions$/);
    if (versionsMatch && request.method === "GET") {
      const result = await env.DB.prepare(
        `SELECT id, version_number, content_json, created_at FROM page_versions
         WHERE page_id = ? ORDER BY version_number DESC LIMIT 30`
      ).bind(versionsMatch[1]).all<VersionRow>();
      return json({
        versions: result.results.map((row) => ({
          id: row.id,
          versionNumber: row.version_number,
          createdAt: row.created_at,
          content: safeJson<PageDocument>(row.content_json, DEFAULT_DOCUMENT)
        }))
      });
    }
    const restoreMatch = url.pathname.match(/^\/api\/pages\/([^/]+)\/versions\/([^/]+)\/restore$/);
    if (restoreMatch && request.method === "POST") {
      return restoreVersion(env, user, restoreMatch[1], restoreMatch[2], url.origin);
    }
    if (url.pathname === "/api/templates" && request.method === "GET") {
      const result = await env.DB.prepare(
        "SELECT id, name, slug, category, content_json, is_system FROM templates ORDER BY category, name"
      ).all<TemplateRow>();
      return json({
        templates: result.results.map((row) => ({
          id: row.id,
          name: row.name,
          slug: row.slug,
          category: row.category,
          content: safeJson<PageDocument>(row.content_json, DEFAULT_DOCUMENT),
          isSystem: Boolean(row.is_system)
        }))
      });
    }
    return null;
  } catch (error) {
    if (error instanceof ValidationError) {
      return errorResponse(400, "VALIDATION_ERROR", error.message);
    }
    throw error;
  }
}
