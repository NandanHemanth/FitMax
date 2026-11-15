import { lazy, Suspense, useState, type ReactElement } from 'react';
import { ThemePicker } from './ui/ThemePicker';
import { HeartPip } from './vitals/HeartPip';
import { AppProvider, useApp, type Tab } from './state/app';
import { Onboarding, SignIn } from './screens/Auth';
import { Dashboard } from './screens/Dashboard';
import { Nutrition } from './screens/Nutrition';
import { ProfileScreen } from './screens/ProfileScreen';
import { Train } from './screens/Train';
import { IconApple, IconCube, IconDumbbell, IconHome, IconMap, IconMoon, IconPulse, IconSun, IconUser } from './ui/icons';
import { Monitor } from './screens/Monitor';

// The map library is large: load it only when Places opens.
const Places = lazy(() => import('./screens/Places').then((m) => ({ default: m.Places })));
const Space = lazy(() => import('./screens/Space').then((m) => ({ default: m.Space })));
const Interior = lazy(() => import('./screens/Interior').then((m) => ({ default: m.Interior })));

const NAV: { id: Tab; label: string; icon: ReactElement }[] = [
  { id: 'home', label: 'Dashboard', icon: <IconHome /> },
  { id: 'train', label: 'Train', icon: <IconDumbbell /> },
  { id: 'nutrition', label: 'Nutrition', icon: <IconApple /> },
  { id: 'places', label: 'Places', icon: <IconMap /> },
  { id: 'interior', label: 'Design', icon: <IconCube /> },
  { id: 'monitor', label: 'Monitor', icon: <IconPulse /> },
  { id: 'profile', label: 'Profile', icon: <IconUser /> },
];

export default function App() {
  return (
    <AppProvider>
      <Root />
    </AppProvider>
  );
}

function Root() {
  const { session, profile, setSession, setProfile } = useApp();
  if (!session) return <SignIn onSignedIn={setSession} />;
  if (!profile) return <Onboarding onDone={setProfile} />;
  return <Shell />;
}

function Shell() {
  const { tab, setTab, theme, profile } = useApp();
  const [look, setLook] = useState(false);
  const ThemeIcon = theme === 'dark' ? IconMoon : IconSun;
  return (
    <div className="shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setTab('home')}>
          <img src="/logo.svg" alt="" /> FitMax
        </button>
        {NAV.map((n) => (
          <button key={n.id} className={`nav-item ${tab === n.id ? 'on' : ''}`} onClick={() => setTab(n.id)} aria-current={tab === n.id ? 'page' : undefined}>
            {n.icon} {n.label}
          </button>
        ))}
        <div className="sidebar-foot">
          <button className="nav-item" onClick={() => setLook(true)}>
            <ThemeIcon /> Look
          </button>
          <span className="tiny muted" style={{ padding: '0 12px' }}>
            Signed in as {profile?.name}
          </span>
        </div>
      </aside>

      <header className="topbar">
        <button className="brand" onClick={() => setTab('home')}>
          <img src="/logo.svg" alt="" /> FitMax
        </button>
        <button className="icon-btn" onClick={() => setLook(true)} aria-label="Change look">
          <ThemeIcon size={18} />
        </button>
      </header>

      <main className="main">
        {tab === 'home' && <Dashboard />}
        {tab === 'train' && <Train />}
        {tab === 'nutrition' && <Nutrition />}
        {tab === 'places' && (
          <Suspense fallback={<p className="muted">Loading map…</p>}>
            <Places />
          </Suspense>
        )}
        {tab === 'space' && (
          <Suspense fallback={<p className="muted">Loading 3D builder…</p>}>
            <Space />
          </Suspense>
        )}
        {tab === 'interior' && (
          <Suspense fallback={<p className="muted">Loading 3D home…</p>}>
            <Interior />
          </Suspense>
        )}
        {tab === 'monitor' && <Monitor />}
        {tab === 'profile' && <ProfileScreen />}
      </main>

      {look && <ThemePicker onClose={() => setLook(false)} />}
      <HeartPip />
      <nav className="tabbar" aria-label="Main">
        {NAV.map((n) => (
          <button key={n.id} className={tab === n.id ? 'on' : ''} onClick={() => setTab(n.id)} aria-current={tab === n.id ? 'page' : undefined}>
            {n.icon}
            {n.label === 'Dashboard' ? 'Home' : n.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
