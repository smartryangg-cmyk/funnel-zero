import { randomId } from "./crypto";

export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function requiredString(value: unknown, label: string, max = 160): string {
  if (typeof value !== "string") throw new ValidationError(`${label} é obrigatório.`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) throw new ValidationError(`${label} é inválido.`);
  return trimmed;
}

export function optionalString(value: unknown, max = 2048): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > max) throw new ValidationError("Texto inválido.");
  return value.trim();
}

export function safeJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function parseBodyRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("Dados inválidos.");
  }
  return value as Record<string, unknown>;
}

export function parseHttpUrl(value: unknown, allowEmpty = true): string | null {
  const raw = optionalString(value);
  if (!raw && allowEmpty) return null;
  try {
    const url = new URL(raw ?? "");
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("protocol");
    return url.toString();
  } catch {
    throw new ValidationError("Informe uma URL HTTP ou HTTPS válida.");
  }
}

export function makeUniqueSlug(name: string, requested?: unknown): string {
  const base = slugify(typeof requested === "string" ? requested : name) || "item";
  return `${base}-${randomId().slice(0, 6)}`;
}

export function escapeHtml(value: unknown): string {
  const text =
    typeof value === "string" || typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : "";
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function safeColor(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

export function sanitizeFileName(value: string): string {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return cleaned || "arquivo";
}

export function mediaTypeForMime(mime: string): "image" | "video" | "document" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return "document";
}

export function audit(
  env: Env,
  userId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, unknown> = {}
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO audit_logs(id, user_id, action, entity_type, entity_id, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(randomId(), userId, action, entityType, entityId, JSON.stringify(metadata));
}

export class ValidationError extends Error {}
