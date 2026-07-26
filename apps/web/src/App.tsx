import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type {
  BootstrapResponse,
  DashboardMetrics,
  SessionUser
} from "../../../packages/shared/src/schemas";
import { api, ApiError } from "./api";

type BootstrapState =
  | { status: "loading" }
  | { status: "ready"; data: BootstrapResponse }
  | { status: "error"; message: string };

const metricIcons = {
  offers: "◫",
  views: "◉",
  visitors: "◎",
  play: "▶",
  retention: "◔",
  pitch: "◆",
  checkout: "↗",
  conversion: "✓"
};

export default function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapState>({ status: "loading" });
  const [path, setPath] = useState(window.location.pathname);

  async function refresh() {
    setBootstrap({ status: "loading" });
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
    const updatePath = () => setPath(window.location.pathname);
    window.addEventListener("popstate", updatePath);
    return () => window.removeEventListener("popstate", updatePath);
  }, []);

  if (bootstrap.status === "loading") return <LoadingScreen />;
  if (bootstrap.status === "error") {
    return (
      <Centered>
        <Brand />
        <div className="notice error">
          <strong>Não foi possível abrir o Funnel Zero</strong>
          <p>{bootstrap.message}</p>
          <button className="button secondary" onClick={() => void refresh()}>
            Tentar novamente
          </button>
        </div>
      </Centered>
    );
  }

  if (path === "/") {
    return (
      <Redirect
        to={
          !bootstrap.data.installed
            ? "/setup"
            : bootstrap.data.user
              ? "/dashboard"
              : "/login"
        }
      />
    );
  }
  if (path === "/setup") {
    return bootstrap.data.installed ? <Redirect to="/login" /> : <SetupPage onComplete={refresh} />;
  }
  if (path === "/login") {
    return bootstrap.data.user ? <Redirect to="/dashboard" /> : <LoginPage onLogin={refresh} />;
  }
  if (path === "/dashboard") {
    return bootstrap.data.user ? (
      <DashboardPage
        user={bootstrap.data.user}
        environment={bootstrap.data.environment}
        onLogout={refresh}
      />
    ) : (
      <Redirect to="/login" />
    );
  }
  return <Redirect to="/" />;
}

function SetupPage({ onComplete }: { onComplete: () => Promise<void> }) {
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: ""
  });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!token) {
      setError("Abra a URL de configuração de uso único gerada pelo instalador.");
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError("As senhas não coincidem.");
      return;
    }
    setSubmitting(true);
    try {
      await api.setup({ token, name: form.name, email: form.email, password: form.password });
      await onComplete();
      go("/dashboard", true);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Falha ao criar o administrador.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      badge="Configuração inicial"
      title="Sua infraestrutura. Suas regras."
      subtitle="Crie o proprietário desta instalação. O link será invalidado assim que você concluir."
    >
      {!token && (
        <div className="notice warning">
          <strong>Link de configuração ausente</strong>
          <p>Execute <code>npm run setup</code> e abra a URL exibida no final.</p>
        </div>
      )}
      <form className="form" onSubmit={(event) => void submit(event)}>
        <Field label="Seu nome">
          <input
            autoComplete="name"
            required
            minLength={2}
            maxLength={120}
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="Como devemos chamar você?"
          />
        </Field>
        <Field label="E-mail administrativo">
          <input
            type="email"
            autoComplete="email"
            required
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
            placeholder="voce@exemplo.com"
          />
        </Field>
        <Field label="Senha forte">
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
            placeholder="12+ caracteres, maiúscula, número e símbolo"
          />
        </Field>
        <Field label="Confirmar senha">
          <input
            type="password"
            autoComplete="new-password"
            required
            value={form.confirmPassword}
            onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })}
          />
        </Field>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button primary full" disabled={submitting || !token}>
          {submitting ? "Criando ambiente…" : "Concluir configuração"}
        </button>
      </form>
      <SecurityNote />
    </AuthLayout>
  );
}

function LoginPage({ onLogin }: { onLogin: () => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await api.login({ email, password });
      await onLogin();
      go("/dashboard", true);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Falha ao entrar.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      badge="Painel autohospedado"
      title="Volte a testar ofertas."
      subtitle="Entre no painel que roda dentro da sua própria conta Cloudflare."
    >
      <form className="form" onSubmit={(event) => void submit(event)}>
        <Field label="E-mail">
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="voce@exemplo.com"
          />
        </Field>
        <Field label="Senha">
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Sua senha"
          />
        </Field>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button primary full" disabled={submitting}>
          {submitting ? "Entrando…" : "Entrar no Funnel Zero"}
        </button>
      </form>
      <SecurityNote />
    </AuthLayout>
  );
}

function DashboardPage({
  user,
  environment,
  onLogout
}: {
  user: SessionUser;
  environment: string;
  onLogout: () => Promise<void>;
}) {
  const [days, setDays] = useState(7);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setMetrics(null);
    api
      .dashboard(days)
      .then((result) => {
        if (active) setMetrics(result.metrics);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : "Falha nas métricas.");
      });
    return () => {
      active = false;
    };
  }, [days]);

  async function logout() {
    await api.logout();
    await onLogout();
    go("/login", true);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <nav className="side-nav" aria-label="Navegação principal">
          <NavItem active icon="⌂" label="Visão geral" />
          <NavItem icon="⇢" label="Funis" soon />
          <NavItem icon="▦" label="Páginas" soon />
          <NavItem icon="▶" label="Mídia e VSL" soon />
          <NavItem icon="◇" label="Domínios" soon />
          <NavItem icon="⚙" label="Configurações" soon />
        </nav>
        <div className="sidebar-bottom">
          <div className="free-badge">
            <span className="status-dot" />
            <div>
              <strong>FREE_ONLY ativo</strong>
              <small>Proteções locais habilitadas</small>
            </div>
          </div>
          <button className="user-card" onClick={() => void logout()} title="Sair">
            <span className="avatar">{initials(user.name)}</span>
            <span>
              <strong>{user.name}</strong>
              <small>{user.email}</small>
            </span>
            <span>↪</span>
          </button>
        </div>
      </aside>

      <main className="dashboard">
        <header className="dashboard-header">
          <div>
            <div className="breadcrumb">Funnel Zero / Visão geral</div>
            <h1>Bom teste, {firstName(user.name)}.</h1>
            <p>Seus sinais principais, sem esconder a infraestrutura.</p>
          </div>
          <div className="header-actions">
            <span className="environment">{environment}</span>
            <button className="button primary" disabled title="Disponível no Marco 2">
              + Criar funil
            </button>
          </div>
        </header>

        <section className="filter-bar" aria-label="Filtros">
          <div className="period-tabs">
            {[1, 7, 30].map((value) => (
              <button
                key={value}
                className={days === value ? "active" : ""}
                onClick={() => setDays(value)}
              >
                {value === 1 ? "Hoje" : `${value} dias`}
              </button>
            ))}
          </div>
          <button className="filter-button" disabled>Oferta: todas</button>
          <button className="filter-button" disabled>Origem: todas</button>
          <button className="filter-button" disabled>UTM: todas</button>
        </section>

        {error && <div className="notice error">{error}</div>}
        {!metrics ? (
          <DashboardSkeleton />
        ) : (
          <>
            <section className="metric-grid" aria-label="Métricas principais">
              <Metric icon={metricIcons.offers} label="Ofertas ativas" value={metrics.activeOffers} />
              <Metric icon={metricIcons.views} label="Visualizações" value={format(metrics.pageViews)} />
              <Metric icon={metricIcons.visitors} label="Visitantes aprox." value={format(metrics.approximateVisitors)} />
              <Metric icon={metricIcons.play} label="Inícios de VSL" value={format(metrics.vslStarts)} />
              <Metric icon={metricIcons.retention} label="Retenção média" value={`${metrics.averageRetention}%`} />
              <Metric icon={metricIcons.pitch} label="Chegaram ao pitch" value={format(metrics.pitchReached)} />
              <Metric icon={metricIcons.checkout} label="Cliques no checkout" value={format(metrics.checkoutClicks)} note={`${metrics.clickThroughRate}% CTR`} />
              <Metric icon={metricIcons.conversion} label="Conversões" value={format(metrics.conversions)} />
            </section>

            <section className="dashboard-columns">
              <article className="panel funnel-panel">
                <div className="panel-header">
                  <div>
                    <span className="eyebrow">FUNIL DE CONVERSÃO</span>
                    <h2>Fluxo do período</h2>
                  </div>
                  <span className="muted">{metrics.periodDays} dias</span>
                </div>
                {metrics.pageViews === 0 ? (
                  <EmptyState
                    icon="⇢"
                    title="Seu primeiro sinal começa no Marco 2"
                    text="A fundação já está registrando e agregando eventos. O construtor visual será conectado sobre esta base."
                  />
                ) : (
                  <div className="mini-funnel">
                    <FunnelStep label="Visualizações" value={metrics.pageViews} width={100} />
                    <FunnelStep label="VSL iniciada" value={metrics.vslStarts} width={74} />
                    <FunnelStep label="Pitch" value={metrics.pitchReached} width={48} />
                    <FunnelStep label="Checkout" value={metrics.checkoutClicks} width={30} />
                  </div>
                )}
              </article>

              <article className="panel capacity-panel">
                <div className="panel-header">
                  <div>
                    <span className="eyebrow">MODO GRATUITO</span>
                    <h2>Capacidade protegida</h2>
                  </div>
                  <span className="status-pill">Ativo</span>
                </div>
                <StorageGauge used={metrics.storageBytes} limit={metrics.storageLimitBytes} />
                <div className="capacity-list">
                  <CapacityLine label="R2 monitorado" value={formatBytes(metrics.storageBytes)} />
                  <CapacityLine label="Limite configurado" value={formatBytes(metrics.storageLimitBytes)} />
                  <CapacityLine label="Leitura do bucket" value={metrics.storageScanComplete ? "Completa" : "Parcial"} />
                  <CapacityLine label="Domínios ativos" value={String(metrics.activeDomains)} />
                </div>
                <p className="capacity-note">
                  O Funnel Zero avisa em 70%, 85% e 95%. Isso é uma proteção do aplicativo, não um hard cap de cobrança da Cloudflare.
                </p>
              </article>
            </section>

            <section className="panel readiness">
              <div>
                <span className="eyebrow">MARCO 1 CONCLUÍDO</span>
                <h2>Fundação pronta para construir</h2>
                <p>Worker, banco, mídia, autenticação e observabilidade estão conectados.</p>
              </div>
              <div className="readiness-items">
                <Readiness label="D1" detail="Schema versionado" />
                <Readiness label="R2" detail="Bucket privado" />
                <Readiness label="Auth" detail="Cookie HttpOnly" />
                <Readiness label="Free" detail="FREE_ONLY" />
              </div>
            </section>
          </>
        )}
      </main>
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
          <h1>Teste ofertas,<br /><em>não ferramentas.</em></h1>
          <p>Seu painel, seus dados e sua infraestrutura. Sem mensalidade obrigatória.</p>
        </div>
        <div className="infra-row">
          <span>Workers</span><span>D1</span><span>R2</span><span>MIT</span>
        </div>
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

function Brand() {
  return (
    <div className="brand" aria-label="Funnel Zero">
      <span className="brand-mark"><i /><i /></span>
      <span>Funnel <strong>Zero</strong></span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function SecurityNote() {
  return (
    <p className="security-note">
      <span>⌾</span>
      Sua sessão fica em cookie HttpOnly. Nenhuma senha é armazenada em texto aberto.
    </p>
  );
}

function NavItem({
  icon,
  label,
  active,
  soon
}: {
  icon: string;
  label: string;
  active?: boolean;
  soon?: boolean;
}) {
  return (
    <button className={`nav-item ${active ? "active" : ""}`} disabled={!active}>
      <span>{icon}</span><span>{label}</span>{soon && <small>em breve</small>}
    </button>
  );
}

function Metric({
  icon,
  label,
  value,
  note
}: {
  icon: string;
  label: string;
  value: string | number;
  note?: string;
}) {
  return (
    <article className="metric-card">
      <div className="metric-top"><span className="metric-icon">{icon}</span><span>—</span></div>
      <span className="metric-label">{label}</span>
      <strong>{value}</strong>
      <small>{note ?? "Sem comparação anterior"}</small>
    </article>
  );
}

function EmptyState({ icon, title, text }: { icon: string; title: string; text: string }) {
  return (
    <div className="empty-state"><span>{icon}</span><strong>{title}</strong><p>{text}</p></div>
  );
}

function FunnelStep({ label, value, width }: { label: string; value: number; width: number }) {
  return (
    <div className="funnel-step" style={{ width: `${width}%` }}>
      <span>{label}</span><strong>{format(value)}</strong>
    </div>
  );
}

function StorageGauge({ used, limit }: { used: number; limit: number }) {
  const percent = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
  return (
    <div className="storage-gauge">
      <div className="gauge-label"><strong>{percent.toFixed(1)}%</strong><span>utilizado</span></div>
      <div className="gauge-track"><i style={{ width: `${percent}%` }} /></div>
      <div className="gauge-scale"><span>0</span><span>70%</span><span>85%</span><span>95%</span></div>
    </div>
  );
}

function CapacityLine({ label, value }: { label: string; value: string }) {
  return <div className="capacity-line"><span>{label}</span><strong>{value}</strong></div>;
}

function Readiness({ label, detail }: { label: string; detail: string }) {
  return <div className="readiness-item"><span>✓</span><div><strong>{label}</strong><small>{detail}</small></div></div>;
}

function DashboardSkeleton() {
  return <div className="metric-grid">{Array.from({ length: 8 }, (_, index) => <div className="metric-card skeleton" key={index} />)}</div>;
}

function LoadingScreen() {
  return <Centered><Brand /><div className="loader" /><p className="muted">Conectando à sua instalação…</p></Centered>;
}

function Centered({ children }: { children: ReactNode }) {
  return <main className="centered">{children}</main>;
}

function Redirect({ to }: { to: string }) {
  useEffect(() => {
    go(to, true);
  }, [to]);
  return <LoadingScreen />;
}

function go(path: string, replace = false) {
  if (replace) window.history.replaceState({}, "", path);
  else window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function format(value: number) {
  return new Intl.NumberFormat("pt-BR").format(value);
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] ?? name;
}
