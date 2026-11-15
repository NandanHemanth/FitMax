import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { loadSets, loadSettings, saveSettings, type SavedSet, type Settings } from '../store';
import { readHealth, type DayHealth } from './health';
import { applyTheme, loadSkin, type Skin } from '../theme/skins';
import { computeTargets, defaultProfile, fetchMe, loadProfile, loadSession, saveProfile, saveSession, syncMe, type Profile, type Session, type Targets } from './profile';

export type Tab = 'home' | 'train' | 'nutrition' | 'places' | 'interior' | 'monitor' | 'profile' | 'space';

interface AppState {
  session: Session | null;
  profile: Profile | null;
  targets: Targets | null;
  health: DayHealth[];
  sets: SavedSet[];
  settings: Settings;
  theme: 'dark' | 'light';
  skin: Skin;
  setSkin: (s: Skin) => void;
  setMode: (m: 'dark' | 'light') => void;
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

const TABS: Tab[] = ['home', 'train', 'nutrition', 'places', 'interior', 'monitor', 'profile', 'space'];
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
  const [skin, setSkinState] = useState<Skin>(loadSkin);

  useEffect(() => {
    const onHash = () => setTabState(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => applyTheme(skin, theme), [skin, theme]);

  // Signed in on another browser of this laptop's dev server (e.g. the iPhone)? Start signed in here too.
  useEffect(() => {
    if (session && profile) return;
    void fetchMe().then((me) => {
      if (me.session && !session) {
        saveSession(me.session);
        setSessionState(me.session);
      }
      if (me.profile && !profile) {
        saveProfile(me.profile);
        setProfileState(me.profile);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      skin,
      setSkin: setSkinState,
      setMode: setTheme,
      tab,
      setTab: (t) => {
        location.hash = `/${t}`;
        setTabState(t);
        window.scrollTo({ top: 0 });
      },
      setSession: (s) => {
        saveSession(s);
        setSessionState(s);
        // One tap is enough: a placeholder profile so nobody fills a form to see the app
        const p = s && !profile ? defaultProfile() : profile;
        if (s && !profile) {
          saveProfile(p);
          setProfileState(p);
        }
        void syncMe(s, s ? p : null);
      },
      setProfile: (p) => {
        saveProfile(p);
        setProfileState(p);
        void syncMe(session, p);
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
        void syncMe(null, profile);
      },
    };
  }, [session, profile, sets, settings, theme, skin, tab]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}
