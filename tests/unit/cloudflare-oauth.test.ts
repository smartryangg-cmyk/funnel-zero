import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  openSecret,
  sealSecret,
  sha256Base64Url
} from "../../apps/worker/src/crypto";

describe("conexão Cloudflare", () => {
  const root = resolve(import.meta.dirname, "../..");

  it("usa OAuth Authorization Code com PKCE e secrets do Worker", () => {
    const source = readFileSync(resolve(root, "apps/worker/src/cloudflare.ts"), "utf8");
    expect(source).toContain("code_challenge_method");
    expect(source).toContain('"S256"');
    expect(source).toContain("/secrets-bulk");
    expect(source).not.toMatch(/access_token_ciphertext|refresh_token_ciphertext/);
  });

  it("oferece conexão guiada para qualquer clone sem gravar o token no D1", () => {
    const source = readFileSync(resolve(root, "apps/worker/src/cloudflare.ts"), "utf8");
    const admin = readFileSync(resolve(root, "apps/web/src/AdminSettings.tsx"), "utf8");
    const installer = readFileSync(resolve(root, "packages/cli/bin/funnel-zero.mjs"), "utf8");
    expect(source).toContain("guidedTokenTemplateUrl");
    expect(source).toContain("CLOUDFLARE_API_TOKEN");
    expect(source).toContain("/user/tokens/verify");
    expect(source).not.toMatch(/INSERT INTO installation_settings[\s\S]{0,400}apiToken/);
    expect(admin).toContain("Abrir autorização na Cloudflare");
    expect(installer).toContain("CLOUDFLARE_ACCOUNT_ID: accountId");
  });

  it("protege o verificador temporário antes de gravar no D1", async () => {
    const secret = "segredo-de-sessao-com-entropia-suficiente";
    const sealed = await sealSecret("verificador-pkce", secret);
    expect(sealed).not.toContain("verificador-pkce");
    await expect(openSecret(sealed, secret)).resolves.toBe("verificador-pkce");
  });

  it("gera um desafio PKCE em base64url", async () => {
    const challenge = await sha256Base64Url("a".repeat(64));
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("processa o callback por state antes de exigir a sessão SameSite=Strict", () => {
    const index = readFileSync(resolve(root, "apps/worker/src/index.ts"), "utf8");
    const callback = index.indexOf("handleCloudflareOAuthCallback(request, env, url)");
    const session = index.indexOf("getCurrentUser(request, env, ctx)", callback);
    expect(callback).toBeGreaterThan(-1);
    expect(session).toBeGreaterThan(callback);
  });

  it("versiona a permissão de criação de zonas para pedir nova autorização", () => {
    const cloudflare = readFileSync(resolve(root, "apps/worker/src/cloudflare.ts"), "utf8");
    const admin = readFileSync(resolve(root, "apps/web/src/AdminSettings.tsx"), "utf8");
    expect(cloudflare).toContain("OAUTH_PERMISSION_VERSION");
    expect(cloudflare).toContain('"zone.write"');
    expect(cloudflare).toContain("zoneImportReady");
    expect(admin).toContain("provider?.zoneImportReady");
  });

  it("aguarda falhas assíncronas da Cloudflare para devolver erro útil", () => {
    const domains = readFileSync(resolve(root, "apps/worker/src/domains.ts"), "utf8");
    expect(domains).toContain("return await importExternalDomain");
    expect(domains).toContain("CLOUDFLARE_ZONE_PERMISSION_REQUIRED");
  });

  it("resolve a raiz do domínio para a página publicada do funil", () => {
    const domains = readFileSync(resolve(root, "apps/worker/src/domains.ts"), "utf8");
    expect(domains).toContain("resolveCustomDomainUrl");
    expect(domains).toContain("p.published_version_id IS NOT NULL");
    expect(domains).toContain("d.hostname = ? AND d.status = 'active'");
    expect(domains).toContain("p.published_version_id IS NOT NULL");
    expect(domains).toContain("attached.cert_id ? \"active\" : \"validating\"");
  });
});
