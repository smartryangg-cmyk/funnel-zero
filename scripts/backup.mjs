import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const statePath = join(root, ".funnel-zero", "installation.json");
if (!existsSync(statePath)) throw new Error("Instalação não encontrada. Execute `npm run setup` primeiro.");

const installation = JSON.parse(readFileSync(statePath, "utf8"));
const stamp = new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
const backupDir = join(root, "backups", stamp);
mkdirSync(backupDir, { recursive: true });

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const sqlPath = join(backupDir, "database.sql");
const result = spawnSync(
  npm,
  ["exec", "--", "wrangler", "d1", "export", installation.d1.name, "--remote", "--output", sqlPath],
  { cwd: root, stdio: "inherit", env: process.env }
);
if (result.status !== 0) throw new Error("Falha ao exportar o D1.");

cpSync(statePath, join(backupDir, "installation.json"));
cpSync(join(root, "wrangler.jsonc"), join(backupDir, "wrangler.jsonc"));
cpSync(join(root, "migrations"), join(backupDir, "migrations"), { recursive: true });

writeFileSync(
  join(backupDir, "backup-manifest.json"),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      appVersion: installation.appVersion,
      createdAt: new Date().toISOString(),
      database: "database.sql",
      r2: {
        bucket: installation.r2.name,
        objectsIncluded: false,
        note: "Use uma ferramenta compatível com a API S3 do R2 para copiar os objetos. Segredos S3 não fazem parte deste backup."
      },
      secretsIncluded: false
    },
    null,
    2
  )}\n`,
  "utf8"
);

writeFileSync(
  join(backupDir, "RESTORE.md"),
  `# Restaurar este backup

1. Reinstale o Funnel Zero e configure novamente os secrets.
2. Execute \`npm run restore -- "${backupDir}"\`.
3. Copie os objetos do bucket R2 com uma ferramenta S3 compatível.

Segredos não foram incluídos.
`,
  "utf8"
);

console.log(`Backup criado em: ${backupDir}`);
