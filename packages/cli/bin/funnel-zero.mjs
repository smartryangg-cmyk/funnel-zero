#!/usr/bin/env node

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const stateDir = join(projectRoot, ".funnel-zero");
const manifestPath = join(stateDir, "installation.json");
const setupUrlPath = join(stateDir, "setup-url.txt");
const recoveryUrlPath = join(stateDir, "recovery-url.txt");
const configPath = join(projectRoot, "wrangler.jsonc");
const configExamplePath = join(projectRoot, "wrangler.example.jsonc");
const wranglerBin = join(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js");
const isWindows = process.platform === "win32";
const npmCommand = isWindows ? "npm.cmd" : "npm";
const APP_VERSION = "0.4.7";
const RESULT_PREFIX = "KRANO_RESULT_JSON:";
const REQUIRED_WRANGLER_SCOPES = [
  "account:read",
  "user:read",
  "workers:write",
  "workers_routes:write",
  "workers_scripts:write",
  "d1:write",
  "zone:read",
  "offline_access"
];
const args = new Set(process.argv.slice(2));
const nonInteractive = args.has("--yes") || process.env.CI === "true";
const command = process.argv.slice(2).find((arg) => !arg.startsWith("--")) ?? "setup";
const optionValue = (name) => {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? "";
};
const requestedName = optionValue("name");
const profileName = optionValue("profile");

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

function emitResult(result) {
  line(`${RESULT_PREFIX}${JSON.stringify(result)}`);
}

function runWrangler(wranglerArgs, options = {}) {
  const commandName = wranglerArgs[0] ?? "";
  const supportsNamedProfile = !["whoami", "login", "logout"].includes(commandName);
  const result = spawnSync(
    process.execPath,
    [wranglerBin, ...(profileName && supportsNamedProfile ? ["--profile", profileName] : []), ...wranglerArgs],
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
  if (!existsSync(configPath)) {
    if (!existsSync(configExamplePath)) {
      fail("wrangler.example.jsonc não foi encontrado no pacote da KRANO.");
    }
    copyFileSync(configExamplePath, configPath);
  }
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

async function chooseAccount(preferredAccountId = "") {
  let identity = readWranglerIdentity();
  if (
    identity.accounts.length === 0
    || REQUIRED_WRANGLER_SCOPES.some((scope) => !identity.tokenPermissions.includes(scope))
  ) {
    authorizeCloudflare();
    identity = readWranglerIdentity(false);
  }
  if (identity.accounts.length === 0) {
    fail("A Cloudflare não devolveu nenhuma conta autorizada.");
  }

  line();
  if (identity.email) line(`Cloudflare conectada como: ${identity.email}`);
  line("Contas disponíveis:");
  identity.accounts.forEach((account, index) => line(`  ${index + 1}. ${account.name}`));
  const preferredIndex = Math.max(
    0,
    identity.accounts.findIndex((account) => account.id === preferredAccountId)
  );

  if (identity.accounts.length === 1) {
    const account = identity.accounts[0];
    if (!(await confirm(`Usar a conta “${account.name}”?`, true))) {
      fail("Conta não confirmada. Execute `wrangler logout` para entrar com outra conta e tente novamente.");
    }
    return account.id;
  }

  const answer = await prompt("Selecione a conta", String(preferredIndex + 1));
  const selected = Number(answer);
  if (!Number.isInteger(selected) || selected < 1 || selected > identity.accounts.length) {
    fail("Seleção de conta inválida. Informe o número exibido na lista.");
  }
  const account = identity.accounts[selected - 1];
  if (!(await confirm(`Confirmar “${account.name}”?`, true))) {
    fail("Conta não confirmada. Execute novamente e escolha a conta correta.");
  }
  return account.id;
}

function authorizeCloudflare() {
  line();
  info("Conectar KRANO à Cloudflare");
  line("Uma página segura da Cloudflare será aberta para você escolher a conta e autorizar:");
  line("  • publicar e atualizar a KRANO;");
  line("  • criar o banco D1 e a biblioteca R2;");
  line("  • configurar os domínios que você escolher.");
  line();
  runWrangler(
    [
      "login",
      "--use-keyring",
      "--scopes",
      REQUIRED_WRANGLER_SCOPES.join(" ")
    ],
    { interactive: true }
  );
}

function readWranglerIdentity(allowFailure = true) {
  const jsonResult = runWrangler(["whoami", "--json"], {
    quiet: true,
    allowFailure
  });
  if (jsonResult.status === 0) {
    try {
      const parsed = JSON.parse(stripAnsi(jsonResult.stdout));
      const accounts = Array.isArray(parsed.accounts)
        ? parsed.accounts
          .filter((account) => (
            account
            && typeof account.id === "string"
            && /^[a-f0-9]{32}$/i.test(account.id)
          ))
          .map((account) => ({
            id: account.id,
            name: typeof account.name === "string" && account.name ? account.name : account.id
          }))
        : [];
      return {
        email: typeof parsed.email === "string" ? parsed.email : "",
        accounts,
        tokenPermissions: Array.isArray(parsed.tokenPermissions)
          ? parsed.tokenPermissions.filter((scope) => typeof scope === "string")
          : []
      };
    } catch {
      // Compatibilidade com versões antigas do Wrangler sem saída JSON estável.
    }
  }

  const fallback = runWrangler(["whoami"], { quiet: true, allowFailure });
  const clean = stripAnsi(`${fallback.stdout}\n${fallback.stderr}`);
  return {
    email: clean.match(/email\s+([^\s.]+@[^\s.]+)/i)?.[1] ?? "",
    accounts: parseAccountsTable(clean),
    tokenPermissions: [...clean.matchAll(/-\s+([a-z0-9_-]+)\s+\((read|write|admin)\)/gi)]
      .map((match) => `${match[1]}:${match[2]}`)
  };
}

function parseAccountsTable(value) {
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

function insertSetupToken(databaseName, tokenHash, accountId) {
  const sqlPath = join(stateDir, "issue-setup-token.sql");
  const statement = [
    "UPDATE setup_tokens SET used_at = datetime('now') WHERE used_at IS NULL;",
    `INSERT INTO setup_tokens(id, token_hash, expires_at) VALUES ('${randomUUID()}', '${tokenHash}', datetime('now', '+2 hours'));`
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

function writePrivateText(path, value) {
  writeFileSync(path, value, "utf8");
  try {
    chmodSync(path, 0o600);
  } catch {
    // O Windows restringe os arquivos pela ACL do perfil do usuário.
  }
}

function remoteOwners(databaseName, accountId) {
  const result = runWrangler(
    [
      "d1",
      "execute",
      databaseName,
      "--remote",
      "--command",
      "SELECT id FROM users WHERE role = 'owner' AND disabled_at IS NULL ORDER BY created_at LIMIT 2;",
      "--json"
    ],
    { accountId, quiet: true }
  );
  try {
    const payload = JSON.parse(stripAnsi(result.stdout));
    const rows = payload?.[0]?.results;
    return Array.isArray(rows)
      ? rows.filter((row) => row && typeof row.id === "string")
      : [];
  } catch {
    fail("A KRANO não conseguiu identificar o proprietário no banco D1.");
  }
}

function insertRecoveryToken(databaseName, userId, tokenHash, accountId) {
  if (!/^[a-f0-9-]{16,}$/i.test(userId) || !/^[a-f0-9]{64}$/i.test(tokenHash)) {
    fail("Não foi possível emitir um token de recuperação seguro.");
  }
  const sqlPath = join(stateDir, "issue-recovery-token.sql");
  const statement = [
    `UPDATE password_recovery_tokens SET used_at = datetime('now') WHERE user_id = '${userId}' AND used_at IS NULL;`,
    `INSERT INTO password_recovery_tokens(id, user_id, token_hash, expires_at) VALUES ('${randomUUID()}', '${userId}', '${tokenHash}', datetime('now', '+30 minutes'));`
  ].join("\n");
  writePrivateText(sqlPath, `${statement}\n`);
  try {
    runWrangler(["d1", "execute", databaseName, "--remote", "--file", sqlPath], {
      accountId,
      quiet: true
    });
  } finally {
    writePrivateText(sqlPath, "-- token removido após emissão\n");
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
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      const response = await fetch(healthUrl, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000)
      });
      const payload = await response.json();
      if (response.ok && payload?.ok === true && payload?.freeOnly === true) {
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
  }
  fail(`O deploy foi enviado, mas a verificação pública falhou: ${lastError}`);
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

  const previous = readManifest();
  const accountId = await chooseAccount(previous?.accountId ?? "");
  ok("Cloudflare autenticada");

  const installationName = verifyPrefix(
    await prompt("Nome da instalação", requestedName || previous?.installationName || "krano-development"),
    "krano-development"
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
  readConfig();
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

    info("Executando testes, build e deploy dry-run");
    runNpm(["run", "typecheck"]);
    runNpm(["run", "test"]);
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
      insertSetupToken(databaseName, setupTokenHash, accountId);
      setupUrl = `${deploymentUrl}/setup?token=${encodeURIComponent(setupToken)}`;
    }

    const manifest = {
      schemaVersion: 1,
      appVersion: APP_VERSION,
      installationName,
      accountId,
      worker: { name: workerName, url: deploymentUrl },
      d1: { name: databaseName, id: databaseId },
      r2: { name: bucketName, storageClass: "Standard" },
      freeOnly: true,
      installedAt: new Date().toISOString()
    };
    saveManifest(manifest);
    writePrivateText(
      setupUrlPath,
      setupUrl ? `${setupUrl}\n` : `Onboarding concluído: ${deploymentUrl}/login\n`
    );

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
    emitResult({
      ok: true,
      action: setupUrl ? "onboarding" : "login",
      url: setupUrl ?? `${deploymentUrl}/login`,
      recoveryFile: setupUrlPath,
      version: APP_VERSION
    });
  } catch (error) {
    writeFileSync(configPath, originalConfig, "utf8");
    await rollback(created, accountId, databaseName, bucketName, workerName);
    throw error;
  }
}

async function recover() {
  line();
  line(`${colors.red}KRANO${colors.reset} · recuperação local`);
  line();
  const manifest = readManifest();
  if (
    !manifest
    || typeof manifest.accountId !== "string"
    || typeof manifest?.d1?.name !== "string"
    || typeof manifest?.worker?.url !== "string"
  ) {
    fail("Instalação local não encontrada. Execute a recuperação na pasta usada para instalar a KRANO.");
  }

  const version = runWrangler(["--version"], { quiet: true });
  ok(`Wrangler ${stripAnsi(version.stdout).trim()} detectado`);
  const accountId = await chooseAccount(manifest.accountId);
  if (accountId !== manifest.accountId) {
    fail("A conta escolhida não corresponde à instalação salva nesta pasta.");
  }

  info("Aplicando atualizações de segurança");
  runWrangler(["d1", "migrations", "apply", manifest.d1.name, "--remote"], {
    accountId,
    quiet: true
  });
  const owners = remoteOwners(manifest.d1.name, accountId);
  if (owners.length !== 1) {
    fail(
      owners.length === 0
        ? "Nenhum proprietário ativo foi encontrado nesta instalação."
        : "Há mais de um proprietário ativo. Revise as contas antes de emitir a recuperação."
    );
  }

  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  insertRecoveryToken(manifest.d1.name, owners[0].id, tokenHash, accountId);
  const recoveryUrl = new URL("/reset-password", manifest.worker.url);
  recoveryUrl.searchParams.set("token", token);
  writePrivateText(recoveryUrlPath, `${recoveryUrl}\n`);

  line();
  ok("Link de recuperação criado");
  line(`Abra agora: ${recoveryUrl}`);
  line(`Cópia local protegida: ${recoveryUrlPath}`);
  line(`${colors.dim}O link expira em 30 minutos e deixa de funcionar após o primeiro uso.${colors.reset}`);
  emitResult({
    ok: true,
    action: "recovery",
    url: recoveryUrl.toString(),
    recoveryFile: recoveryUrlPath,
    version: APP_VERSION
  });
}

if (command !== "setup" && command !== "recover") {
  fail(`Comando desconhecido: ${command}`);
}

const operation = command === "recover" ? recover : setup;
operation().catch((error) => {
  line();
  line(`${colors.red}Erro:${colors.reset} ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
