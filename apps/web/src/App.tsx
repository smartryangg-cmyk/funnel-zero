import {
  Suspense,
  lazy,
  useEffect,
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

type BootstrapState =
  | { status: "loading" }
  | { status: "ready"; data: BootstrapResponse }
  | { status: "error"; message: string };

export default function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapState>({ status: "loading" });
  const [path, setPath] = useState(window.location.pathname);

  async function refresh() {
    try {
      setBootstrap({ status: "ready", data: await api.bootstrap() });
    } catch (error) {
      setBootstrap({ status: "error", message: error instanceof Error ? error.message : "Falha ao carregar a instalação." });
    }
  }
  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    const update = () => setPath(window.location.pathname);
    addEventListener("popstate", update);
    return () => removeEventListener("popstate", update);
  }, []);

  if (bootstrap.status === "loading") return <Loading />;
  if (bootstrap.status === "error") return <Centered><Brand /><div className="notice error"><strong>Não foi possível abrir a KRANO</strong><p>{bootstrap.message}</p><button className="button secondary" onClick={() => void refresh()}>Tentar novamente</button></div></Centered>;
  if (path === "/") return <Redirect to={!bootstrap.data.installed ? "/setup" : bootstrap.data.user ? "/home" : "/login"} />;
  if (path === "/setup") return bootstrap.data.installed ? <Redirect to="/login" /> : <Setup onComplete={refresh} />;
  if (path === "/login") return bootstrap.data.user ? <Redirect to="/home" /> : <Login onComplete={refresh} />;
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
  else if (path === "/media-library") content = <MediaLibrary />;
  else if (path === "/tracking") content = <PixelCenter />;
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
    <AppShell user={bootstrap.data.user} environment={bootstrap.data.environment} path={path} onLogout={logout}>
      <Suspense fallback={<FeatureLoading />}>{content}</Suspense>
    </AppShell>
  );
}

function Setup({ onComplete }: { onComplete: () => Promise<void> }) {
  const token = new URLSearchParams(location.search).get("token") ?? "";
  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (form.password !== form.confirm) return setError("As senhas não coincidem.");
    setSaving(true);
    try {
      await api.setup({ token, name: form.name, email: form.email, password: form.password });
      await onComplete();
      navigate("/home", true);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Falha ao configurar.");
    } finally { setSaving(false); }
  }
  return (
    <AuthLayout badge="Configuração inicial" title="Sua infraestrutura. Suas regras." subtitle="Crie o proprietário desta instalação. O link de uso único será invalidado.">
      {!token && <div className="notice warning">Execute <code>npm run setup</code> e abra a URL gerada.</div>}
      <form className="form" onSubmit={(event) => void submit(event)}>
        <Field label="Seu nome"><input required minLength={2} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
        <Field label="E-mail administrativo"><input type="email" required value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></Field>
        <Field label="Senha forte"><input type="password" required minLength={12} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></Field>
        <Field label="Confirmar senha"><input type="password" required value={form.confirm} onChange={(event) => setForm({ ...form, confirm: event.target.value })} /></Field>
        {error && <p className="form-error">{error}</p>}
        <button className="button primary full" disabled={!token || saving}>{saving ? "Criando…" : "Concluir configuração"}</button>
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
      await api.login({ email, password });
      await onComplete();
      navigate("/home", true);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Falha ao entrar.");
    } finally { setSaving(false); }
  }
  return (
    <AuthLayout badge="Painel autohospedado" title="Volte a testar ofertas." subtitle="Entre no painel que roda dentro da sua própria conta Cloudflare.">
      <form className="form" onSubmit={(event) => void submit(event)}>
        <Field label="E-mail"><input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
        <Field label="Senha"><input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
        {error && <p className="form-error">{error}</p>}
        <button className="button primary full" disabled={saving}>{saving ? "Entrando…" : "Entrar na KRANO"}</button>
      </form>
      <Security />
    </AuthLayout>
  );
}

function AuthLayout({ badge, title, subtitle, children }: { badge: string; title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="auth-page">
      <section className="auth-brand"><Brand /><div className="brand-message"><span className="eyebrow">OPEN SOURCE • CLOUDFLARE</span><h1>Teste ofertas,<br /><em>não ferramentas.</em></h1><p>Seu painel, seus dados e sua infraestrutura.</p></div><div className="infra-row"><span>Workers</span><span>D1</span><span>R2</span><span>MIT</span></div></section>
      <main className="auth-main"><div className="auth-card"><span className="auth-badge">{badge}</span><h2>{title}</h2><p className="auth-subtitle">{subtitle}</p>{children}</div></main>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}
function Security() {
  return <p className="security-note"><span>⌾</span>Sessão HttpOnly, senha derivada e dados na sua conta.</p>;
}
function Loading() {
  return <Centered><Brand /><div className="loader" /><p className="muted">Conectando à sua instalação…</p></Centered>;
}
function FeatureLoading() {
  return <div className="feature-loading"><div className="loader" /><span>Carregando ferramenta…</span></div>;
}
function Centered({ children }: { children: ReactNode }) {
  return <main className="centered">{children}</main>;
}
function Redirect({ to }: { to: string }) {
  useEffect(() => { navigate(to, true); }, [to]);
  return <Loading />;
}
