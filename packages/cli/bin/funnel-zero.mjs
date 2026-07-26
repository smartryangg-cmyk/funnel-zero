#!/usr/bin/env node

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const stateDir = join(projectRoot, ".funnel-zero");
const manifestPath = join(stateDir, "installation.json");
const setupUrlPath = join(stateDir, "setup-url.txt");
const configPath = join(projectRoot, "wrangler.jsonc");
const wranglerBin = join(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js");
const isWindows = process.platform === "win32";
const npmCommand = isWindows ? "npm.cmd" : "npm";
const args = new Set(process.argv.slice(2));
const nonInteractive = args.has("--yes") || process.env.CI === "true";
const command = process.argv.slice(2).find((arg) => !arg.startsWith("--")) ?? "setup";

const colors = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  violet: "\x1b[35m",
  yellow: "\x1b[33m",
  red: "\x1b[31m"
};

function line(value = "") {
  output.write(`${value}\n`);
}

function ok(label) {
  line(`${colors.green}✓${colors.reset} ${label}`);
}

function info(label) {
  line(`${colors.violet}◆${colors.reset} ${label}`);
}

function warn(label) {
  line(`${colors.yellow}!${colors.reset} ${label}`);
}

function fail(message) {
  throw new Error(message);
}

function runWrangler(wranglerArgs, options = {}) {
  const result = spawnSync(
    process.execPath,
    [wranglerBin, ...wranglerArgs],
    {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        ...(options.accountId ? { CLOUDFLARE_ACCOUNT_ID: options.accountId } : {})
      },
      input: options.input,
      stdio: options.interactive ? "inherit" : ["pipe", "pipe", "pipe"]
    }
  );
  const stdout = result.stdout?.toString() ?? "";
  const stderr = result.stderr?.toString() ?? "";
  if (result.status !== 0 && !options.allowFailure) {
    const detail = stripAnsi(`${stdout}\n${stderr}`).trim();
    fail(detail || result.error?.message || `Wrangler falhou: ${wranglerArgs.join(" ")}`);
  }
  return { status: result.status ?? 1, stdout, stderr };
}

function runNpm(npmArgs, options = {}) {
  const result = spawnSync(npmCommand, npmArgs, {
    cwd: projectRoot,
    encoding: "utf8",
    env: process.env,
    stdio: options.quiet ? ["ignore", "pipe", "pipe"] : "inherit",
    shell: isWindows
  });
  if (result.status !== 0) fail(`Comando falhou: npm ${npmArgs.join(" ")}`);
  return result;
}

function openBrowser(targetUrl) {
  try {
    const platform = process.platform;
    if (platform === "win32") {
      const safeUrl = targetUrl.replace(/'/g, "''");
      spawnSync("powershell", ["-NoProfile", "-Command", `Start-Process '${safeUrl}'`], { stdio: "ignore" });
    } else if (platform === "darwin") {
      spawnSync("open", [targetUrl], { stdio: "ignore" });
    } else {
      spawnSync("xdg-open", [targetUrl], { stdio: "ignore" });
    }
  } catch {
    // Ignora falhas ao tentar abrir navegador automaticamente
  }
}

function stripAnsi(value) {
  return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

function readManifest() {
  if (!existsSync(manifestPath)) return null;
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

function saveManifest(manifest) {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function readConfig() {
  return JSON.parse(readFileSync(configPath, "utf8"));
}

function saveConfig(config) {
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

async function prompt(question, defaultValue) {
  if (nonInteractive) return defaultValue;
  const readline = createInterface({ input, output });
  const answer = await readline.question(`${question}${defaultValue ? ` ${colors.dim}(${defaultValue})${colors.reset}` : ""}: `);
  readline.close();
  return answer.trim() || defaultValue;
}

async function confirm(question, defaultYes = true) {
  if (nonInteractive) return defaultYes;
  const answer = (await prompt(`${question} [${defaultYes ? "S/n" : "s/N"}]`, "")).toLowerCase();
  return answer ? answer.startsWith("s") || answer.startsWith("y") : defaultYes;
}

function parseD1List(accountId) {
  const result = runWrangler(["d1", "list", "--json"], { accountId, quiet: true });
  return JSON.parse(stripAnsi(result.stdout));
}

function parseR2Names(accountId) {
  const result = runWrangler(["r2", "bucket", "list"], { accountId, quiet: true });
  return [...stripAnsi(result.stdout).matchAll(/^name:\s+(.+)$/gm)].map((match) => match[1].trim());
}

function verifyPrefix(value, fallback) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const withPrefix = normalized.startsWith("krano") || normalized.startsWith("funnel-zero")
    ? normalized
    : `krano-${normalized}`;
  return withPrefix === "krano-" || withPrefix.length < 4 ? fallback : withPrefix;
}

async function chooseAccount() {
  let whoami = runWrangler(["whoami"], { quiet: true, allowFailure: true });
  let clean = stripAnsi(`${whoami.stdout}\n${whoami.stderr}`);
  let accounts = parseAccounts(clean);
  if (accounts.length === 0) {
    line();
    info("Conectar KRANO à Cloudflare");
    line("Uma página segura da Cloudflare será aberta para você escolher a conta e autorizar:");
    line("  • publicar e atualizar a KRANO;");
    line("  • criar o banco D1 e a biblioteca R2;");
    line("  • configurar os domínios que você escolher.");
    line();
    runWrangler(["login", "--callback-host", "127.0.0.1"], { interactive: true });
    whoami = runWrangler(["whoami"], { quiet: true });
    clean = stripAnsi(`${whoami.stdout}\n${whoami.stderr}`);
    accounts = parseAccounts(clean);
  }
  if (accounts.length === 0) fail("A Cloudflare não devolveu nenhuma conta autorizada.");
  if (accounts.length === 1) return accounts[0].id;
  line("Contas disponíveis:");
  accounts.forEach((account, index) => line(`  ${index + 1}. ${account.name}`));
  const chosen = Number(await prompt("Selecione a conta", "1"));
  return accounts[Math.max(0, Math.min(accounts.length - 1, chosen - 1))].id;
}

function parseAccounts(value) {
  const rows = [...value.matchAll(/│\s*([^│\r\n]+?)\s*│\s*([a-f0-9]{32})\s*│/gi)].map(
    (match) => ({ name: match[1].trim(), id: match[2] })
  );
  return [...new Map(rows.map((account) => [account.id, account])).values()];
}

async function ensureInfrastructure({ accountId, workerName, databaseName, bucketName, created }) {
  const databases = parseD1List(accountId);
  let database = databases.find((item) => item.name === databaseName);
  if (!database) {
    info(`Criando D1 ${databaseName}`);
    runWrangler(["d1", "create", databaseName, "--location", "enam"], { accountId, quiet: true });
    database = parseD1List(accountId).find((item) => item.name === databaseName);
    if (!database) fail("O D1 foi criado, mas não pôde ser localizado.");
    created.database = true;
  } else {
    ok(`D1 reutilizado: ${databaseName}`);
  }

  const buckets = parseR2Names(accountId);
  if (!buckets.includes(bucketName)) {
    info(`Criando R2 Standard ${bucketName}`);
    runWrangler(
      ["r2", "bucket", "create", bucketName, "--location", "enam", "--storage-class", "Standard"],
      { accountId, quiet: true }
    );
    created.bucket = true;
  } else {
    ok(`R2 reutilizado: ${bucketName}`);
  }

  const config = readConfig();
  config.name = workerName;
  config.vars = {
    ...config.vars,
    WORKER_NAME: workerName,
    CLOUDFLARE_ACCOUNT_ID: accountId
  };
  config.d1_databases = [
    {
      binding: "DB",
      database_name: databaseName,
      database_id: database.uuid,
      migrations_dir: "./migrations"
    }
  ];
  config.r2_buckets = [{ binding: "MEDIA", bucket_name: bucketName }];
  saveConfig(config);
  return database.uuid;
}

function setRemoteSecret(name, value, accountId) {
  runWrangler(["secret", "put", name], {
    accountId,
    input: `${value}\n`,
    quiet: true
  });
}

function remoteSecretExists(name, workerName, accountId) {
  const result = runWrangler(
    ["secret", "list", "--name", workerName, "--format", "json"],
    { accountId, quiet: true, allowFailure: true }
  );
  if (result.status !== 0) return false;
  try {
    const secrets = JSON.parse(stripAnsi(result.stdout));
    return secrets.some((secret) => secret.name === name);
  } catch {
    return false;
  }
}

function remoteInstallationComplete(databaseName, accountId) {
  const result = runWrangler(
    [
      "d1",
      "execute",
      databaseName,
      "--remote",
      "--command",
      "SELECT COUNT(*) AS user_count FROM users;",
      "--json"
    ],
    { accountId, quiet: true, allowFailure: true }
  );
  if (result.status !== 0) return false;
  try {
    const response = JSON.parse(stripAnsi(result.stdout));
    return Number(response?.[0]?.results?.[0]?.user_count ?? 0) > 0;
  } catch {
    return false;
  }
}

function insertSetupToken(databaseName, tokenHash, accountId, workerName = "krano-app") {
  const sqlPath = join(stateDir, "issue-setup-token.sql");
  const providerConfigJson = JSON.stringify({
    configured: true,
    connected: false,
    authMode: "none",
    accountId: accountId,
    accountName: `Cloudflare (${accountId.slice(0, 8)})`,
    workerName: workerName,
    scopes: [],
    permissionVersion: 2
  }).replace(/'/g, "''");
  const statement = [
    "UPDATE setup_tokens SET used_at = datetime('now') WHERE used_at IS NULL;",
    `INSERT INTO setup_tokens(id, token_hash, expires_at) VALUES ('${randomUUID()}', '${tokenHash}', datetime('now', '+2 hours'));`,
    `INSERT INTO installation_settings(key, value_json, updated_at) VALUES ('domain_provider', '${providerConfigJson}', datetime('now')) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = datetime('now');`
  ].join("\n");
  writeFileSync(sqlPath, `${statement}\n`, "utf8");
  try {
    runWrangler(["d1", "execute", databaseName, "--remote", "--file", sqlPath], {
      accountId,
      quiet: true
    });
  } finally {
    writeFileSync(sqlPath, "-- token removido após emissão\n", "utf8");
  }
}

function resolveDeploymentUrl(outputText, workerName) {
  const match = stripAnsi(outputText).match(/https:\/\/[a-z0-9.-]+\.workers\.dev/i);
  return match?.[0] ?? `https://${workerName}.workers.dev`;
}

async function rollback(created, accountId, databaseName, bucketName, workerName) {
  warn("A instalação falhou antes da conclusão.");
  if (!(await confirm("Remover apenas os recursos criados nesta tentativa?", true))) return;
  if (created.worker) {
    runWrangler(["delete", workerName], {
      accountId,
      input: "y\n",
      quiet: true,
      allowFailure: true
    });
  }
  if (created.database) {
    runWrangler(["d1", "delete", databaseName, "--skip-confirmation"], {
      accountId,
      quiet: true,
      allowFailure: true
    });
  }
  if (created.bucket) {
    runWrangler(["r2", "bucket", "delete", bucketName], {
      accountId,
      quiet: true,
      allowFailure: true
    });
  }
}

async function waitForHealth(deploymentUrl) {
  const healthUrl = new URL("/api/health", deploymentUrl).toString();
  let lastError = "sem resposta";
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      const response = await fetch(healthUrl, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000)
      });
      if (response.ok) {
        const payload = await response.json().catch(() => null);
        if (payload?.ok === true) return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_500));
  }
  warn(`A URL pública ainda está propagando na Cloudflare (${lastError}). Abrindo o painel assim mesmo...`);
}

async function setup() {
  line();
  line(`${colors.red}KRANO${colors.reset}`);
  line("Teste ofertas, não ferramentas.");
  line();

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor < 20) fail("Node.js 20 ou superior é obrigatório.");
  ok(`Node.js ${process.versions.node} detectado`);

  const version = runWrangler(["--version"], { quiet: true });
  ok(`Wrangler ${stripAnsi(version.stdout).trim()} detectado`);

  const accountId = await chooseAccount();
  ok("Cloudflare autenticada");

  const previous = readManifest();
  const installationName = verifyPrefix(
    await prompt("Nome da instalação", previous?.installationName ?? "krano-app"),
    "krano-app"
  );
  const workerName = installationName;
  const databaseName = `${installationName}-db`;
  const bucketName = `${installationName}-media`;

  line();
  line(`Worker: ${workerName}`);
  line(`D1:     ${databaseName}`);
  line(`R2:     ${bucketName} (Standard)`);
  line("Modo:   FREE_ONLY=true");
  if (!(await confirm("Criar ou reutilizar esta infraestrutura?", true))) {
    line("Instalação cancelada sem alterações.");
    return;
  }

  const created = { database: false, bucket: false, worker: false };
  const originalConfig = readFileSync(configPath, "utf8");
  try {
    mkdirSync(stateDir, { recursive: true });
    info("Verificando infraestrutura");
    const databaseId = await ensureInfrastructure({
      accountId,
      workerName,
      databaseName,
      bucketName,
      created
    });

    info("Gerando tipos e instalando schema");
    runWrangler(["types"], { accountId, quiet: true });
    runWrangler(["d1", "migrations", "apply", databaseName, "--remote"], {
      accountId,
      quiet: true
    });
    ok("Migrations aplicadas");

    const isDev = args.has("--dev");
    if (isDev) {
      info("Executando testes e typecheck (modo dev)");
      runNpm(["run", "typecheck"]);
      runNpm(["run", "test"]);
    }
    info("Compilando a aplicação");
    runNpm(["run", "build"]);
    runWrangler(["deploy", "--dry-run"], { accountId, quiet: true });
    ok("Validação concluída");

    info("Publicando instalação de desenvolvimento");
    const workerExisted =
      runWrangler(["deployments", "list", "--name", workerName, "--json"], {
        accountId,
        quiet: true,
        allowFailure: true
      }).status === 0;
    const deploy = runWrangler(["deploy", "--minify"], { accountId, quiet: true });
    created.worker = !workerExisted;
    const deploymentUrl = resolveDeploymentUrl(`${deploy.stdout}\n${deploy.stderr}`, workerName);
    ok("Worker publicado");

    if (remoteSecretExists("SESSION_SECRET", workerName, accountId)) {
      ok("Segredo de sessão reutilizado");
    } else {
      const sessionSecret = randomBytes(32).toString("base64url");
      setRemoteSecret("SESSION_SECRET", sessionSecret, accountId);
      ok("Segredo de sessão configurado");
    }
    info("Verificando a URL pública");
    await waitForHealth(deploymentUrl);
    ok("URL pública e banco verificados");

    const installationComplete = remoteInstallationComplete(databaseName, accountId);
    let setupUrl = null;
    if (installationComplete) {
      ok("Onboarding já concluído");
    } else {
      const setupToken = randomBytes(32).toString("base64url");
      const setupTokenHash = createHash("sha256").update(setupToken).digest("hex");
      insertSetupToken(databaseName, setupTokenHash, accountId, workerName);
      setupUrl = `${deploymentUrl}/setup?token=${encodeURIComponent(setupToken)}`;
    }

    const manifest = {
      schemaVersion: 1,
      appVersion: "0.1.0",
      installationName,
      accountId,
      worker: { name: workerName, url: deploymentUrl },
      d1: { name: databaseName, id: databaseId },
      r2: { name: bucketName, storageClass: "Standard" },
      freeOnly: true,
      installedAt: new Date().toISOString()
    };
    saveManifest(manifest);
    writeFileSync(
      setupUrlPath,
      setupUrl ? `${setupUrl}\n` : `Onboarding concluído: ${deploymentUrl}/login\n`,
      "utf8"
    );
    try {
      chmodSync(setupUrlPath, 0o600);
    } catch {
      // O Windows gerencia permissões pelo perfil do usuário.
    }

    line();
    ok("Worker");
    ok("Banco D1");
    ok("Bucket R2 Standard");
    ok("Migrations");
    ok("Segredos");
    ok("Aplicação");
    ok("Templates");
    line();
    line(`${colors.green}Instalação concluída${colors.reset}`);
    line(`Aplicação: ${deploymentUrl}`);
    line(setupUrl ? `Configuração única: ${setupUrl}` : `Painel: ${deploymentUrl}/login`);
    line();
    if (setupUrl) {
      line(`${colors.dim}A URL expira em 2 horas e deixa de funcionar após o primeiro uso.${colors.reset}`);
    }

    const targetUrl = setupUrl || `${deploymentUrl}/login`;
    info("Abrindo o painel no seu navegador...");
    openBrowser(targetUrl);
  } catch (error) {
    writeFileSync(configPath, originalConfig, "utf8");
    await rollback(created, accountId, databaseName, bucketName, workerName);
    throw error;
  }
}

if (command !== "setup") {
  fail(`Comando desconhecido: ${command}`);
}

setup().catch((error) => {
  line();
  line(`${colors.red}Erro:${colors.reset} ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
