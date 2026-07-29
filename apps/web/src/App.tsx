import {
  Suspense,
  lazy,
  useEffect,
  useId,
  useState,
  type FormEvent,
  type ReactNode
} from "react";
import type { BootstrapResponse } from "../../../packages/shared/src/schemas";
import { api, ApiError } from "./api";
import { Dashboard } from "./Dashboard";
import { Home } from "./Home";
import { AppShell, Brand, navigate } from "./ui";

const Account = lazy(() => import("./Account").then((module) => ({ default: module.Account })));
const CloudflareCenter = lazy(() => import("./Integrations").then((module) => ({ default: module.CloudflareCenter })));
const Domains = lazy(() => import("./CloudflareDomains").then((module) => ({ default: module.Domains })));
const Subdomains = lazy(() => import("./CloudflareDomains").then((module) => ({ default: module.Subdomains })));
const Settings = lazy(() => import("./AdminSettings").then((module) => ({ default: module.Settings })));
const Funnels = lazy(() => import("./Funnels").then((module) => ({ default: module.Funnels })));
const Hosting = lazy(() => import("./Hosting").then((module) => ({ default: module.Hosting })));
const MediaLibrary = lazy(() => import("./Media").then((module) => ({ default: module.MediaLibrary })));
const OfferStudio = lazy(() => import("./OfferStudio").then((module) => ({ default: module.OfferStudio })));
const Offers = lazy(() => import("./Offers").then((module) => ({ default: module.Offers })));
const Pages = lazy(() => import("./Pages").then((module) => ({ default: module.Pages })));
const PixelCenter = lazy(() => import("./PixelCenter").then((module) => ({ default: module.PixelCenter })));
const PlayerStudio = lazy(() => import("./PlayerStudio").then((module) => ({ default: module.PlayerStudio })));
const Studies = lazy(() => import("./Studies").then((module) => ({ default: module.Studies })));
const MetaAds = lazy(() => import("./MetaAds").then((module) => ({ default: module.MetaAds })));

type BootstrapState =
  | { status: "loading" }
  | { status: "ready"; data: BootstrapResponse }
  | { status: "error"; message: string };

export default function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapState>({ status: "loading" });
  const [locationKey, setLocationKey] = useState(readLocationKey);
  const path = window.location.pathname;

  async function refresh() {
    try {
      setBootstrap({ status: "ready", data: await api.bootstrap() });
    } catch (error) {
      setBootstrap({
        status: "error",
        message: error instanceof Error ? error.message : "Falha ao carregar a instalação."
      });
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    const update = () => setLocationKey(readLocationKey());
    addEventListener("popstate", update);
    return () => removeEventListener("popstate", update);
  }, []);

  useEffect(() => {
    document.title = `${routeTitle(path)} · KRANO`;
  }, [locationKey, path]);

  if (bootstrap.status === "loading") return <Loading />;
  if (bootstrap.status === "error") {
    return (
      <Centered>
        <Brand />
        <div className="notice error">
          <strong>Não foi possível abrir a KRANO</strong>
          <p>{bootstrap.message}</p>
          <button className="button secondary" onClick={() => void refresh()}>Tentar novamente</button>
        </div>
      </Centered>
    );
  }

  if (path === "/") {
    return <Redirect to={!bootstrap.data.installed ? "/setup" : bootstrap.data.user ? "/home" : "/login"} />;
  }
  if (path === "/setup") {
    return bootstrap.data.installed ? <Redirect to="/login" /> : <Setup onComplete={refresh} />;
  }
  if (path === "/login") {
    return bootstrap.data.user ? <Redirect to="/home" /> : <Login onComplete={refresh} />;
  }
  if (path === "/recover") {
    return bootstrap.data.user ? <Redirect to="/account" /> : <RecoverAccess />;
  }
  if (path === "/reset-password") {
    return bootstrap.data.user ? <Redirect to="/account" /> : <ResetPassword onComplete={refresh} />;
  }
  if (!bootstrap.data.user) return <Redirect to="/login" />;

  const funnelMatch = path.match(/^\/funnels\/([^/]+)$/);
  const editorMatch = path.match(/^\/pages\/([^/]+)\/edit$/);
  let content: ReactNode;
  if (path === "/home") content = <Home user={bootstrap.data.user} />;
  else if (path === "/integrations" || path === "/integrations/cloudflare") content = <CloudflareCenter />;
  else if (path === "/account") content = <Account user={bootstrap.data.user} onPasswordChanged={refresh} />;
  else if (path === "/dashboard") content = <Dashboard user={bootstrap.data.user} />;
  else if (path === "/hosting") content = <Hosting />;
  else if (path === "/kratube") content = <PlayerStudio />;
  else if (path === "/player") content = <Redirect to="/kratube" />;
  else if (path === "/studio") content = <OfferStudio />;
  else if (path === "/offers") content = <Offers />;
  else if (path === "/funnels") content = <Funnels />;
  else if (funnelMatch) content = <Funnels selectedId={funnelMatch[1]} />;
  else if (path === "/pages") content = <Pages />;
  else if (editorMatch) content = <Pages editorId={editorMatch[1]} />;
  else if (path === "/media-library") content = <MediaLibrary mediaEnabled={bootstrap.data.mediaEnabled} />;
  else if (path === "/tracking") content = <PixelCenter />;
  else if (path === "/meta-ads") content = <MetaAds />;
  else if (path === "/domains") content = <Domains />;
  else if (path === "/subdomains") content = <Subdomains />;
  else if (path === "/studies") content = <Studies />;
  else if (path === "/settings") content = <Settings />;
  else return <Redirect to="/home" />;

  async function logout() {
    await api.logout();
    await refresh();
    navigate("/login", true);
  }

  return (
    <AppShell
      user={bootstrap.data.user}
      environment={bootstrap.data.environment}
      path={path}
      onLogout={logout}
    >
      <Suspense fallback={<FeatureLoading />}>{content}</Suspense>
    </AppShell>
  );
}

function Setup({ onComplete }: { onComplete: () => Promise<void> }) {
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const passwordReady = passwordStrength(form.password).every(Boolean);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!passwordReady) return setError("Complete todos os requisitos de segurança da senha.");
    if (form.password !== form.confirm) return setError("As senhas não coincidem.");
    setSaving(true);
    try {
      await api.setup({
        token,
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password
      });
      await onComplete();
      navigate("/home", true);
    } catch (caught) {
      setError(apiErrorMessage(caught, "Não foi possível concluir a configuração."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AuthLayout
      badge="Configuração inicial"
      title="Prepare sua central de comando."
      subtitle="Crie o proprietário desta instalação. O link de configuração é usado uma única vez."
    >
      {!token && (
        <div className="notice warning">
          Este link não contém a chave de configuração. Abra novamente a URL entregue pelo instalador.
        </div>
      )}
      <form className="form auth-form" onSubmit={(event) => void submit(event)}>
        <Field label="Seu nome">
          <input
            required
            minLength={2}
            autoComplete="name"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </Field>
        <Field label="E-mail administrativo">
          <input
            type="email"
            required
            autoComplete="email"
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
          />
        </Field>
        <PasswordField
          label="Crie uma senha forte"
          autoComplete="new-password"
          value={form.password}
          onChange={(password) => setForm({ ...form, password })}
        />
        <PasswordChecklist password={form.password} />
        <PasswordField
          label="Confirme a senha"
          autoComplete="new-password"
          value={form.confirm}
          onChange={(confirm) => setForm({ ...form, confirm })}
        />
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button primary full" disabled={!token || saving}>
          {saving ? "Criando sua KRANO…" : "Concluir configuração"}
        </button>
      </form>
      <Security />
    </AuthLayout>
  );
}

function Login({ onComplete }: { onComplete: () => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.login({ email: email.trim(), password });
      await onComplete();
      navigate("/home", true);
    } catch (caught) {
      setError(apiErrorMessage(caught, "Não foi possível entrar."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AuthLayout
      badge="Acesso seguro"
      title="Entre na sua central."
      subtitle="Gerencie ofertas, páginas, vídeos, domínios e métricas em um só lugar."
    >
      <form className="form auth-form" onSubmit={(event) => void submit(event)}>
        <Field label="E-mail">
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <PasswordField
          label="Senha"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
        />
        <div className="auth-form-links">
          <button type="button" className="text-button" onClick={() => navigate("/recover")}>
            Esqueci minha senha
          </button>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button primary full" disabled={saving}>
          {saving ? "Entrando…" : "Entrar na KRANO"}
        </button>
      </form>
      <Security />
    </AuthLayout>
  );
}

function RecoverAccess() {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  function continueRecovery(event: FormEvent) {
    event.preventDefault();
    setError("");
    const token = extractRecoveryToken(value);
    if (!token) {
      setError("Cole o link completo ou o código de recuperação gerado pelo instalador.");
      return;
    }
    navigate(`/reset-password?token=${encodeURIComponent(token)}`);
  }

  return (
    <AuthLayout
      badge="Recuperação de acesso"
      title="Redefina sem depender de e-mail."
      subtitle="Como a KRANO roda na sua própria Cloudflare, a recuperação é feita por uma chave segura criada pelo instalador."
    >
      <div className="recovery-steps">
        <span>1</span>
        <p>Abra o instalador da KRANO e escolha <strong>Recuperar acesso</strong>.</p>
        <span>2</span>
        <p>O instalador abrirá um link temporário neste navegador.</p>
      </div>
      <form className="form auth-form" onSubmit={continueRecovery}>
        <Field label="Link ou código de recuperação">
          <input
            required
            autoComplete="off"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Cole aqui se o navegador não abriu automaticamente"
          />
        </Field>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button primary full">Continuar</button>
        <button type="button" className="button secondary full" onClick={() => navigate("/login")}>
          Voltar ao login
        </button>
      </form>
    </AuthLayout>
  );
}

function ResetPassword({ onComplete }: { onComplete: () => Promise<void> }) {
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const ready = passwordStrength(password).every(Boolean);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!token) return setError("O link de recuperação está incompleto.");
    if (!ready) return setError("Complete todos os requisitos de segurança da senha.");
    if (password !== confirm) return setError("As senhas não coincidem.");
    setSaving(true);
    try {
      await api.completeRecovery({ token, password });
      await onComplete();
      navigate("/login", true);
    } catch (caught) {
      setError(apiErrorMessage(caught, "Não foi possível redefinir a senha."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AuthLayout
      badge="Nova senha"
      title="Crie uma nova senha."
      subtitle="Ao concluir, todas as sessões antigas serão encerradas."
    >
      <form className="form auth-form" onSubmit={(event) => void submit(event)}>
        <PasswordField
          label="Nova senha"
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
        />
        <PasswordChecklist password={password} />
        <PasswordField
          label="Confirme a nova senha"
          autoComplete="new-password"
          value={confirm}
          onChange={setConfirm}
        />
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button primary full" disabled={!token || saving}>
          {saving ? "Redefinindo…" : "Salvar nova senha"}
        </button>
      </form>
    </AuthLayout>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  autoComplete
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
}) {
  const [visible, setVisible] = useState(false);
  const inputId = useId();
  return (
    <div className="field password-field">
      <label htmlFor={inputId}>{label}</label>
      <span className="password-input">
        <input
          id={inputId}
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
    </div>
  );
}

function PasswordChecklist({ password }: { password: string }) {
  const checks = passwordStrength(password);
  const requirements = [
    "12 ou mais caracteres",
    "Letra maiúscula",
    "Letra minúscula",
    "Número",
    "Símbolo"
  ];
  return (
    <div className="password-checklist" aria-label="Requisitos da senha">
      {requirements.map((requirement, index) => (
        <span className={checks[index] ? "valid" : ""} key={requirement}>
          <i aria-hidden="true">{checks[index] ? "✓" : "·"}</i>{requirement}
        </span>
      ))}
    </div>
  );
}

function AuthLayout({
  badge,
  title,
  subtitle,
  children
}: {
  badge: string;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="auth-page">
      <section className="auth-brand">
        <Brand />
        <div className="brand-message">
          <span className="eyebrow">OPEN SOURCE • CLOUDFLARE</span>
          <h1>Seu digital em<br /><em>uma central.</em></h1>
          <p>Infraestrutura, conversão e dados sob o seu controle.</p>
        </div>
        <div className="infra-row"><span>Workers</span><span>D1</span><span>R2</span><span>MIT</span></div>
      </section>
      <main className="auth-main">
        <div className="auth-card">
          <span className="auth-badge">{badge}</span>
          <h2>{title}</h2>
          <p className="auth-subtitle">{subtitle}</p>
          {children}
        </div>
      </main>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function Security() {
  return <p className="security-note"><span>⌾</span>Sessão HttpOnly, senha protegida e dados na sua conta.</p>;
}

function Loading() {
  return (
    <Centered>
      <Brand />
      <div className="loader" />
      <p className="muted">Conectando à sua instalação…</p>
    </Centered>
  );
}

function FeatureLoading() {
  return <div className="feature-loading"><div className="loader" /><span>Carregando ferramenta…</span></div>;
}

function Centered({ children }: { children: ReactNode }) {
  return <main className="centered">{children}</main>;
}

function Redirect({ to }: { to: string }) {
  useEffect(() => {
    navigate(to, true);
  }, [to]);
  return <Loading />;
}

function readLocationKey() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function routeTitle(path: string) {
  if (path === "/") return "Carregando";
  if (path === "/setup") return "Configuração";
  if (path === "/login") return "Entrar";
  if (path === "/recover" || path === "/reset-password") return "Recuperar acesso";
  if (path === "/home") return "Central de comando";
  if (path.startsWith("/funnels")) return "Funis";
  if (path.startsWith("/pages")) return "Construtor de páginas";
  if (path === "/kratube") return "KRATUBE";
  if (path === "/dashboard") return "Dashboards";
  if (path === "/account") return "Conta";
  if (path === "/tracking") return "Rastreamento";
  if (path === "/meta-ads") return "Meta Ads";
  if (path === "/domains") return "Domínios";
  if (path === "/subdomains") return "Subdomínios";
  return "Central de comando";
}

function passwordStrength(password: string) {
  return [
    password.length >= 12,
    /[A-Z]/.test(password),
    /[a-z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password)
  ];
}

function apiErrorMessage(caught: unknown, fallback: string) {
  if (!(caught instanceof ApiError)) return fallback;
  if (caught.status === 429) return `${caught.message} Aguarde alguns instantes e tente novamente.`;
  return caught.message;
}

function extractRecoveryToken(value: string) {
  const normalized = value.trim();
  if (!normalized) return "";
  try {
    const url = new URL(normalized);
    return url.searchParams.get("token") ?? "";
  } catch {
    return /^[A-Za-z0-9_-]{24,}$/.test(normalized) ? normalized : "";
  }
}
