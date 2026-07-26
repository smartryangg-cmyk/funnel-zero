import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const stateDir = join(root, ".funnel-zero");
const credentialPath = join(stateDir, "admin-credentials.txt");
const appUrl = process.env.FUNNEL_ZERO_URL ?? "http://localhost:8787/login";
const adminEmail = process.env.FUNNEL_ZERO_ADMIN_EMAIL ?? "admin@example.com";

if (!existsSync(credentialPath)) {
  mkdirSync(stateDir, { recursive: true });
  const password = `FZ!${randomBytes(18).toString("base64url")}9aA`;
  writeFileSync(
    credentialPath,
    `Funnel Zero — desenvolvimento
URL: ${appUrl}
E-mail: ${adminEmail}
Senha temporária: ${password}

Troque esta senha após o primeiro acesso quando a tela de perfil for disponibilizada.
Este arquivo é ignorado pelo Git e não entra nos pacotes públicos.
`,
    "utf8"
  );
  try {
    chmodSync(credentialPath, 0o600);
  } catch {
    // O Windows aplica as permissões do perfil do usuário.
  }
}

console.log(credentialPath);
