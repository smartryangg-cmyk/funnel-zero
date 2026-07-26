import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { DomainProviderStatus, SessionUser } from "../../../packages/shared/src/schemas";
import { api, ApiError } from "./api";
import { Notice, PageHeader, navigate } from "./ui";

const INSTALLATIONS_KEY = "krano.installations.v1";

interface SavedInstallation {
  id: string;
  name: string;
  url: string;
}

export function Account({
  user,
  onPasswordChanged
}: {
  user: SessionUser;
  onPasswordChanged: () => Promise<void>;
}) {
  const [provider, setProvider] = useState<DomainProviderStatus | null>(null);
  const [installations, setInstallations] = useState<SavedInstallation[]>([]);
  const [installationName, setInstallationName] = useState("");
  const [installationUrl, setInstallationUrl] = useState("");
  const [installationError, setInstallationError] = useState("");
  const [passwords, setPasswords] = useState({ current: "", next: "", confirm: "" });
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [emailForm, setEmailForm] = useState({ email: user.email, currentPassword: "" });
  const [emailError, setEmailError] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);

  useEffect(() => {
    api.domains()
      .then((result) => setProvider(result.provider))
      .catch(() => setProvider(null));

    const current: SavedInstallation = {
      id: window.location.origin,
      name: `KRANO — ${window.location.hostname}`,
      url: window.location.origin
    };
    let saved: SavedInstallation[] = [];
    try {
      const parsed = JSON.parse(localStorage.getItem(INSTALLATIONS_KEY) ?? "[]") as unknown;
      if (Array.isArray(parsed)) saved = parsed.filter(isSavedInstallation);
    } catch {
      saved = [];
    }
    const next = saved.some((item) => item.url === current.url) ? saved : [current, ...saved];
    persistInstallations(next);
    setInstallations(next);
  }, []);

  const currentInstallation = useMemo(
    () => installations.find((item) => item.url === window.location.origin),
    [installations]
  );

  function addInstallation(event: FormEvent) {
    event.preventDefault();
    setInstallationError("");
    try {
      const url = normalizeInstallationUrl(installationUrl);
      const next = [
        ...installations.filter((item) => item.url !== url),
        { id: crypto.randomUUID(), name: installationName.trim(), url }
      ];
      persistInstallations(next);
      setInstallations(next);
      setInstallationName("");
      setInstallationUrl("");
    } catch (caught) {
      setInstallationError(caught instanceof Error ? caught.message : "Revise o endereço informado.");
    }
  }

  function removeInstallation(item: SavedInstallation) {
    if (item.url === window.location.origin) return;
    const next = installations.filter((installation) => installation.id !== item.id);
    persistInstallations(next);
    setInstallations(next);
  }

  async function changeEmail(event: FormEvent) {
    event.preventDefault();
    setEmailError("");
    setSavingEmail(true);
    try {
      await api.changeEmail({
        currentPassword: emailForm.currentPassword,
        email: emailForm.email.trim()
      });
      await onPasswordChanged();
      navigate("/login", true);
    } catch (caught) {
      setEmailError(caught instanceof ApiError ? caught.message : "Não foi possível alterar o e-mail.");
    } finally {
      setSavingEmail(false);
    }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setPasswordError("");
    setPasswordSuccess("");
    if (!strongPassword(passwords.next)) {
      setPasswordError("Use 12 caracteres ou mais, com maiúscula, minúscula, número e símbolo.");
      return;
    }
    if (passwords.next !== passwords.confirm) {
      setPasswordError("As novas senhas não coincidem.");
      return;
    }
    setSavingPassword(true);
    try {
      await api.changePassword({
        currentPassword: passwords.current,
        newPassword: passwords.next
      });
      setPasswordSuccess("Senha alterada. Entre novamente com a nova senha.");
      setPasswords({ current: "", next: "", confirm: "" });
      await onPasswordChanged();
      setTimeout(() => navigate("/login", true), 900);
    } catch (caught) {
      setPasswordError(caught instanceof ApiError ? caught.message : "Não foi possível alterar a senha.");
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Conta e acesso"
        title="Sua conta KRANO, segura e organizada."
        subtitle="Atualize suas credenciais e alterne entre instalações sem expor senhas ou tokens."
      />

      <section className="account-grid">
        <article className="panel account-profile">
          <span className="eyebrow">PERFIL</span>
          <div className="account-avatar">{initials(user.name)}</div>
          <h2>{user.name}</h2>
          <p>{user.email}</p>
          <div className="account-detail"><span>Nível de acesso</span><strong>{roleLabel(user.role)}</strong></div>
          <div className="account-detail">
            <span>Instalação atual</span>
            <strong>{currentInstallation?.name ?? window.location.hostname}</strong>
          </div>
        </article>

        <div className="account-security-stack">
          <article className="panel password-panel">
            <div className="panel-header">
              <div><span className="eyebrow">LOGIN</span><h2>Alterar e-mail</h2></div>
              <span className="security-seal">CONFIRMAÇÃO POR SENHA</span>
            </div>
            <p className="panel-intro">
              Este será o novo e-mail usado para entrar. Por segurança, todas as sessões serão encerradas.
            </p>
            <form className="form password-form" onSubmit={(event) => void changeEmail(event)}>
              <label className="field">
                <span>Novo e-mail de acesso</span>
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={emailForm.email}
                  onChange={(event) => setEmailForm({ ...emailForm, email: event.target.value })}
                />
              </label>
              <SecureInput
                label="Confirme sua senha atual"
                autoComplete="current-password"
                value={emailForm.currentPassword}
                onChange={(currentPassword) => setEmailForm({ ...emailForm, currentPassword })}
              />
              {emailError && <p className="form-error" role="alert">{emailError}</p>}
              <button className="button primary" disabled={savingEmail}>
                {savingEmail ? "Atualizando…" : "Atualizar e-mail"}
              </button>
            </form>
          </article>

          <article className="panel password-panel">
            <div className="panel-header">
              <div><span className="eyebrow">SEGURANÇA</span><h2>Trocar senha</h2></div>
              <span className="security-seal">SESSÕES PROTEGIDAS</span>
            </div>
            <p className="panel-intro">
              Ao trocar a senha, todas as sessões abertas serão encerradas automaticamente.
            </p>
            <form className="form password-form" onSubmit={(event) => void changePassword(event)}>
              <SecureInput
                label="Senha atual"
                autoComplete="current-password"
                value={passwords.current}
                onChange={(current) => setPasswords({ ...passwords, current })}
              />
              <div className="two-fields">
                <SecureInput
                  label="Nova senha"
                  autoComplete="new-password"
                  value={passwords.next}
                  onChange={(next) => setPasswords({ ...passwords, next })}
                />
                <SecureInput
                  label="Confirmar nova senha"
                  autoComplete="new-password"
                  value={passwords.confirm}
                  onChange={(confirm) => setPasswords({ ...passwords, confirm })}
                />
              </div>
              <small className="field-help">
                Use pelo menos 12 caracteres, com maiúscula, minúscula, número e símbolo.
              </small>
              {passwordError && <p className="form-error" role="alert">{passwordError}</p>}
              {passwordSuccess && <Notice tone="success">{passwordSuccess}</Notice>}
              <button className="button primary" disabled={savingPassword}>
                {savingPassword ? "Alterando…" : "Alterar senha"}
              </button>
            </form>
          </article>
        </div>
      </section>

      <section className="panel cloudflare-account-card">
        <div>
          <span className={`connection-light ${provider?.ready ? "online" : ""}`} />
          <span className="eyebrow">CONTA CLOUDFLARE DESTA INSTALAÇÃO</span>
          <h2>{provider?.ready ? provider.accountName || "Conta conectada" : "Conexão ainda não concluída"}</h2>
          <p>
            {provider?.ready
              ? `A KRANO gerencia o Worker ${provider.workerName} sem mostrar tokens no navegador.`
              : "Conecte a conta Cloudflare onde esta instalação foi publicada."}
          </p>
        </div>
        <button className="button secondary" onClick={() => navigate("/integrations/cloudflare")}>
          {provider?.ready ? "Gerenciar conexão" : "Conectar Cloudflare"}
        </button>
      </section>

      <section className="panel installations-panel">
        <div className="panel-header">
          <div><span className="eyebrow">VÁRIAS CONTAS CLOUDFLARE</span><h2>Alternar instalações KRANO</h2></div>
          <span className="local-only-badge">SALVO NESTE NAVEGADOR</span>
        </div>
        <p className="panel-intro">
          Cada conta Cloudflare mantém uma instalação separada. A KRANO salva somente os endereços aqui; senhas e tokens nunca entram no cache local.
        </p>
        <div className="installation-list">
          {installations.map((item) => {
            const isCurrent = item.url === window.location.origin;
            return (
              <article key={item.id}>
                <span className={`installation-status ${isCurrent ? "online" : ""}`} />
                <div><strong>{item.name}</strong><small>{item.url}</small></div>
                {isCurrent
                  ? <span className="status-pill status-active">Atual</span>
                  : (
                    <button
                      className="button secondary compact-button"
                      onClick={() => window.open(item.url, "_blank", "noopener,noreferrer")}
                    >
                      Acessar
                    </button>
                  )}
                {!isCurrent && (
                  <button
                    className="installation-remove"
                    onClick={() => removeInstallation(item)}
                    aria-label={`Remover ${item.name}`}
                  >
                    ×
                  </button>
                )}
              </article>
            );
          })}
        </div>
        <form className="installation-form" onSubmit={addInstallation}>
          <label className="field">
            <span>Nome para identificar</span>
            <input
              required
              minLength={2}
              value={installationName}
              onChange={(event) => setInstallationName(event.target.value)}
              placeholder="Ex.: Conta Cloudflare Agência"
            />
          </label>
          <label className="field">
            <span>Endereço da outra KRANO</span>
            <input
              required
              value={installationUrl}
              onChange={(event) => setInstallationUrl(event.target.value)}
              placeholder="https://krano-sua-conta.workers.dev"
            />
          </label>
          <button className="button primary">Salvar instalação</button>
        </form>
        {installationError && <p className="form-error" role="alert">{installationError}</p>}
      </section>
    </>
  );
}

function SecureInput({
  label,
  autoComplete,
  value,
  onChange
}: {
  label: string;
  autoComplete: "current-password" | "new-password";
  value: string;
  onChange: (value: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="field">
      <span>{label}</span>
      <span className="password-input">
        <input
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          required
          minLength={autoComplete === "new-password" ? 12 : undefined}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className="password-toggle"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? "Ocultar senha" : "Mostrar senha"}
        >
          {visible ? "Ocultar" : "Mostrar"}
        </button>
      </span>
    </label>
  );
}

function persistInstallations(items: SavedInstallation[]) {
  localStorage.setItem(INSTALLATIONS_KEY, JSON.stringify(items));
}

function isSavedInstallation(value: unknown): value is SavedInstallation {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" && typeof item.name === "string" && typeof item.url === "string";
}

function normalizeInstallationUrl(value: string): string {
  const url = new URL(value.trim());
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("Use um endereço HTTPS. HTTP é aceito apenas em localhost.");
  }
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.origin;
}

function roleLabel(role: SessionUser["role"]): string {
  return { owner: "Proprietário", admin: "Administrador", editor: "Editor", analyst: "Analista" }[role];
}

function initials(value: string): string {
  return value.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

function strongPassword(password: string) {
  return password.length >= 12
    && /[A-Z]/.test(password)
    && /[a-z]/.test(password)
    && /\d/.test(password)
    && /[^A-Za-z0-9]/.test(password);
}
