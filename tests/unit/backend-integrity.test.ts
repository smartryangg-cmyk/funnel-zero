import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  validateMultipartParts
} from "../../apps/worker/src/assets";
import { isPurchaseWebhookStatus } from "../../apps/worker/src/operations";
import {
  signPublicTrackingContext,
  verifyPublicTrackingContext
} from "../../apps/worker/src/tracking";

const root = resolve(import.meta.dirname, "../..");

describe("webhooks de checkout", () => {
  it.each(["paid", "approved", "completed", "purchase", " PAID "])(
    "aceita somente o estado positivo exato %s",
    (status) => {
      expect(isPurchaseWebhookStatus(status)).toBe(true);
    }
  );

  it.each([
    "unpaid",
    "not_approved",
    "pending",
    "declined",
    "refunded",
    "chargeback",
    "purchase.completed",
    "payment_paid",
    "",
    null
  ])("não converte o estado negativo ou composto %s", (status) => {
    expect(isPurchaseWebhookStatus(status)).toBe(false);
  });

  it("usa dedupe tanto no evento recebido quanto na compra", () => {
    const source = readFileSync(resolve(root, "apps/worker/src/operations.ts"), "utf8");
    expect(source).toContain("INSERT OR IGNORE INTO webhook_events");
    expect(source).toContain("INSERT OR IGNORE INTO tracking_events");
    expect(source).toContain("purchaseRecorded");
    expect(source).not.toContain("/(paid|approved|purchase|completed)/");
  });
});

describe("integridade do upload multipart", () => {
  const mib = 1024 * 1024;

  it("aceita um arquivo de uma parte quando tamanho declarado e recebido coincidem", () => {
    expect(validateMultipartParts(2 * mib, [
      { partNumber: 1, byteSize: 2 * mib }
    ], 20 * mib)).toEqual({ ok: true, totalBytes: 2 * mib });
  });

  it("aceita partes sequenciais e reserva o tamanho total exato", () => {
    expect(validateMultipartParts(10 * mib, [
      { partNumber: 1, byteSize: 8 * mib },
      { partNumber: 2, byteSize: 2 * mib }
    ], 20 * mib)).toEqual({ ok: true, totalBytes: 10 * mib });
  });

  it("recusa declaração menor que a soma real", () => {
    expect(validateMultipartParts(1, [
      { partNumber: 1, byteSize: 2 * mib }
    ], 20 * mib)).toMatchObject({ ok: false, code: "TOTAL_SIZE" });
  });

  it("recusa sequência com lacunas e parte intermediária pequena", () => {
    expect(validateMultipartParts(16 * mib, [
      { partNumber: 1, byteSize: 8 * mib },
      { partNumber: 3, byteSize: 8 * mib }
    ], 20 * mib)).toMatchObject({ ok: false, code: "SEQUENCE" });
    expect(validateMultipartParts(5 * mib, [
      { partNumber: 1, byteSize: 1 * mib },
      { partNumber: 2, byteSize: 4 * mib }
    ], 20 * mib)).toMatchObject({ ok: false, code: "PART_SIZE" });
  });

  it("recusa soma acima do limite máximo", () => {
    expect(validateMultipartParts(24 * mib, [
      { partNumber: 1, byteSize: 12 * mib },
      { partNumber: 2, byteSize: 12 * mib }
    ], 20 * mib)).toMatchObject({ ok: false, code: "TOTAL_SIZE" });
  });

  it("inclui uploads em andamento na reserva atômica e revalida o objeto R2", () => {
    const source = readFileSync(resolve(root, "apps/worker/src/assets.ts"), "utf8");
    expect(source).toContain("upload_status IN ('ready', 'uploading')");
    expect(source).toContain("SELECT COALESCE(SUM(byte_size), 0)");
    expect(source).toContain("actualSize !== validation.totalBytes");
    expect(source).toContain("invalidateMultipartUpload");
  });
});

describe("contexto público de rastreamento", () => {
  const secret = "segredo-de-teste-com-entropia-suficiente";
  const now = Date.UTC(2026, 6, 26, 12, 0, 0);
  const input = {
    host: "oferta.exemplo.com",
    path: "/vsl",
    anonymousId: "anon_12345678",
    offerId: "offer_123",
    funnelId: "funnel_123",
    pageId: "page_123",
    variantId: null
  };

  it("assina, valida e devolve somente IDs emitidos pelo servidor", async () => {
    const token = await signPublicTrackingContext(secret, input, now);
    await expect(
      verifyPublicTrackingContext(secret, token, input.host, now + 1_000)
    ).resolves.toMatchObject(input);
  });

  it("recusa assinatura adulterada, host diferente e contexto expirado", async () => {
    const token = await signPublicTrackingContext(secret, input, now);
    const [payload, signature] = token.split(".");
    const tampered = `${payload?.slice(0, -1)}A.${signature}`;
    await expect(
      verifyPublicTrackingContext(secret, tampered, input.host, now)
    ).rejects.toThrow();
    await expect(
      verifyPublicTrackingContext(secret, token, "clone.exemplo.com", now)
    ).rejects.toThrow();
    await expect(
      verifyPublicTrackingContext(secret, token, input.host, now + 6 * 60 * 60 * 1_000)
    ).rejects.toThrow();
  });

  it("injeta o token no HTML e não envia IDs de entidade controlados pelo navegador", () => {
    const page = readFileSync(resolve(root, "apps/worker/src/public-page.ts"), "utf8");
    const tracking = readFileSync(resolve(root, "apps/worker/src/tracking.ts"), "utf8");
    expect(page).toContain("signPublicTrackingContext");
    expect(page).toContain("contextToken: meta.trackingToken");
    expect(page).not.toContain("offerId: meta.offerId");
    expect(page).not.toContain("funnelId: meta.funnelId");
    expect(page).not.toContain("pageId: meta.pageId");
    expect(tracking).toContain("offerId: context.offerId");
    expect(tracking).toContain("pageId: context.pageId");
  });

  it("mantém dedupe e unicidade no banco para qualquer origem de evento", () => {
    const migration = readFileSync(
      resolve(root, "migrations/0009_integrity_hardening.sql"),
      "utf8"
    );
    const tracking = readFileSync(resolve(root, "apps/worker/src/tracking.ts"), "utf8");
    expect(migration).toContain("CREATE TABLE tracking_unique_visitors");
    expect(migration).toContain("CREATE TRIGGER tracking_events_after_insert_aggregate");
    expect(migration).toContain("COUNT(DISTINCT NULLIF(anonymous_id, ''))");
    expect(migration).toContain("CREATE TABLE public_rate_limits");
    expect(tracking).not.toContain("unique_count = unique_count + excluded.unique_count");
  });
});
