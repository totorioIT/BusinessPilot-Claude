import { useEffect, useState, type FormEvent } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  BarChart3,
  Bot,
  CalendarDays,
  CheckSquare,
  FileText,
  Inbox,
  LifeBuoy,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  Phone,
  Plug,
  Search,
  Settings,
  Shield,
  Star,
  Target,
  Users,
  BookOpen,
  Workflow,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../auth';
import { roleLabel } from '../lib/labels';
import { Logo } from './Logo';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}
interface NavSection {
  title?: string;
  items: NavItem[];
}

const sections: NavSection[] = [
  { items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true }] },
  {
    title: 'Posteingang',
    items: [
      { to: '/inbox', label: 'Übersicht', icon: Inbox, end: true },
      { to: '/inbox/phone', label: 'Telefon', icon: Phone },
      { to: '/inbox/whatsapp', label: 'WhatsApp', icon: MessageCircle },
    ],
  },
  {
    title: 'CRM',
    items: [
      { to: '/customers', label: 'Kunden', icon: Users },
      { to: '/leads', label: 'Leads', icon: Target },
      { to: '/appointments', label: 'Termine', icon: CalendarDays },
      { to: '/quotes', label: 'Angebote', icon: FileText },
      { to: '/tasks', label: 'Aufgaben', icon: CheckSquare },
    ],
  },
  {
    title: 'Automatisierung',
    items: [
      { to: '/automations', label: 'Automationen', icon: Workflow },
      { to: '/reviews', label: 'Bewertungen', icon: Star },
    ],
  },
  {
    title: 'System',
    items: [
      { to: '/knowledge', label: 'Wissen', icon: BookOpen },
      { to: '/analytics', label: 'Analyse', icon: BarChart3 },
      { to: '/ai-employee', label: 'KI-Mitarbeiter', icon: Bot },
      { to: '/integrations', label: 'Integrationen', icon: Plug },
      { to: '/settings', label: 'Einstellungen', icon: Settings },
    ],
  },
];

/** Zeigt dem Plattform-Admin, dass er gerade im Bereich eines Kunden arbeitet. */
function SupportBanner() {
  const { me, switchTenant } = useAuth();
  const [busy, setBusy] = useState(false);
  if (!me?.support) return null;
  const home = me.tenants[0];
  async function back() {
    if (!home) return;
    setBusy(true);
    try {
      await switchTenant(home.id, '/admin');
    } catch {
      setBusy(false);
    }
  }
  return (
    <div className="support-banner" role="status">
      <LifeBuoy aria-hidden="true" />
      <span>
        Sie sehen den Bereich von <strong>{me.tenant.name}</strong> als Support. Alles, was Sie hier ändern, gilt für diesen Kunden.
      </span>
      {home && (
        <button type="button" className="btn btn--sm btn--outline" onClick={back} disabled={busy}>
          Zurück zu {home.name}
        </button>
      )}
    </div>
  );
}

/** Auswahl des Betriebs, wenn ein Benutzer Zugang zu mehreren hat. */
function TenantSwitcher() {
  const { me, switchTenant } = useAuth();
  if (!me || me.tenants.length < 2) return <p className="sidebar__tenant">{me?.tenant.name}</p>;
  return (
    <div className="sidebar__tenant">
      <label htmlFor="tenant-switch" className="sr-only">
        Betrieb wechseln
      </label>
      <select
        id="tenant-switch"
        className="tenant-switch"
        value={me.support ? '' : me.tenant.id}
        onChange={(e) => void switchTenant(e.target.value)}
      >
        {me.support && <option value="">{me.tenant.name} (Support)</option>}
        {me.tenants.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function TopSearch() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const [q, setQ] = useState('');

  useEffect(() => {
    if (location.pathname === '/customers') setQ(params.get('q') ?? '');
  }, [location.pathname, params]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const term = q.trim();
    navigate(term ? `/customers?q=${encodeURIComponent(term)}` : '/customers');
  }

  return (
    <form className="topsearch" role="search" onSubmit={submit}>
      <Search aria-hidden="true" />
      <label htmlFor="topsearch" className="sr-only">
        Kunden suchen
      </label>
      <input
        id="topsearch"
        type="search"
        placeholder="Kunden suchen…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoComplete="off"
      />
    </form>
  );
}

export function Layout() {
  const { me, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  if (!me) return null;

  const allSections: NavSection[] = me.user.isPlatformAdmin
    ? [...sections, { title: 'Plattform', items: [{ to: '/admin', label: 'Admin', icon: Shield }] }]
    : sections;

  async function onLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className={`shell ${menuOpen ? 'shell--menu-open' : ''}`}>
      <a href="#main" className="skip-link">
        Zum Inhalt springen
      </a>
      <aside className="sidebar" id="sidebar" aria-label="Hauptnavigation">
        <div className="sidebar__brand">
          <Logo />
          <p className="sidebar__tagline">Dein digitaler Mitarbeiter</p>
          <button
            type="button"
            className="icon-btn icon-btn--dark sidebar__close"
            onClick={() => setMenuOpen(false)}
            aria-label="Menü schließen"
          >
            <X aria-hidden="true" />
          </button>
        </div>
        <nav className="sidebar__nav">
          {allSections.map((s, i) => (
            <div key={s.title ?? i} className="nav-section">
              {s.title && <p className="nav-section__title">{s.title}</p>}
              <ul>
                {s.items.map((it) => (
                  <li key={it.to}>
                    <NavLink to={it.to} end={it.end} className="nav-link">
                      <it.icon aria-hidden="true" />
                      <span>{it.label}</span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <TenantSwitcher />
      </aside>
      <div className="backdrop" onClick={() => setMenuOpen(false)} aria-hidden="true" />

      <div className="main-col">
        <header className="topbar">
          <button
            type="button"
            className="icon-btn menu-btn"
            onClick={() => setMenuOpen(true)}
            aria-label="Menü öffnen"
            aria-expanded={menuOpen}
            aria-controls="sidebar"
          >
            <Menu aria-hidden="true" />
          </button>
          <TopSearch />
          <div className="topbar__user">
            <div className="avatar" aria-hidden="true">
              {me.user.name
                .split(/\s+/)
                .map((p) => p[0])
                .slice(0, 2)
                .join('')
                .toUpperCase()}
            </div>
            <div className="topbar__user-text">
              <span className="topbar__name">{me.user.name}</span>
              <span className="topbar__role">{me.support ? 'Support' : (roleLabel[me.role] ?? me.role)}</span>
            </div>
            <button type="button" className="icon-btn" onClick={onLogout} aria-label="Abmelden" title="Abmelden">
              <LogOut aria-hidden="true" />
            </button>
          </div>
        </header>
        <SupportBanner />
        <main id="main" className="content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
