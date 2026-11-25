import React, { useState, useEffect } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  Home, Car, Search, ListChecks, Gift, User, BarChart3,
  Users, Building2, Trophy, Info, Menu, X, LogOut, Award, ClipboardCheck, ScrollText, FileText, ShieldOff, Settings, KeyRound,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useBranding } from '../context/BrandingContext.jsx';
import { Simbolo, PoweredBy } from './MarcaWayMatch.jsx';
import NotificationBell from './NotificationBell.jsx';
import NotificationPermissionBanner from './NotificationPermissionBanner.jsx';
import InstallPwaBanner from './InstallPwaBanner.jsx';
import LegalDocumentsGate from './LegalDocumentsGate.jsx';
import ForcedPasswordChangeGate from './ForcedPasswordChangeGate.jsx';

const mainNav = [
  { to: '/', icon: Home, label: 'Home', end: true },
  { to: '/offri', icon: Car, label: 'Offri' },
  { to: '/cerca', icon: Search, label: 'Cerca' },
  { to: '/i-miei-viaggi', icon: ListChecks, label: 'Viaggi' },
  { to: '/premi', icon: Gift, label: 'Premi' },
  { to: '/profilo', icon: User, label: 'Profilo' },
];

// Voci raggruppate per area invece di un unico elenco piatto: con 10+ voci un elenco
// senza struttura è difficile da scandire a colpo d'occhio.
function adminGroupsFor(ruolo) {
  const gruppi = [];

  const monitoraggio = [];
  if (ruolo === 'mobility_manager') monitoraggio.push({ to: '/admin/approvazioni', icon: ClipboardCheck, label: 'Approvazioni' });
  if (['mobility_manager', 'supervisor'].includes(ruolo)) monitoraggio.push({ to: '/report', icon: BarChart3, label: 'Report' });
  if (ruolo === 'mobility_manager') monitoraggio.push({ to: '/admin/log', icon: ScrollText, label: 'Log attività' });
  if (monitoraggio.length > 0) gruppi.push({ titolo: 'Monitoraggio', items: monitoraggio });

  if (ruolo === 'mobility_manager') {
    gruppi.push({
      titolo: 'Persone e privacy',
      items: [
        { to: '/admin/utenti', icon: Users, label: 'Utenti' },
        { to: '/admin/reset-password', icon: KeyRound, label: 'Reset password' },
        { to: '/admin/documenti', icon: FileText, label: 'Documenti' },
        { to: '/admin/cancellazioni', icon: ShieldOff, label: 'Cancellazioni' },
      ],
    });
    gruppi.push({
      titolo: 'Azienda',
      items: [
        { to: '/admin/impostazioni', icon: Settings, label: 'Impostazioni generali' },
        { to: '/admin/sedi', icon: Building2, label: 'Sedi' },
      ],
    });
    gruppi.push({
      titolo: 'Gamification',
      items: [
        { to: '/admin/premi', icon: Gift, label: 'Gestione premi' },
        { to: '/admin/contest', icon: Trophy, label: 'Contest' },
        { to: '/admin/punteggio', icon: Award, label: 'Regole punteggio' },
      ],
    });
  }
  return gruppi;
}

const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 420;
const SIDEBAR_DEFAULT = 256;

function leggiSidebarWidth() {
  try {
    const v = Number(localStorage.getItem('sidebarWidth'));
    return v >= SIDEBAR_MIN && v <= SIDEBAR_MAX ? v : SIDEBAR_DEFAULT;
  } catch {
    return SIDEBAR_DEFAULT;
  }
}

export default function Layout() {
  const { user, logout, punti } = useAuth();
  const { branding } = useBranding();
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(leggiSidebarWidth);
  const [resizing, setResizing] = useState(false);
  const adminGroups = adminGroupsFor(user?.ruolo);

  // Trascinamento della maniglia sul bordo destro della sidebar desktop: larghezza
  // salvata in localStorage, è una preferenza personale del browser, non un dato condiviso.
  useEffect(() => {
    if (!resizing) return;
    const onMove = (e) => {
      setSidebarWidth(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, e.clientX)));
    };
    const onUp = () => {
      setResizing(false);
      document.body.style.userSelect = '';
      setSidebarWidth((w) => {
        try { localStorage.setItem('sidebarWidth', String(w)); } catch { /* localStorage non disponibile */ }
        return w;
      });
    };
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [resizing]);

  const resetSidebarWidth = () => {
    setSidebarWidth(SIDEBAR_DEFAULT);
    try { localStorage.setItem('sidebarWidth', String(SIDEBAR_DEFAULT)); } catch { /* localStorage non disponibile */ }
  };

  const sidebarScale = Math.min(1, Math.max(0, (sidebarWidth - SIDEBAR_MIN) / (SIDEBAR_MAX - SIDEBAR_MIN)));

  return (
    <ForcedPasswordChangeGate>
    <LegalDocumentsGate>
    <div className="min-h-screen bg-bg flex">
      <a href="#contenuto" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[200] focus:rounded-xl focus:bg-primary focus:text-white focus:px-4 focus:py-2.5 focus:text-sm focus:font-medium">
        Salta al contenuto
      </a>
      {/* Sidebar desktop */}
      <aside
        className="hidden md:flex relative shrink-0 flex-col border-r border-border bg-surface px-4 pt-6 pb-2 sticky top-0 h-screen"
        style={{ width: sidebarWidth }}
      >
        <div className="flex items-center justify-between">
          <BrandHeader branding={branding} scale={sidebarScale} />
          <NotificationBell />
        </div>
        <nav aria-label="Menu principale" className="mt-8 flex-1 min-h-0 overflow-y-auto space-y-1 pr-1">
          {mainNav.map((item) => <NavItem key={item.to} {...item} />)}
          {adminGroups.map((g) => (
            <div key={g.titolo} className="pt-4 mt-4 border-t border-border">
              {g.titolo && <p className="px-3 pb-2 text-xs font-medium text-muted uppercase tracking-wide">{g.titolo}</p>}
              {g.items.map((item) => <NavItem key={item.to} {...item} />)}
            </div>
          ))}
        </nav>
        <UserCard user={user} punti={punti} onLogout={logout} />
        <div className="pt-1 text-center"><PoweredBy /></div>

        {/* Separatore ridimensionabile anche da tastiera: frecce sinistra/destra, Home e Fine
            per gli estremi, Invio per tornare alla larghezza predefinita. */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Larghezza del menu"
          aria-valuenow={sidebarWidth}
          aria-valuemin={SIDEBAR_MIN}
          aria-valuemax={SIDEBAR_MAX}
          tabIndex={0}
          onMouseDown={() => setResizing(true)}
          onDoubleClick={resetSidebarWidth}
          onKeyDown={(e) => {
            const passo = e.shiftKey ? 40 : 16;
            let w = null;
            if (e.key === 'ArrowLeft') w = sidebarWidth - passo;
            else if (e.key === 'ArrowRight') w = sidebarWidth + passo;
            else if (e.key === 'Home') w = SIDEBAR_MIN;
            else if (e.key === 'End') w = SIDEBAR_MAX;
            else if (e.key === 'Enter') { e.preventDefault(); resetSidebarWidth(); return; }
            if (w === null) return;
            e.preventDefault();
            w = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w));
            setSidebarWidth(w);
            try { localStorage.setItem('sidebarWidth', String(w)); } catch { /* localStorage non disponibile */ }
          }}
          title="Trascina o usa le frecce per ridimensionare, doppio click o Invio per ripristinare"
          className={`hidden md:block absolute top-0 -right-0.5 h-full w-1.5 cursor-col-resize z-10 hover:bg-primary/30 focus-visible:bg-primary/40 focus-visible:outline-none ${resizing ? 'bg-primary/40' : ''}`}
        />
      </aside>

      {/* Header mobile */}
      <header className="md:hidden fixed top-0 inset-x-0 z-50 bg-surface border-b border-border px-4 h-16 flex items-center justify-between">
        <BrandHeader branding={branding} compact />
        <div className="flex items-center gap-1">
          <NotificationBell />
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="p-2 text-ink"
            aria-label={menuOpen ? 'Chiudi il menu' : 'Apri il menu'}
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </header>

      {/* Menu mobile: pannello che scende dal bordo destro, sotto l'header, e si apre con il
          pulsante che diventa una X. Il resto della pagina resta oscurato e cliccabile per chiudere. */}
      <div
        className={`md:hidden fixed inset-0 top-16 z-40 bg-black/20 transition-opacity duration-200 ${
          menuOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setMenuOpen(false)}
        inert={menuOpen ? undefined : ''}
      >
        <aside
          className={`absolute right-0 top-0 bottom-0 w-64 max-w-[68vw] bg-surface border-l border-border shadow-lg overflow-y-auto px-3 py-4 transition-transform duration-200 ${
            menuOpen ? 'translate-x-0' : 'translate-x-full'
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          <nav aria-label="Menu" className="space-y-1">
            {adminGroups.map((g, i) => (
              <div key={g.titolo} className={i === 0 ? '' : 'pt-4 mt-4 border-t border-border'}>
                {g.titolo && <p className="px-3 pb-2 text-xs font-medium text-muted uppercase tracking-wide">{g.titolo}</p>}
                {g.items.map((item) => (
                  <NavItem key={item.to} {...item} onClick={() => setMenuOpen(false)} />
                ))}
              </div>
            ))}
          </nav>
          <UserCard user={user} punti={punti} onLogout={logout} />
        <div className="pt-2 text-center"><PoweredBy /></div>
        </aside>
      </div>

      {/* Contenuto */}
      <main id="contenuto" tabIndex={-1} className="flex-1 min-w-0 pt-16 pb-20 md:pt-0 md:pb-0 outline-none">
        <div className="max-w-6xl mx-auto px-4 py-6 md:px-8 md:py-8">
          <InstallPwaBanner />
          <NotificationPermissionBanner />
          <Outlet />
        </div>
      </main>

      {/* Bottom tab bar mobile */}
      <nav aria-label="Navigazione rapida" className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-surface border-t border-border flex justify-around px-1 py-1.5">
        {mainNav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg text-[11px] font-medium ${
                isActive ? 'text-primary' : 'text-muted'
              }`
            }
          >
            <item.icon size={20} />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
    </LegalDocumentsGate>
    </ForcedPasswordChangeGate>
  );
}

// scale (0-1, solo sidebar desktop) fa crescere logo e testo con la larghezza trascinata;
// l'header mobile (compact) resta a dimensione fissa.
function BrandHeader({ branding, compact, scale }) {
  const logoPx = scale != null ? Math.round(28 + scale * 16) : 32;
  const nameSize = scale != null ? 13 + scale * 3 : undefined;
  const subSize = scale != null ? 11 + scale * 2 : undefined;
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      {branding.logo_path ? (
        <img
          src={branding.logo_path}
          alt="Logo"
          className="object-contain shrink-0"
          style={{ height: logoPx, width: 'auto', maxWidth: Math.round(logoPx * 3) }}
        />
      ) : (
        <Simbolo altezza={logoPx} className="shrink-0" />
      )}
      {!compact && (
        <div className="min-w-0">
          <p className="font-display font-semibold truncate" style={nameSize ? { fontSize: nameSize } : undefined}>{branding.company_name}</p>
          <p className="text-muted -mt-0.5" style={subSize ? { fontSize: subSize } : undefined}>Carpooling</p>
        </div>
      )}
      {compact && <p className="font-display font-semibold text-sm truncate">{branding.company_name}</p>}
    </div>
  );
}

function NavItem({ to, icon: Icon, label, end, onClick }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
          isActive ? 'bg-primary-light text-primary-dark' : 'text-muted hover:bg-bg hover:text-ink'
        }`
      }
    >
      <Icon size={18} />
      {label}
    </NavLink>
  );
}

function UserCard({ user, punti, onLogout }) {
  if (!user) return null;
  return (
    <div className="pt-4 mt-4 border-t border-border">
      <div className="flex items-center gap-3 px-1">
        <div className="w-9 h-9 rounded-full bg-accent-light text-accent-dark flex items-center justify-center font-display font-semibold text-sm shrink-0">
          {user.nome?.[0]}{user.cognome?.[0]}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{user.nome} {user.cognome}</p>
          <p className="text-xs text-muted">{punti} punti</p>
        </div>
        {/* Guide, novità e informazioni sul progetto: accanto al nome, come le altre azioni dell'account. */}
        <NavLink to="/informazioni" title="Informazioni" aria-label="Informazioni"
          className={({ isActive }) => `p-2 rounded-lg ${isActive ? 'text-primary' : 'text-muted hover:text-primary'}`}>
          <Info size={16} />
        </NavLink>
        <button onClick={onLogout} className="p-2 text-muted hover:text-danger" title="Esci" aria-label="Esci">
          <LogOut size={16} />
        </button>
      </div>
    </div>
  );
}
