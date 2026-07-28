/* eslint-disable react-refresh/only-export-components */
import { useEffect, useState, type ReactNode } from "react";
import type { SessionUser } from "../../../packages/shared/src/schemas";

export function navigate(to: string, replace = false) {
  window.history[replace ? "replaceState" : "pushState"]({}, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function Brand() {
  return (
    <div className="brand" aria-label="KRANO">
      <span className="brand-mark" aria-hidden="true"><i /><i /></span>
      <span className="brand-word">KRANO</span>
      <small className="brand-version">v0.4</small>
    </div>
  );
}

interface NavigationItem {
  href: string;
  icon: IconName;
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
    label: "Central",
    items: [{ href: "/home", icon: "home", label: "Visão geral", mobile: true }]
  },
  {
    label: "Criar",
    items: [
      {
        href: "/studio",
        icon: "funnel",
        label: "Funis e ofertas",
        match: ["/studio", "/offers", "/funnels"],
        mobile: true
      },
      { href: "/pages", icon: "layout", label: "Páginas e sites" }
    ]
  },
  {
    label: "Publicar",
    items: [
      {
        href: "/kratube",
        icon: "play",
        label: "Vídeos e player",
        match: ["/kratube", "/player"],
        mobile: true
      },
      { href: "/hosting", icon: "server", label: "Hospedagem" },
      { href: "/media-library", icon: "folder", label: "Arquivos" }
    ]
  },
  {
    label: "Medir",
    items: [
      { href: "/dashboard", icon: "chart", label: "Analytics", mobile: true },
      { href: "/tracking", icon: "target", label: "Pixels e eventos" },
      { href: "/meta-ads", icon: "ads", label: "Meta Ads" }
    ]
  },
  {
    label: "Configurar",
    items: [
      {
        href: "/integrations/cloudflare",
        icon: "cloud",
        label: "Conexões",
        match: ["/integrations", "/integrations/cloudflare"]
      },
      { href: "/domains", icon: "globe", label: "Domínios", match: ["/domains", "/subdomains"] },
      { href: "/settings", icon: "book", label: "Configurações" }
    ]
  }
];

const SIDEBAR_STATE_KEY = "krano:sidebar-collapsed";
const THEME_STATE_KEY = "krano:theme";
const THEME_CHANGE_EVENT = "krano:theme-change";
type Theme = "light" | "dark";

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_STATE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // Usa a preferência do sistema quando o armazenamento estiver bloqueado.
  }
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function AppearanceSettings() {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  function chooseTheme(next: Theme) {
    setTheme(next);
    window.dispatchEvent(new CustomEvent<Theme>(THEME_CHANGE_EVENT, { detail: next }));
  }

  useEffect(() => {
    const sync = (event: Event) => setTheme((event as CustomEvent<Theme>).detail);
    window.addEventListener(THEME_CHANGE_EVENT, sync);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, sync);
  }, []);

  return (
    <section className="panel appearance-settings" aria-labelledby="appearance-title">
      <div>
        <span className="eyebrow">APARÊNCIA</span>
        <h2 id="appearance-title">Tema da plataforma</h2>
        <p>Escolha claro ou escuro. A preferência fica salva neste navegador.</p>
      </div>
      <div className="appearance-options" role="group" aria-label="Escolher tema">
        <button type="button" className={theme === "light" ? "active" : ""} aria-pressed={theme === "light"} onClick={() => chooseTheme("light")}>
          <span aria-hidden="true">☀</span><strong>Claro</strong><small>Mais luminoso</small>
        </button>
        <button type="button" className={theme === "dark" ? "active" : ""} aria-pressed={theme === "dark"} onClick={() => chooseTheme("dark")}>
          <span aria-hidden="true">☾</span><strong>Escuro</strong><small>Menos brilho</small>
        </button>
      </div>
    </section>
  );
}

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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_STATE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try {
      localStorage.setItem(THEME_STATE_KEY, theme);
    } catch {
      // O tema ainda funciona durante esta sessão.
    }
  }, [theme]);

  useEffect(() => {
    const updateTheme = (event: Event) => setTheme((event as CustomEvent<Theme>).detail);
    window.addEventListener(THEME_CHANGE_EVENT, updateTheme);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, updateTheme);
  }, []);

  function toggleSidebar() {
    setSidebarCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem(SIDEBAR_STATE_KEY, String(next));
      } catch {
        // A navegação continua funcional quando o armazenamento estiver bloqueado.
      }
      return next;
    });
  }

  return (
    <div className={`app-shell ${sidebarCollapsed ? "sidebar-is-collapsed" : ""}`}>
      <aside className="sidebar" aria-label="Menu principal">
        <Brand />
        <div className="sidebar-context">
          <span className="sidebar-context-orb" aria-hidden="true"><i /></span>
          <span><small>Workspace</small><strong>Operação principal</strong></span>
        </div>
        <button
          type="button"
          className="sidebar-toggle"
          aria-label={sidebarCollapsed ? "Mostrar menu lateral" : "Esconder menu lateral"}
          aria-expanded={!sidebarCollapsed}
          title={sidebarCollapsed ? "Mostrar menu" : "Esconder menu"}
          onClick={toggleSidebar}
        >
          <span aria-hidden="true">{sidebarCollapsed ? "›" : "‹"}</span>
        </button>
        <nav className="side-nav" aria-label="Navegação principal">
          {navigation.map((group) => (
            <section className="nav-group" key={group.label}>
              <small>{group.label}</small>
              {group.items.map((item) => (
                <button
                  key={item.href}
                  className={`nav-item ${item.mobile ? "nav-mobile" : ""} ${itemIsActive(item, path) ? "active" : ""}`}
                  title={sidebarCollapsed ? item.label : undefined}
                  aria-label={item.label}
                  onClick={() => navigate(item.href)}
                >
                   <span className="nav-icon" aria-hidden="true"><Icon name={item.icon} /></span>
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
      <div className="page-heading-copy">
        <div className="breadcrumb"><span>KRANO</span><i aria-hidden="true" />{eyebrow}</div>
        <div className="page-title-line" aria-hidden="true" />
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
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

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

type IconName =
  | "home"
  | "cloud"
  | "globe"
  | "branch"
  | "server"
  | "folder"
  | "play"
  | "funnel"
  | "layout"
  | "book"
  | "chart"
  | "target"
  | "ads";

function Icon({ name }: { name: IconName }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const
  };
  let drawing: ReactNode;
  switch (name) {
    case "home":
      drawing = <><path d="m3 10 9-7 9 7" /><path d="M5.5 9.5V21h13V9.5M9 21v-7h6v7" /></>;
      break;
    case "cloud":
      drawing = <path d="M6.5 18.5h11a4 4 0 0 0 .7-7.94A6.5 6.5 0 0 0 5.9 8.8a4.85 4.85 0 0 0 .6 9.7Z" />;
      break;
    case "globe":
      drawing = <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>;
      break;
    case "branch":
      drawing = <><circle cx="6" cy="5" r="2" /><circle cx="18" cy="7" r="2" /><circle cx="18" cy="18" r="2" /><path d="M6 7v5a5 5 0 0 0 5 5h5M8 5h4a6 6 0 0 1 6 6v5" /></>;
      break;
    case "server":
      drawing = <><rect x="3" y="4" width="18" height="6" rx="2" /><rect x="3" y="14" width="18" height="6" rx="2" /><path d="M7 7h.01M7 17h.01M11 7h7M11 17h7" /></>;
      break;
    case "folder":
      drawing = <path d="M3 6.5a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />;
      break;
    case "play":
      drawing = <><circle cx="12" cy="12" r="9" /><path d="m10 8 6 4-6 4Z" /></>;
      break;
    case "funnel":
      drawing = <><path d="M4 5h16M7 12h10M10 19h4" /><path d="m18 9 3 3-3 3" /></>;
      break;
    case "layout":
      drawing = <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M9 9v11" /></>;
      break;
    case "book":
      drawing = <><path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H12v18H7.5A3.5 3.5 0 0 0 4 23.5Z" /><path d="M20 5.5A3.5 3.5 0 0 0 16.5 2H12v18h4.5a3.5 3.5 0 0 1 3.5 3.5Z" /></>;
      break;
    case "chart":
      drawing = <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>;
      break;
    case "target":
      drawing = <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /><path d="M12 3v3M21 12h-3M12 21v-3M3 12h3" /></>;
      break;
    case "ads":
      drawing = <><path d="M4 13V8l12-4v13L4 13Z" /><path d="M7 14v5a2 2 0 0 0 2 2h2v-6M16 9h3a2 2 0 0 1 0 4h-3" /></>;
      break;
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true" {...common}>{drawing}</svg>;
}
