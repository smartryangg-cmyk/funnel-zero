import type {
  AssetSummary,
  BootstrapResponse,
  DashboardMetrics,
  DomainProviderStatus,
  DomainSummary,
  FunnelSummary,
  IntegrationSettings,
  MetaAccountInsight,
  MetaAdAccount,
  MetaAdsStatus,
  MetaCampaign,
  OfferSummary,
  PageSummary,
  PageVersionSummary,
  PlayerConfig,
  SessionUser,
  TemplateSummary,
  VideoMetrics
} from "../../../packages/shared/src/schemas";

interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers
    }
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
    throw new ApiError(
      body.error?.message ?? "Não foi possível concluir a solicitação.",
      response.status,
      body.error?.code,
      body.error?.details
    );
  }
  return (await response.json()) as T;
}

async function uploadRequest<T>(path: string, body: Blob): Promise<T> {
  const response = await fetch(path, {
    method: "PUT",
    body,
    credentials: "same-origin",
    headers: { "Content-Type": "application/octet-stream" }
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as ApiErrorBody;
    throw new ApiError(payload.error?.message ?? "Falha no upload.", response.status, payload.error?.code);
  }
  return response.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

export const api = {
  bootstrap: () => request<BootstrapResponse>("/api/bootstrap"),
  setup: (input: { token: string; name: string; email: string; password: string }) =>
    request<{ ok: true; redirect: string }>("/api/setup/complete", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  login: (input: { email: string; password: string }) =>
    request<{ user: SessionUser }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST", body: "{}" }),
  changePassword: (input: { currentPassword: string; newPassword: string }) =>
    request<{ ok: true; requiresLogin: true }>("/api/account/password", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  completeRecovery: (input: { token: string; password: string }) =>
    request<{ ok: true; requiresLogin: true }>("/api/auth/recovery/complete", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  changeEmail: (input: { currentPassword: string; email: string }) =>
    request<{ ok: true; requiresLogin: true; email: string }>("/api/account/email", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  dashboard: (days: number, offerId?: string) => {
    const params = new URLSearchParams({ days: String(days) });
    if (offerId) params.set("offerId", offerId);
    return request<{ metrics: DashboardMetrics }>(`/api/dashboard?${params.toString()}`);
  },
  offers: () => request<{ offers: OfferSummary[] }>("/api/offers"),
  createOffer: (input: { name: string; slug?: string; checkoutUrl?: string }) =>
    request<{ offer: OfferSummary }>("/api/offers", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  updateOffer: (id: string, input: Partial<OfferSummary>) =>
    request<{ offer: OfferSummary }>(`/api/offers/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  deleteOffer: (id: string) =>
    request<{ ok: true; detachedFunnels: number; detachedPages: number }>(
      `/api/offers/${id}`,
      { method: "DELETE", body: "{}" }
    ),
  funnels: (offerId?: string) =>
    request<{ funnels: FunnelSummary[] }>(
      `/api/funnels${offerId ? `?offerId=${encodeURIComponent(offerId)}` : ""}`
    ),
  funnel: (id: string) => request<{ funnel: FunnelSummary }>(`/api/funnels/${id}`),
  createFunnel: (input: { name: string; offerId?: string | null }) =>
    request<{ funnel: FunnelSummary }>("/api/funnels", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  updateFunnel: (id: string, input: Partial<FunnelSummary>) =>
    request<{ funnel: FunnelSummary }>(`/api/funnels/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  publishFunnel: (id: string) =>
    request<{ ok: true; linkedPages: number }>(`/api/funnels/${id}/publish`, {
      method: "POST",
      body: "{}"
    }),
  duplicateFunnel: (id: string) =>
    request<{ funnel: FunnelSummary }>(`/api/funnels/${id}/duplicate`, {
      method: "POST",
      body: "{}"
    }),
  deleteFunnel: (id: string) =>
    request<{ ok: true; preservedPages: number }>(`/api/funnels/${id}`, {
      method: "DELETE",
      body: "{}"
    }),
  pages: (offerId?: string) =>
    request<{ pages: PageSummary[] }>(
      `/api/pages${offerId ? `?offerId=${encodeURIComponent(offerId)}` : ""}`
    ),
  page: (id: string) => request<{ page: PageSummary }>(`/api/pages/${id}`),
  createPage: (input: {
    name: string;
    offerId?: string | null;
    funnelId?: string | null;
    pageType?: string;
    templateId?: string;
  }) =>
    request<{ page: PageSummary }>("/api/pages", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  updatePage: (id: string, input: Partial<PageSummary>) =>
    request<{ page: PageSummary }>(`/api/pages/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  publishPage: (id: string) =>
    request<{
      page: PageSummary;
      versionNumber: number;
      live: true;
      publicUrl: string;
      activatedOffer: boolean;
      publishedFunnel: boolean;
    }>(`/api/pages/${id}/publish`, { method: "POST", body: "{}" }),
  deletePage: (id: string) =>
    request<{ ok: true }>(`/api/pages/${id}`, { method: "DELETE", body: "{}" }),
  pageVersions: (id: string) =>
    request<{ versions: PageVersionSummary[] }>(`/api/pages/${id}/versions`),
  restorePageVersion: (pageId: string, versionId: string) =>
    request<{ page: PageSummary }>(`/api/pages/${pageId}/versions/${versionId}/restore`, {
      method: "POST",
      body: "{}"
    }),
  templates: () => request<{ templates: TemplateSummary[] }>("/api/templates"),
  assets: () => request<{ assets: AssetSummary[] }>("/api/assets"),
  initiateUpload: (input: {
    fileName: string;
    mimeType: string;
    byteSize: number;
    offerId?: string | null;
    sha256?: string;
  }) =>
    request<{ assetId: string; uploadId: string; partSize: number; maxFileBytes: number }>(
      "/api/assets/multipart",
      { method: "POST", body: JSON.stringify(input) }
    ),
  uploadPart: (assetId: string, partNumber: number, chunk: Blob) =>
    uploadRequest<{ partNumber: number; etag: string }>(
      `/api/assets/${assetId}/parts/${partNumber}`,
      chunk
    ),
  completeUpload: (assetId: string) =>
    request<{ asset: AssetSummary }>(`/api/assets/${assetId}/complete`, {
      method: "POST",
      body: "{}"
    }),
  renameAsset: (id: string, name: string) =>
    request<{ asset: AssetSummary }>(`/api/assets/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name })
    }),
  updateAsset: (id: string, input: { name?: string; playerConfig?: PlayerConfig }) =>
    request<{ asset: AssetSummary }>(`/api/assets/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  videoMetrics: (id: string, days = 7) =>
    request<{ metrics: VideoMetrics }>(
      `/api/assets/${id}/metrics?days=${encodeURIComponent(days)}`
    ),
  deleteAsset: (id: string) =>
    request<{ ok: true }>(`/api/assets/${id}`, { method: "DELETE", body: "{}" }),
  integrations: () => request<IntegrationSettings>("/api/integrations"),
  savePixels: (
    offerId: string,
    input: {
      metaPixelId: string;
      metaCode?: string;
      ga4Id: string;
      ga4Code?: string;
      capiEnabled?: boolean;
      capiToken?: string;
      clearCapiToken?: boolean;
      testEventCode?: string;
    }
  ) =>
    request<{
      ok: true;
      diagnostics: {
        metaConfigured: boolean;
        ga4Configured: boolean;
        capiEnabled: boolean;
        tokenAvailable: boolean;
        detectedFromCode: boolean;
        detectedGa4FromCode: boolean;
      };
    }>(`/api/integrations/pixels/${offerId}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  testMeta: (offerId: string) =>
    request<{ ok: true; received: number; message: string }>(
      `/api/integrations/pixels/${offerId}/test`,
      { method: "POST", body: "{}" }
    ),
  createCheckout: (input: { offerId: string; name: string; checkoutUrl: string }) =>
    request<{ id: string }>("/api/integrations/checkouts", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  createWebhook: (checkoutIntegrationId: string) =>
    request<{
      webhook: { id: string; url: string; secret: string; secretShownOnce: boolean; header: string };
    }>("/api/integrations/webhooks", {
      method: "POST",
      body: JSON.stringify({ checkoutIntegrationId })
    }),
  createExperiment: (input: {
    funnelId: string;
    name: string;
    variants: Array<{ name: string; pageVersionId: string | null }>;
  }) =>
    request<{ id: string }>("/api/experiments", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  updateExperiment: (id: string, input: { status?: string; winningVariantId?: string }) =>
    request<{ ok: true }>(`/api/experiments/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  domains: () =>
    request<{ provider: DomainProviderStatus; domains: DomainSummary[] }>("/api/domains"),
  startCloudflareOAuth: () =>
    request<{ authorizeUrl: string }>("/api/cloudflare/oauth/start", {
      method: "POST",
      body: "{}"
    }),
  connectCloudflareToken: (apiToken: string) =>
    request<{
      ok: true;
      provider: { connected: true; accountName: string; workerName: string };
    }>("/api/cloudflare/token/connect", {
      method: "POST",
      body: JSON.stringify({ apiToken })
    }),
  disconnectCloudflare: () =>
    request<{ ok: true; warning: string | null }>("/api/cloudflare/disconnect", {
      method: "POST",
      body: "{}"
    }),
  syncDomains: () =>
    request<{ ok: true; remoteCount: number; activeCount: number; validatingCount: number }>("/api/domains/sync", {
      method: "POST",
      body: "{}"
    }),
  domainZones: () =>
    request<{
      zones: Array<{ id: string; name: string; status: string; nameServers: string[] }>;
    }>("/api/domains/zones"),
  importDomain: (domain: string) =>
    request<{
      zone: {
        id: string;
        name: string;
        status: string;
        nameServers: string[];
      };
      registrarStepRequired: boolean;
    }>("/api/domains/import", {
      method: "POST",
      body: JSON.stringify({ domain })
    }),
  attachDomain: (input: {
    hostname: string;
    funnelId: string;
    isPrimary?: boolean;
  }) =>
    request<{ id: string; hostname: string; status: string }>("/api/domains", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  detachDomain: (id: string, confirmation: string) =>
    request<{ ok: true }>(`/api/domains/${id}`, {
      method: "DELETE",
      body: JSON.stringify({ confirmation })
    }),
  metaAdsStatus: () => request<MetaAdsStatus>("/api/meta-ads/status"),
  startMetaAdsOAuth: () =>
    request<{ authorizeUrl: string }>("/api/meta-ads/oauth/start", {
      method: "POST",
      body: "{}"
    }),
  disconnectMetaAds: () =>
    request<{ ok: true }>("/api/meta-ads/disconnect", {
      method: "POST",
      body: "{}"
    }),
  metaAdAccounts: () =>
    request<{ accounts: MetaAdAccount[] }>("/api/meta-ads/accounts"),
  metaCampaigns: (accountId: string) =>
    request<{ campaigns: MetaCampaign[] }>(
      `/api/meta-ads/campaigns?accountId=${encodeURIComponent(accountId)}`
    ),
  updateMetaCampaignStatus: (
    accountId: string,
    campaignId: string,
    status: "ACTIVE" | "PAUSED"
  ) =>
    request<{ ok: true; campaignId: string; status: "ACTIVE" | "PAUSED" }>(
      `/api/meta-ads/campaigns/${encodeURIComponent(campaignId)}/status?accountId=${encodeURIComponent(accountId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ status, confirmation: campaignId })
      }
    ),
  metaInsights: (accountId: string, days = 7) =>
    request<{ insight: MetaAccountInsight | null; periodDays: number }>(
      `/api/meta-ads/insights?accountId=${encodeURIComponent(accountId)}&days=${encodeURIComponent(days)}`
    )
};
