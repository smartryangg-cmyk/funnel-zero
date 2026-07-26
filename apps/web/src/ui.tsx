/* eslint-disable react-refresh/only-export-components */
import type { ReactNode } from "react";
import type { SessionUser } from "../../../packages/shared/src/schemas";

export function navigate(to: string, replace = false) {
  window.history[replace ? "replaceState" : "pushState"]({}, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function Brand() {
  return (
    <div className="brand" aria-label="Funnel Zero">
      <span className="brand-mark"><i /><i /></span>
      <span>Funnel <strong>Zero</strong></span>
    </div>
  );
}

const items = [
  { href: "/dashboard", icon: "⌂", label: "Visão geral" },
  { href: "/offers", icon: "◫", label: "Ofertas" },
  { href: "/funnels", icon: "⇢", label: "Funis" },
  { href: "/pages", icon: "▦", label: "Páginas" },
  { href: "/media-library", icon: "▶", label: "Mídia e VSL" },
  { href: "/domains", icon: "◇", label: "Domínios" },
  { href: "/settings", icon: "⚙", label: "Configurações" }
];

export function AppShell({
  user,
  environment,
  path,
  onLogout,
  children
}: {
  user: SessionUser;
  environment: string;
  path: string;
  onLogout: () => Promise<void>;
  children: ReactNode;
}) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <nav className="side-nav" aria-label="Navegação principal">
          {items.map((item) => (
            <button
              key={item.href}
              className={`nav-item ${path === item.href || path.startsWith(`${item.href}/`) ? "active" : ""}`}
              onClick={() => navigate(item.href)}
            >
              <span>{item.icon}</span><span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="free-badge">
            <span className="status-dot" />
            <div><strong>FREE_ONLY ativo</strong><small>Proteções locais habilitadas</small></div>
          </div>
          <button className="user-card" onClick={() => void onLogout()} title="Sair">
            <span className="avatar">{initials(user.name)}</span>
            <span><strong>{user.name}</strong><small>{user.email}</small></span>
            <span>↪</span>
          </button>
        </div>
      </aside>
      <main className="dashboard">
        <div className="mobile-top"><Brand /><button onClick={() => void onLogout()}>Sair</button></div>
        <div className="environment mobile-env">{environment}</div>
        {children}
      </main>
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  actions?: ReactNode;
}) {
  return (
    <header className="dashboard-header">
      <div>
        <div className="breadcrumb">Funnel Zero / {eyebrow}</div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {actions && <div className="header-actions">{actions}</div>}
    </header>
  );
}

export function StatusPill({ status }: { status: string }) {
  const labels: Record<string, string> = {
    active: "Ativa",
    published: "Publicado",
    draft: "Rascunho",
    archived: "Arquivado",
    ready: "Pronto",
    uploading: "Enviando",
    failed: "Falhou",
    running: "Rodando",
    paused: "Pausado",
    completed: "Concluído",
    pending: "Pendente",
    validating: "Validando"
  };
  return <span className={`status-pill status-${status}`}>{labels[status] ?? status}</span>;
}

export function Empty({
  icon,
  title,
  text,
  action
}: {
  icon: string;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span>{icon}</span><strong>{title}</strong><p>{text}</p>{action}
    </div>
  );
}

export function Notice({
  children,
  tone = "warning"
}: {
  children: ReactNode;
  tone?: "warning" | "error" | "success";
}) {
  return <div className={`notice ${tone}`}>{children}</div>;
}

export function Modal({
  title,
  children,
  onClose
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <header><h2>{title}</h2><button onClick={onClose} aria-label="Fechar">×</button></header>
        {children}
      </section>
    </div>
  );
}

export function format(value: number) {
  return new Intl.NumberFormat("pt-BR").format(value);
}

export function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

export function firstName(value: string) {
  return value.trim().split(/\s+/)[0] || "por aí";
}

function initials(value: string) {
  return value
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}
