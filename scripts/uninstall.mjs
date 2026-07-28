import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const root = resolve(import.meta.dirname, "..");
const manifestPath = join(root, ".funnel-zero", "installation.json");
if (!existsSync(manifestPath)) throw new Error("Manifesto da instalação não encontrado. Nada será removido.");
const installation = JSON.parse(readFileSync(manifestPath, "utf8"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

console.log("Funnel Zero — desinstalação segura");
console.log("Somente estes recursos do manifesto podem ser removidos:");
console.log(`  Worker: ${installation.worker.name}`);
console.log(`  D1:     ${installation.d1.name} (${installation.d1.id})`);
console.log(`  R2:     ${installation.r2.name}`);
console.log();
console.log("Recomendação: execute `npm run backup` antes.");

const readline = createInterface({ input, output });
const preserveD1 = (await readline.question("Preservar o D1? [S/n]: ")).trim().toLowerCase() !== "n";
const preserveR2 = (await readline.question("Preservar o R2? [S/n]: ")).trim().toLowerCase() !== "n";
const confirmation = await readline.question(`Digite REMOVER ${installation.installationName}: `);
readline.close();
if (confirmation !== `REMOVER ${installation.installationName}`) {
  console.log("Desinstalação cancelada.");
  process.exit(0);
}

function run(args, inputValue) {
  const result = spawnSync(npm, ["exec", "--", "wrangler", ...args], {
    cwd: root,
    stdio: inputValue ? ["pipe", "inherit", "inherit"] : "inherit",
    input: inputValue,
    env: {
      ...process.env,
      ...(installation.accountId ? { CLOUDFLARE_ACCOUNT_ID: installation.accountId } : {})
    }
  });
  if (result.status !== 0) throw new Error(`Falha em: wrangler ${args.join(" ")}`);
}

run(["delete", installation.worker.name, "--force"]);
if (!preserveD1) {
  run(["d1", "delete", installation.d1.name, "--skip-confirmation"]);
}
if (!preserveR2) {
  run(["r2", "bucket", "delete", installation.r2.name]);
}
console.log("Desinstalação concluída. Recursos preservados não foram alterados.");
