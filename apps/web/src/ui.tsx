/* eslint-disable react-refresh/only-export-components */
import type { ReactNode } from "react";
import type { SessionUser } from "../../../packages/shared/src/schemas";

export function navigate(to: string, replace = false) {
  window.history[replace ? "replaceState" : "pushState"]({}, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function Brand() {
  return (
    <div className="brand" aria-label="KRANO">
      <span className="brand-mark" aria-hidden="true"><i /><i /></span>
      <span>KRANO</span>
    </div>
  );
}

interface NavigationItem {
  href: string;
  icon: string;
  label: string;
  badge?: string;
  match?: string[];
  mobile?: boolean;
}

interface NavigationGroup {
  label: string;
  items: NavigationItem[];
}

const navigation: NavigationGroup[] = [
  {
    label: "Principal",
    items: [{ href: "/home", icon: "⌂", label: "Início", mobile: true }]
  },
  {
    label: "Integrações",
    items: [
      {
        href: "/integrations/cloudflare",
        icon: "☁",
        label: "Cloudflare",
        match: ["/integrations", "/domains", "/hosting", "/media-library"],
        mobile: true
      },
      { href: "/domains", icon: "◇", label: "Domínios" },
      { href: "/hosting", icon: "▦", label: "Hospedagem" },
      { href: "/media-library", icon: "▣", label: "Gerenciador" }
    ]
  },
  {
    label: "KRATUBE",
    items: [
      {
        href: "/kratube",
        icon: "▶",
        label: "Vídeos e player",
        match: ["/kratube", "/player"],
        mobile: true
      }
    ]
  },
  {
    label: "Ofertas",
    items: [
      {
        href: "/studio",
        icon: "⇢",
        label: "Ofertas e funis",
        match: ["/studio", "/offers", "/funnels", "/tracking"],
        mobile: true
      },
      { href: "/pages", icon: "▤", label: "Criador de sites", badge: "depois" }
    ]
  },
  {
    label: "Biblioteca",
    items: [{ href: "/studies", icon: "▱", label: "Estudos", badge: "depois" }]
  },
  {
    label: "Análise",
    items: [{ href: "/dashboard", icon: "⌁", label: "Dashboards", badge: "básico", mobile: true }]
  }
];

function itemIsActive(item: NavigationItem, path: string): boolean {
  const candidates = item.match ?? [item.href];
  return candidates.some((candidate) => path === candidate || path.startsWith(`${candidate}/`));
}

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
          {navigation.map((group) => (
            <section className="nav-group" key={group.label}>
              <small>{group.label}</small>
              {group.items.map((item) => (
                <button
                  key={item.href}
                  className={`nav-item ${item.mobile ? "nav-mobile" : ""} ${itemIsActive(item, path) ? "active" : ""}`}
                  onClick={() => navigate(item.href)}
                >
                  <span aria-hidden="true">{item.icon}</span>
                  <span>{item.label}</span>
                  {item.badge && <i>{item.badge}</i>}
                </button>
              ))}
            </section>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="free-badge">
            <span className="status-dot" />
            <div><strong>Plano gratuito protegido</strong><small>Limites monitorados pela KRANO</small></div>
          </div>
          <button className={`user-card ${path === "/account" ? "active" : ""}`} onClick={() => navigate("/account")}>
            <span className="avatar">{initials(user.name)}</span>
            <span><strong>{user.name}</strong><small>Conta e conexões</small></span>
            <span>›</span>
          </button>
          <button className="logout-link" onClick={() => void onLogout()}>Sair com segurança</button>
        </div>
      </aside>
      <main className="dashboard">
        <div className="mobile-top">
          <Brand />
          <button className="mobile-account" onClick={() => navigate("/account")}>
            <span className="avatar">{initials(user.name)}</span>
          </button>
        </div>
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
        <div className="breadcrumb">KRANO / {eyebrow}</div>
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
