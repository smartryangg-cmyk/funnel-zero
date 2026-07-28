import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("configuração open source", () => {
  const root = resolve(import.meta.dirname, "../..");

  it("mantém FREE_ONLY ligado por padrão", () => {
    const config = JSON.parse(readFileSync(resolve(root, "wrangler.jsonc"), "utf8")) as {
      name: string;
      vars: { FREE_ONLY: string; WORKER_NAME: string };
    };
    expect(config.vars.FREE_ONLY).toBe("true");
    expect(config.vars.WORKER_NAME).toBe(config.name);
  });

  it("usa Workers Static Assets e prefixo exclusivo", () => {
    const config = JSON.parse(readFileSync(resolve(root, "wrangler.jsonc"), "utf8")) as {
      name: string;
      assets: { directory: string; run_worker_first: string[] };
    };
    expect(config.name.startsWith("krano")).toBe(true);
    expect(config.assets.directory).toBe("./dist");
    expect(config.assets.run_worker_first).toBe(true);
  });

  it("não contém segredos no Wrangler", () => {
    const raw = readFileSync(resolve(root, "wrangler.jsonc"), "utf8");
    expect(raw).not.toMatch(/SESSION_SECRET|password_hash|api[_-]?token/i);
  });

  it("mantém a interface monocromática sem reativar o tema vermelho", () => {
    const css = readFileSync(resolve(root, "apps/web/src/styles.css"), "utf8");
    expect(css).not.toMatch(/vermelho vibrante|#f00000|#ff3333|#ff2b2b|#b80000/i);
    expect(css).toContain("Garantias finais do tema monocromático");
  });

  it("oferece instalador de etapa única para todos os sistemas", () => {
    expect(existsSync(resolve(root, "install.mjs"))).toBe(true);
    expect(existsSync(resolve(root, "INSTALAR-KRANO.cmd"))).toBe(true);
    expect(existsSync(resolve(root, "install.sh"))).toBe(true);
    expect(existsSync(resolve(root, "installer/main.go"))).toBe(true);
    expect(existsSync(resolve(root, "installer/main_test.go"))).toBe(true);
    expect(existsSync(resolve(root, ".github/workflows/installers.yml"))).toBe(true);
    const result = spawnSync(process.execPath, [resolve(root, "install.mjs"), "--help"], {
      cwd: root,
      encoding: "utf8"
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("aplicativo desktop de instalação e gerenciamento");
  });

  it("gera os tipos Cloudflare antes de validar ou construir um clone limpo", () => {
    const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts.pretypecheck).toBe("wrangler types");
    expect(packageJson.scripts.prebuild).toBe("wrangler types");
    expect(packageJson.scripts["db:migrate:local"]).toContain("krano-development-db");
    expect(packageJson.scripts["db:migrate:remote"]).toContain("krano-development-db");
  });
});
