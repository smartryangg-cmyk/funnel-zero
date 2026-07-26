import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const root = resolve(import.meta.dirname, "..");
const backupDir = resolve(process.argv[2] ?? "");
const sqlPath = join(backupDir, "database.sql");
const manifestPath = join(root, ".funnel-zero", "installation.json");
if (!backupDir || !existsSync(sqlPath)) throw new Error("Informe uma pasta de backup válida.");
if (!existsSync(manifestPath)) throw new Error("Instalação atual não encontrada.");

const installation = JSON.parse(readFileSync(manifestPath, "utf8"));
console.log(`Destino D1: ${installation.d1.name}`);
console.log(`Arquivo: ${sqlPath}`);
console.log("A restauração pode substituir registros existentes. Faça backup antes.");

const readline = createInterface({ input, output });
const confirmation = await readline.question(`Digite RESTAURAR ${installation.installationName}: `);
readline.close();
if (confirmation !== `RESTAURAR ${installation.installationName}`) {
  console.log("Restauração cancelada.");
  process.exit(0);
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(
  npm,
  ["exec", "--", "wrangler", "d1", "execute", installation.d1.name, "--remote", "--file", sqlPath],
  { cwd: root, stdio: "inherit", env: process.env }
);
if (result.status !== 0) throw new Error("Falha ao restaurar o D1.");
console.log("D1 restaurado. Reconfigure secrets e restaure o R2 separadamente.");
