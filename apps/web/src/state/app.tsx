import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { loadSets, loadSettings, saveSettings, type SavedSet, type Settings } from '../store';
import { readHealth, type DayHealth } from './health';
import { computeTargets, loadProfile, loadSession, saveProfile, saveSession, type Profile, type Session, type Targets } from './profile';

export type Tab = 'home' | 'train' | 'nutrition' | 'places' | 'monitor' | 'profile';

interface AppState {
  session: Session | null;
  profile: Profile | null;
  targets: Targets | null;
  health: DayHealth[];
  sets: SavedSet[];
  settings: Settings;
  theme: 'dark' | 'light';
  tab: Tab;
  setTab: (t: Tab) => void;
  setSession: (s: Session | null) => void;
  setProfile: (p: Profile | null) => void;
  refreshSets: () => void;
  updateSettings: (p: Partial<Settings>) => void;
  toggleTheme: () => void;
  signOut: () => void;
}

const Ctx = createContext<AppState | null>(null);

const TABS: Tab[] = ['home', 'train', 'nutrition', 'places', 'monitor', 'profile'];
const tabFromHash = (): Tab => {
  const t = location.hash.replace(/^#\/?/, '') as Tab;
  return TABS.includes(t) ? t : 'home';
};

export function AppProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<Session | null>(loadSession);
  const [profile, setProfileState] = useState<Profile | null>(loadProfile);
  const [sets, setSets] = useState<SavedSet[]>(loadSets);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [tab, setTabState] = useState<Tab>(tabFromHash);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (document.documentElement.dataset.theme as 'dark' | 'light') ?? 'dark');

  useEffect(() => {
    const onHash = () => setTabState(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', theme === 'dark' ? '#0b0f17' : '#f6f7fb');
    try {
      localStorage.setItem('fitmax.theme', theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const value = useMemo<AppState>(() => {
    const targets = profile ? computeTargets(profile) : null;
    return {
      session,
      profile,
      targets,
      health: readHealth(session, profile, 7),
      sets,
      settings,
      theme,
      tab,
      setTab: (t) => {
        location.hash = `/${t}`;
        setTabState(t);
        window.scrollTo({ top: 0 });
      },
      setSession: (s) => {
        saveSession(s);
        setSessionState(s);
      },
      setProfile: (p) => {
        saveProfile(p);
        setProfileState(p);
      },
      refreshSets: () => setSets(loadSets()),
      updateSettings: (p) => {
        const next = { ...settings, ...p };
        saveSettings(next);
        setSettings(next);
      },
      toggleTheme: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')),
      signOut: () => {
        saveSession(null);
        setSessionState(null);
      },
    };
  }, [session, profile, sets, settings, theme, tab]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}
