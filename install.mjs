#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const isWindows = process.platform === "win32";
const npmCommand = isWindows ? "npm.cmd" : "npm";
const cliPath = join(root, "packages", "cli", "bin", "funnel-zero.mjs");

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: isWindows
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function printHelp() {
  console.log(`
KRANO 0.4.8 — aplicativo desktop de instalação e gerenciamento

Uso:
  node install.mjs
  node install.mjs recover

O instalador prepara as dependências, abre a autorização oficial da Cloudflare,
cria ou reutiliza Worker, D1 e R2, aplica as migrations e entrega a URL do painel.

Requisito: Node.js 20 ou superior.
`);
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  printHelp();
  process.exit(0);
}

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor < 20) {
  console.error("A KRANO precisa do Node.js 20 ou superior: https://nodejs.org/");
  process.exit(1);
}
if (!existsSync(cliPath)) {
  console.error("Instalador incompleto: packages/cli/bin/funnel-zero.mjs não foi encontrado.");
  process.exit(1);
}

console.log("\nKRANO");
console.log("Preparando uma instalação limpa e reproduzível…\n");
run(npmCommand, ["ci", "--no-audit", "--no-fund"]);
const installerArgs = process.argv.slice(2);
const requestedCommand = installerArgs[0] === "recover" ? "recover" : "setup";
const forwardedArgs = requestedCommand === "recover" ? installerArgs.slice(1) : installerArgs;
run(process.execPath, [cliPath, requestedCommand, ...forwardedArgs]);
