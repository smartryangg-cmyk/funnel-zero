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

export interface FunnelGraphNode {
  id: string;
  type: string;
  label: string;
  position: { x: number; y: number };
  config?: Record<string, unknown>;
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
  showVolume: boolean;
  timelineStyle: "real" | "minimal" | "hidden";
  allowSeek: boolean;
  resumePlayback: boolean;
  showSpeed: boolean;
  showQuality: boolean;
  autoplayMuted: boolean;
  clickToPause: boolean;
  protectVideo: boolean;
  watermark: string;
  ctaAtSeconds: number;
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
  averageRetention: number;
  completionRate: number;
  retention: RetentionPoint[];
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
