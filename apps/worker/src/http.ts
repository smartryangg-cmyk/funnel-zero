const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Cross-Origin-Opener-Policy": "same-origin"
};

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) headers.set(key, value);
  return Response.json(data, { ...init, headers });
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  details?: unknown
): Response {
  return json({ error: { code, message, details } }, { status });
}

export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) headers.set(key, value);
  if ((headers.get("Content-Type") ?? "").includes("text/html")) {
    headers.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
    );
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function readJson(request: Request, maxBytes = 16_384): Promise<unknown> {
  const rawLength = request.headers.get("Content-Length");
  if (rawLength && Number(rawLength) > maxBytes) throw new RequestBodyError("Payload muito grande.");
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > maxBytes) {
    throw new RequestBodyError("Payload muito grande.");
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new RequestBodyError("JSON inválido.");
  }
}

export class RequestBodyError extends Error {}

export function requireSameOrigin(request: Request): boolean {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("Origin");
  return origin === requestUrl.origin;
}
