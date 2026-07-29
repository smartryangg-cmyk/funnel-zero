import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SessionUser } from "../../packages/shared/src/schemas";
import { hasAnyRole } from "../../apps/worker/src/auth";
import { isPrivatePagePath } from "../../apps/worker/src/index";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function source(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

describe("endurecimento de autenticação", () => {
  it("aplica papéis explicitamente", () => {
    const analyst: SessionUser = {
      id: "analyst",
      name: "Analista",
      email: "analista@example.com",
      role: "analyst"
    };
    expect(hasAnyRole(analyst, ["analyst", "editor"])).toBe(true);
    expect(hasAnyRole(analyst, ["owner", "admin"])).toBe(false);
  });

  it("protege todas as superfícies administrativas no servidor", () => {
    for (const path of [
      "/home",
      "/dashboard",
      "/integrations/cloudflare",
      "/account",
      "/hosting",
      "/kratube",
      "/studio",
      "/offers",
      "/funnels/123",
      "/pages/123/edit",
      "/media-library",
      "/tracking",
      "/domains",
      "/subdomains",
      "/studies",
      "/settings"
    ]) {
      expect(isPrivatePagePath(path), path).toBe(true);
    }
    expect(isPrivatePagePath("/login")).toBe(false);
    expect(isPrivatePagePath("/setup")).toBe(false);
    expect(isPrivatePagePath("/reset-password")).toBe(false);
    expect(isPrivatePagePath("/o/oferta")).toBe(false);
  });

  it("reivindica setup e recuperação de forma atômica e de uso único", () => {
    const worker = source("apps/worker/src/index.ts");
    expect(worker).toContain("UPDATE setup_tokens");
    expect(worker).toContain("RETURNING id");
    expect(worker).toContain("UPDATE password_recovery_tokens");
    expect(worker).toContain("RETURNING user_id");
    expect(worker).toContain('"/api/auth/recovery/complete"');
    expect(worker).toContain('"/api/account/email"');
  });

  it("limpa falhas após sucesso, limita escrita de last_seen e informa Retry-After", () => {
    const auth = source("apps/worker/src/auth.ts");
    const worker = source("apps/worker/src/index.ts");
    expect(auth).toContain("clearLoginFailures");
    expect(auth).toContain("last_seen_at < datetime('now', '-5 minutes')");
    expect(worker).toContain("await clearLoginFailures(env, identityHash)");
    expect(worker).toContain('"Retry-After": "900"');
  });

  it("mantém recuperação local sem serviço de e-mail ou token em endpoint GET", () => {
    const cli = source("packages/cli/bin/funnel-zero.mjs");
    const worker = source("apps/worker/src/index.ts");
    const migration = source("migrations/0010_auth_hardening.sql");
    expect(cli).toContain('command !== "setup" && command !== "recover"');
    expect(cli).toContain('new URL("/reset-password"');
    expect(cli).toContain('"whoami", "--json"');
    expect(migration).toContain("CREATE TABLE password_recovery_tokens");
    expect(migration).toContain("idx_users_single_active_owner");
    expect(worker).not.toMatch(
      /request\.method === "GET"[^\n]+\/api\/auth\/recovery/ 
    );
  });
});

describe("instalador reproduzível", () => {
  it("usa npm ci e um sinal estruturado para o executável", () => {
    const bootstrap = source("install.mjs");
    expect(bootstrap).toContain('["ci", "--no-audit", "--no-fund"]');
    expect(bootstrap).toContain("shell: isWindows && command === npmCommand");
    const cli = source("packages/cli/bin/funnel-zero.mjs");
    expect(cli).toContain("KRANO_RESULT_JSON:");
    expect(cli).toContain('const APP_VERSION = "0.4.9"');
    expect(cli).toContain('!["whoami", "login", "logout"].includes(commandName)');
    expect(cli).toContain("copyFileSync(configExamplePath, configPath)");
    expect(cli).toContain('args.has("--enable-r2")');
    expect(cli).toContain("delete config.r2_buckets");
    expect(cli).toContain('MEDIA_ENABLED: enableR2 ? "true" : "false"');
    expect(readFileSync(resolve(root, "scripts/uninstall.mjs"), "utf8")).toContain(
      '["delete", installation.worker.name, "--force"]'
    );
  });

  it("reconstrói, compara e publica releases somente em tags", () => {
    const workflow = source(".github/workflows/installers.yml");
    expect(workflow).toContain("cmp release/KRANO-Installer-Windows-x64.exe");
    expect(workflow).toContain("Publish versioned GitHub Release");
    expect(workflow).toContain("startsWith(github.ref, 'refs/tags/v')");
    expect(workflow).not.toMatch(/signtool|codesign|authenticode/i);
  });
});
