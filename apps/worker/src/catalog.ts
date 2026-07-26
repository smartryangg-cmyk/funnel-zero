import type {
  FunnelGraph,
  PageDocument,
  SessionUser
} from "../../../packages/shared/src/schemas";
import { isPublicRouteReady } from "../../../packages/shared/src/schemas";
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
  const parsedNodes = nodes.map((item, index) => {
    const node = parseBodyRecord(item);
    const position = parseBodyRecord(node.position ?? {});
    return {
      id: optionalString(node.id, 100) ?? randomId(),
      type: optionalString(node.type, 40) ?? "page",
      label: optionalString(node.label, 120) ?? `Etapa ${index + 1}`,
      position: {
        x: Number.isFinite(Number(position.x)) ? Number(position.x) : index * 260,
        y: Number.isFinite(Number(position.y)) ? Number(position.y) : 100
      },
      config: node.config && typeof node.config === "object" ? node.config as Record<string, unknown> : {}
    };
  });
  const ids = new Set(parsedNodes.map((node) => node.id));
  const parsedEdges = edges
    .map((item) => {
      const edge = parseBodyRecord(item);
      return {
        id: optionalString(edge.id, 100) ?? randomId(),
        source: requiredString(edge.source, "Origem", 100),
        target: requiredString(edge.target, "Destino", 100),
        label: optionalString(edge.label, 80) ?? undefined
      };
    })
    .filter((edge) => ids.has(edge.source) && ids.has(edge.target) && edge.source !== edge.target);
  return { version: Number(body.version) || 1, nodes: parsedNodes, edges: parsedEdges };
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
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `UPDATE funnels SET name = ?, offer_id = ?, status = ?, graph_json = ?,
       graph_version = graph_version + 1, updated_at = datetime('now') WHERE id = ?`
    ).bind(name, offerId, status, JSON.stringify(graph), id),
    env.DB.prepare("DELETE FROM funnel_edges WHERE funnel_id = ?").bind(id),
    env.DB.prepare("DELETE FROM funnel_nodes WHERE funnel_id = ?").bind(id)
  ];
  for (const node of graph.nodes) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO funnel_nodes(id, funnel_id, node_type, label, position_x, position_y, config_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        node.id,
        id,
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
      ).bind(edge.id, id, edge.source, edge.target, edge.label ?? null)
    );
  }
  statements.push(audit(env, user.id, "funnel.updated", "funnel", id));
  await env.DB.batch(statements);
  return json({ funnel: mapFunnel((await listFunnels(env, null)).find((item) => item.id === id)!) });
}

async function publishFunnel(env: Env, user: SessionUser, id: string): Promise<Response> {
  const current = await env.DB.prepare("SELECT id, offer_id FROM funnels WHERE id = ?")
    .bind(id)
    .first<{ id: string; offer_id: string | null }>();
  if (!current) return errorResponse(404, "NOT_FOUND", "Funil não encontrado.");
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `UPDATE funnels SET status = 'published', published_at = datetime('now'),
       updated_at = datetime('now') WHERE id = ?`
    ).bind(id)
  ];
  if (current.offer_id) {
    statements.push(
      env.DB.prepare(
        "UPDATE offers SET status = 'active', updated_at = datetime('now') WHERE id = ?"
      ).bind(current.offer_id)
    );
  }
  statements.push(audit(env, user.id, "funnel.published", "funnel", id));
  await env.DB.batch(statements);
  return json({ ok: true });
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
      return { ...node, id: nodeId };
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
  const funnelId = optionalString(body.funnelId, 100);
  const offerId = optionalString(body.offerId, 100);
  const pageType = optionalString(body.pageType, 40) ?? "sales";
  let content = DEFAULT_DOCUMENT;
  if (body.templateId) {
    const template = await env.DB.prepare("SELECT content_json FROM templates WHERE id = ?")
      .bind(requiredString(body.templateId, "Template", 100))
      .first<{ content_json: string }>();
    if (template) content = safeJson<PageDocument>(template.content_json, DEFAULT_DOCUMENT);
  }
  if (body.content) content = validateDocument(body.content);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO pages(id, funnel_id, offer_id, name, slug, page_type, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, funnelId, offerId, name, slug, pageType, user.id),
    env.DB.prepare(
      `INSERT INTO page_drafts(page_id, content_json, updated_by) VALUES (?, ?, ?)`
    ).bind(id, JSON.stringify(content), user.id),
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
  if (!current) return errorResponse(404, "NOT_FOUND", "Página não encontrada.");
  const name = body.name === undefined ? current.name : requiredString(body.name, "Nome");
  const slug =
    body.slug === undefined ? current.slug : slugify(requiredString(body.slug, "Slug", 80));
  const status = validateStatus(
    body.status,
    ["draft", "published", "archived"],
    current.status
  );
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
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE pages SET name = ?, slug = ?, status = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(name, slug, status, id),
    env.DB.prepare(
      `UPDATE page_drafts SET content_json = ?, revision = revision + 1,
       updated_by = ?, updated_at = datetime('now') WHERE page_id = ?`
    ).bind(JSON.stringify(content), user.id, id),
    audit(env, user.id, "page.saved", "page", id)
  ]);
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
  const nextVersion =
    (await env.DB.prepare(
      "SELECT COALESCE(MAX(version_number), 0) + 1 AS value FROM page_versions WHERE page_id = ?"
    ).bind(id).first<number>("value")) ?? 1;
  const versionId = randomId();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO page_versions(id, page_id, version_number, content_json, created_by)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(versionId, id, nextVersion, current.content_json, user.id),
    env.DB.prepare(
      `UPDATE pages SET status = 'published', published_version_id = ?, published_at = datetime('now'),
       updated_at = datetime('now') WHERE id = ?`
    ).bind(versionId, id),
    env.DB.prepare(
      "UPDATE offers SET status = 'active', updated_at = datetime('now') WHERE id = ?"
    ).bind(current.offer_id)
  ];
  if (current.funnel_id) {
    statements.push(
      env.DB.prepare(
        `UPDATE funnels SET status = 'published', published_at = COALESCE(published_at, datetime('now')),
         updated_at = datetime('now') WHERE id = ?`
      ).bind(current.funnel_id)
    );
  }
  statements.push(audit(env, user.id, "page.published", "page", id, {
    version: nextVersion,
    activatedOffer: current.offer_status !== "active",
    publishedFunnel: Boolean(current.funnel_id && current.funnel_status !== "published")
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
    publishedFunnel: Boolean(current.funnel_id && current.funnel_status !== "published")
  });
}

async function deletePage(env: Env, user: SessionUser, id: string): Promise<Response> {
  const current = await env.DB.prepare("SELECT id, name, status FROM pages WHERE id = ?")
    .bind(id)
    .first<{ id: string; name: string; status: string }>();
  if (!current) return errorResponse(404, "NOT_FOUND", "Página não encontrada.");
  await env.DB.batch([
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
