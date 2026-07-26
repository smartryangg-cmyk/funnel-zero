import type {
  AssetSummary,
  BootstrapResponse,
  DashboardMetrics,
  DomainProviderStatus,
  DomainSummary,
  FunnelSummary,
  IntegrationSettings,
  OfferSummary,
  PageSummary,
  PageVersionSummary,
  SessionUser,
  TemplateSummary
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
  dashboard: (days: number) =>
    request<{ metrics: DashboardMetrics }>(`/api/dashboard?days=${days}`),
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
    request<{ ok: true }>(`/api/funnels/${id}/publish`, { method: "POST", body: "{}" }),
  duplicateFunnel: (id: string) =>
    request<{ funnel: FunnelSummary }>(`/api/funnels/${id}/duplicate`, {
      method: "POST",
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
    request<{ page: PageSummary; versionNumber: number }>(`/api/pages/${id}/publish`, {
      method: "POST",
      body: "{}"
    }),
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
  deleteAsset: (id: string) =>
    request<{ ok: true }>(`/api/assets/${id}`, { method: "DELETE", body: "{}" }),
  integrations: () => request<IntegrationSettings>("/api/integrations"),
  savePixels: (offerId: string, input: { metaPixelId: string; ga4Id: string }) =>
    request<{ ok: true }>(`/api/integrations/pixels/${offerId}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
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
  saveDomainProvider: (input: { accountId: string; workerName: string }) =>
    request<{ provider: DomainProviderStatus }>("/api/domains/provider", {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  syncDomains: () =>
    request<{ ok: true; remoteCount: number }>("/api/domains/sync", {
      method: "POST",
      body: "{}"
    }),
  domainZones: () =>
    request<{ zones: Array<{ id: string; name: string; status: string }> }>("/api/domains/zones"),
  attachDomain: (input: {
    hostname: string;
    confirmation: string;
    zoneId: string;
    zoneName: string;
    funnelId?: string | null;
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
    })
};
