import type { BootstrapResponse, DashboardMetrics, SessionUser } from "../../../packages/shared/src/schemas";

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
    request<{ metrics: DashboardMetrics }>(`/api/dashboard?days=${days}`)
};
