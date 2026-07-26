import { z } from "zod";

export const setupSchema = z.object({
  token: z.string().min(32).max(256),
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z
    .string()
    .min(12)
    .max(128)
    .regex(/[a-z]/, "Inclua uma letra minúscula.")
    .regex(/[A-Z]/, "Inclua uma letra maiúscula.")
    .regex(/[0-9]/, "Inclua um número.")
    .regex(/[^A-Za-z0-9]/, "Inclua um símbolo.")
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(128)
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z
    .string()
    .min(12)
    .max(128)
    .regex(/[a-z]/, "Inclua uma letra minúscula.")
    .regex(/[A-Z]/, "Inclua uma letra maiúscula.")
    .regex(/[0-9]/, "Inclua um número.")
    .regex(/[^A-Za-z0-9]/, "Inclua um símbolo.")
});

export type SetupInput = z.infer<typeof setupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: "owner" | "admin" | "editor" | "analyst";
}

export interface DashboardMetrics {
  scopeOfferId: string | null;
  activeOffers: number;
  publishedFunnels: number;
  pageViews: number;
  approximateVisitors: number;
  vslStarts: number;
  averageRetention: number;
  pitchReached: number;
  checkoutClicks: number;
  clickThroughRate: number;
  conversions: number;
  leads: number;
  quizStarts: number;
  quizCompletions: number;
  conversionRate: number;
  revenue: number;
  winningVariants: number;
  storageBytes: number;
  storageLimitBytes: number;
  storageScanComplete: boolean;
  activeDomains: number;
  pendingDomains: number;
  periodDays: number;
  freeOnly: boolean;
  funnelStages: FunnelMetricStage[];
  retentionCurve: RetentionPoint[];
  dailySeries: DailyMetricPoint[];
  topQuizAnswers: QuizAnswerMetric[];
  utmRows: UtmMetricRow[];
  recentEvents: TrackingEventSummary[];
}

export interface FunnelMetricStage {
  key: string;
  label: string;
  value: number;
  rateFromPrevious: number;
  dropOff: number;
  dropRate: number;
}

export interface RetentionPoint {
  percent: number;
  viewers: number;
  rate: number;
}

export interface DailyMetricPoint {
  date: string;
  pageViews: number;
  checkoutClicks: number;
  conversions: number;
}

export interface QuizAnswerMetric {
  question: string;
  answer: string;
  count: number;
}

export interface UtmMetricRow {
  source: string;
  campaign: string;
  pageViews: number;
  checkoutClicks: number;
  conversions: number;
  revenue: number;
  conversionRate: number;
}

export interface TrackingEventSummary {
  id: string;
  eventType: string;
  occurredAt: string;
  source: string;
  campaign: string;
  pageId: string | null;
}

export interface BootstrapResponse {
  installed: boolean;
  user: SessionUser | null;
  environment: string;
  freeOnly: boolean;
}

export type EntityStatus = "draft" | "active" | "published" | "archived";

export interface OfferSummary {
  id: string;
  name: string;
  slug: string;
  status: "draft" | "active" | "archived";
  checkoutUrl: string | null;
  pixelConfig: Record<string, unknown>;
  funnelCount: number;
  pageCount: number;
  updatedAt: string;
}

export interface FunnelSummary {
  id: string;
  offerId: string | null;
  offerName: string | null;
  name: string;
  slug: string;
  status: "draft" | "published" | "archived";
  graphVersion: number;
  graph: FunnelGraph;
  publishedAt: string | null;
  updatedAt: string;
}

export type FunnelNodeType = "page" | "vsl" | "lead" | "checkout";

export interface FunnelNodeConfig {
  pageId?: string;
  assetId?: string;
  url?: string;
  ctaLabel?: string;
  [key: string]: unknown;
}

export interface FunnelGraphNode {
  id: string;
  type: FunnelNodeType;
  label: string;
  position: { x: number; y: number };
  config?: FunnelNodeConfig;
}

export interface FunnelGraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface FunnelGraph {
  version: number;
  nodes: FunnelGraphNode[];
  edges: FunnelGraphEdge[];
}

export interface FunnelGraphInspection {
  pageIds: string[];
  duplicateNodeIds: string[];
  duplicatePageIds: string[];
  invalidEdgeIds: string[];
  disconnectedNodeIds: string[];
  unlinkedContentNodeIds: string[];
}

/**
 * Pure graph inspection shared by the editor, API validation and tests.
 * Incomplete graphs are valid drafts, but every issue reported here blocks publication.
 */
export function inspectFunnelGraph(graph: FunnelGraph): FunnelGraphInspection {
  const nodeIds = new Set<string>();
  const duplicateNodeIds = new Set<string>();
  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) duplicateNodeIds.add(node.id);
    nodeIds.add(node.id);
  }

  const pageIds: string[] = [];
  const seenPageIds = new Set<string>();
  const duplicatePageIds = new Set<string>();
  const unlinkedContentNodeIds: string[] = [];
  for (const node of graph.nodes) {
    const pageId = typeof node.config?.pageId === "string" ? node.config.pageId.trim() : "";
    if (pageId) {
      pageIds.push(pageId);
      if (seenPageIds.has(pageId)) duplicatePageIds.add(pageId);
      seenPageIds.add(pageId);
    } else if (node.type !== "checkout") {
      unlinkedContentNodeIds.push(node.id);
    }
  }

  const invalidEdgeIds = graph.edges
    .filter((edge) =>
      !nodeIds.has(edge.source)
      || !nodeIds.has(edge.target)
      || edge.source === edge.target
    )
    .map((edge) => edge.id);

  const adjacent = new Map<string, Set<string>>();
  for (const node of graph.nodes) adjacent.set(node.id, new Set());
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target) || edge.source === edge.target) continue;
    adjacent.get(edge.source)?.add(edge.target);
    adjacent.get(edge.target)?.add(edge.source);
  }
  const visited = new Set<string>();
  const firstId = graph.nodes[0]?.id;
  if (firstId) {
    const queue = [firstId];
    while (queue.length) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const next of adjacent.get(current) ?? []) {
        if (!visited.has(next)) queue.push(next);
      }
    }
  }

  return {
    pageIds,
    duplicateNodeIds: [...duplicateNodeIds],
    duplicatePageIds: [...duplicatePageIds],
    invalidEdgeIds,
    disconnectedNodeIds: graph.nodes.filter((node) => !visited.has(node.id)).map((node) => node.id),
    unlinkedContentNodeIds
  };
}

export type PageBlockType =
  | "heading"
  | "paragraph"
  | "image"
  | "video"
  | "button"
  | "spacer"
  | "divider"
  | "leadForm"
  | "quiz"
  | "html";

export interface PageBlock {
  id: string;
  type: PageBlockType;
  content: unknown;
  settings?: Record<string, unknown>;
}

export interface PageDocument {
  version: number;
  theme: {
    background: string;
    text: string;
    accent: string;
    font?: string;
    maxWidth?: number;
    contentAlign?: "left" | "center" | "right";
    buttonRadius?: number;
  };
  blocks: PageBlock[];
  settings?: {
    title?: string;
    description?: string;
    pitchAtSeconds?: number;
    customHeadHtml?: string;
  };
}

export interface PageSummary {
  id: string;
  funnelId: string | null;
  offerId: string | null;
  offerName: string | null;
  name: string;
  slug: string;
  pageType: string;
  status: "draft" | "published" | "archived";
  revision: number;
  content: PageDocument;
  publishedAt: string | null;
  updatedAt: string;
  publicUrl: string | null;
  isLive: boolean;
  publicationIssue: string | null;
}

export function isPublicRouteReady(input: {
  pageStatus: string;
  publishedVersionId: string | null;
  offerId: string | null;
  offerStatus: string | null;
  funnelId: string | null;
  funnelStatus: string | null;
}): boolean {
  return input.pageStatus === "published"
    && Boolean(input.publishedVersionId)
    && Boolean(input.offerId)
    && input.offerStatus === "active"
    && (!input.funnelId || input.funnelStatus === "published");
}

export interface TemplateSummary {
  id: string;
  name: string;
  slug: string;
  category: string;
  content: PageDocument;
  isSystem: boolean;
}

export interface PageVersionSummary {
  id: string;
  versionNumber: number;
  createdAt: string;
  content: PageDocument;
}

export interface AssetSummary {
  id: string;
  offerId: string | null;
  originalName: string;
  mediaType: "image" | "video" | "document";
  mimeType: string;
  extension: string;
  byteSize: number;
  uploadStatus: "pending" | "uploading" | "ready" | "failed" | "deleting";
  createdAt: string;
  url: string | null;
  playerConfig: PlayerConfig;
}

export interface PlayerConfig {
  showControls: boolean;
  showBigPlay: boolean;
  showVolume: boolean;
  showTime: boolean;
  showFullscreen: boolean;
  timelineStyle: "real" | "minimal" | "hidden";
  allowSeek: boolean;
  rewindSeconds: 0 | 5 | 10;
  forwardSeconds: 0 | 5 | 10;
  resumePlayback: boolean;
  resumeMessage: string;
  resumeContinueLabel: string;
  resumeRestartLabel: string;
  showSpeed: boolean;
  showQuality: boolean;
  autoplayMuted: boolean;
  autoplayMessage: string;
  clickToPause: boolean;
  protectVideo: boolean;
  watermark: string;
  primaryColor: string;
  backgroundColor: string;
  borderRadius: number;
  smartProgress: boolean;
  smartProgressHeight: number;
  playbackRate: number;
  loop: boolean;
  headlineText: string;
  headlineStartSeconds: number;
  headlineEndSeconds: number;
  miniHookText: string;
  miniHookStartSeconds: number;
  miniHookEndSeconds: number;
  ctaAtSeconds: number;
  ctaEndSeconds: number;
  ctaText: string;
  ctaUrl: string;
  ctaNewTab: boolean;
  ctaPulse: boolean;
  allowedDomains: string[];
  posterAssetId: string;
  posterTestAssetId: string;
  qualitySources: Array<{
    label: "360p" | "720p" | "1080p";
    assetId: string;
  }>;
}

export interface VideoMetrics {
  assetId: string;
  starts: number;
  uniqueViewers: number;
  pauses: number;
  completions: number;
  checkoutClicks: number;
  pitchReached: number;
  engagementRate: number;
  averageRetention: number;
  completionRate: number;
  retention: RetentionPoint[];
  devices: Array<{ label: string; value: number }>;
  browsers: Array<{ label: string; value: number }>;
  sources: Array<{ label: string; value: number }>;
  periodDays: number;
}

export interface ExperimentSummary {
  id: string;
  funnelId: string;
  name: string;
  status: "draft" | "running" | "paused" | "completed";
  winningVariantId: string | null;
  variants: Array<{
    id: string;
    name: string;
    weight: number;
    pageVersionId: string | null;
    status: "active" | "paused";
    views: number;
    conversions: number;
  }>;
}

export interface IntegrationSettings {
  offers: Array<Pick<OfferSummary, "id" | "name" | "slug" | "checkoutUrl" | "pixelConfig">>;
  checkouts: Array<{
    id: string;
    offerId: string;
    name: string;
    checkoutUrl: string;
    parameterMap: Record<string, string>;
    active: boolean;
  }>;
  webhooks: Array<{
    id: string;
    checkoutIntegrationId: string;
    active: boolean;
    lastEventAt: string | null;
    url: string;
  }>;
  experiments: ExperimentSummary[];
  customScripts: { enabled: boolean; acknowledgedRisk: boolean };
}

export interface DomainSummary {
  id: string;
  funnelId: string | null;
  funnelName: string | null;
  hostname: string;
  zoneName?: string;
  certIssued?: boolean;
  status: "pending" | "validating" | "active" | "failed";
  isPrimary: boolean;
  lastCheckedAt: string | null;
}

export interface DomainProviderStatus {
  configured: boolean;
  connected: boolean;
  ready: boolean;
  authMode: "none" | "oauth" | "legacy_token";
  accountName: string;
  workerName: string;
  scopes: string[];
  zoneImportReady: boolean;
  expiresAt: string | null;
  connectedAt: string | null;
  lastCheckedAt: string | null;
  oauthAvailable: boolean;
  guidedTokenAvailable: boolean;
  tokenTemplateUrl: string | null;
  tokenAvailable: boolean;
}
