import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("configuração open source", () => {
  const root = resolve(import.meta.dirname, "../..");

  it("mantém FREE_ONLY ligado por padrão", () => {
    const config = JSON.parse(readFileSync(resolve(root, "wrangler.jsonc"), "utf8")) as {
      vars: { FREE_ONLY: string };
    };
    expect(config.vars.FREE_ONLY).toBe("true");
  });

  it("usa Workers Static Assets e prefixo exclusivo", () => {
    const config = JSON.parse(readFileSync(resolve(root, "wrangler.jsonc"), "utf8")) as {
      name: string;
      assets: { directory: string; run_worker_first: string[] };
    };
    expect(config.name.startsWith("funnel-zero")).toBe(true);
    expect(config.assets.directory).toBe("./dist");
    expect(config.assets.run_worker_first).toContain("/api/*");
  });

  it("não contém segredos no Wrangler", () => {
    const raw = readFileSync(resolve(root, "wrangler.jsonc"), "utf8");
    expect(raw).not.toMatch(/SESSION_SECRET|password_hash|api[_-]?token/i);
  });
});
