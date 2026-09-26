import { Auth0Provider, useAuth0 } from '@auth0/auth0-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { request, type GetToken } from './api';
import { useI18n } from './i18n';
import type { Me, Role, Shelter, Snapshot } from './types';

const AUTH0_DOMAIN = import.meta.env.VITE_AUTH0_DOMAIN as string | undefined;
const AUTH0_CLIENT_ID = import.meta.env.VITE_AUTH0_CLIENT_ID as string | undefined;
const AUTH0_AUDIENCE = (import.meta.env.VITE_AUTH0_AUDIENCE as string | undefined) ?? 'https://api.coldgrid';
export const authMode: 'auth0' | 'dev' = AUTH0_DOMAIN && AUTH0_CLIENT_ID ? 'auth0' : 'dev';

type Session = { me: Me; getToken: GetToken; signOut: () => void };
const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession outside a signed-in tree');
  return s;
}

export function roleOf(me: Me): Role {
  if (me.permissions.includes('execute:code_frost')) return 'city_ops';
  if (me.permissions.includes('confirm:hold')) return 'shelter_admin';
  if (me.permissions.includes('respond:alert')) return 'responder';
  return 'outreach';
}

export function AuthGate({ children }: { children: ReactNode }) {
  if (authMode === 'auth0') {
    return (
      <Auth0Provider
        domain={AUTH0_DOMAIN!}
        clientId={AUTH0_CLIENT_ID!}
        authorizationParams={{ audience: AUTH0_AUDIENCE, redirect_uri: window.location.origin }}
        cacheLocation="localstorage"
        useRefreshTokens
      >
        <Auth0Session>{children}</Auth0Session>
      </Auth0Provider>
    );
  }
  return <DevSession>{children}</DevSession>;
}

function useMe(getToken: GetToken | null) {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!getToken) return setMe(null);
    let cancelled = false;
    request<Me>(getToken, 'GET', '/api/me')
      .then((m) => !cancelled && setMe(m))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [getToken]);
  return { me, error };
}

// ---- Auth0 ---------------------------------------------------------------------------------------
function Auth0Session({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const { isLoading, isAuthenticated, loginWithRedirect, logout, getAccessTokenSilently, error: authError } = useAuth0();
  const getToken = useMemo<GetToken | null>(
    () => (isAuthenticated ? async () => (await getAccessTokenSilently()) ?? "" : null),
    [isAuthenticated, getAccessTokenSilently],
  );
  const { me, error } = useMe(getToken);
  if (isLoading || (isAuthenticated && !me && !error)) return <Splash text={t.connecting} />;
  if (!isAuthenticated || !getToken || !me) {
    return (
      <Splash text={authError?.message ?? error ?? t.tagline}>
        <button className="btn btn-primary btn-xl" onClick={() => loginWithRedirect()}>
          {t.signIn}
        </button>
      </Splash>
    );
  }
  const signOut = () => logout({ logoutParams: { returnTo: window.location.origin } });
  return <SessionContext.Provider value={{ me, getToken, signOut }}>{children}</SessionContext.Provider>;
}

// ---- Dev mode: pick a role. The identity is per browser tab so one laptop can run several roles. --
type DevIdentity = { role: Role; sub: string; name: string; shelterId: string | null };

function devToken(id: DevIdentity): string {
  const json = JSON.stringify({ role: id.role, sub: id.sub, name: id.name, shelterId: id.shelterId });
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(json)));
  return 'dev.' + b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function loadDevIdentity(): DevIdentity | null {
  try {
    const raw = sessionStorage.getItem('coldgrid:dev-identity');
    return raw ? (JSON.parse(raw) as DevIdentity) : null;
  } catch {
    return null;
  }
}

function saveDevIdentity(id: DevIdentity | null) {
  try {
    if (id) sessionStorage.setItem('coldgrid:dev-identity', JSON.stringify(id));
    else sessionStorage.removeItem('coldgrid:dev-identity');
  } catch {
    // ignore
  }
}

function DevSession({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<DevIdentity | null>(loadDevIdentity);
  const getToken = useMemo<GetToken | null>(() => (identity ? async () => devToken(identity) : null), [identity]);
  const { me } = useMe(getToken);
  const signOut = useCallback(() => {
    saveDevIdentity(null);
    setIdentity(null);
  }, []);
  if (!identity || !getToken)
    return (
      <RolePicker
        onPick={(id) => {
          saveDevIdentity(id);
          setIdentity(id);
        }}
      />
    );
  if (!me) return <Splash text="…" />;
  return <SessionContext.Provider value={{ me, getToken, signOut }}>{children}</SessionContext.Provider>;
}

const PEOPLE: { role: Role; name: string }[] = [
  { role: 'outreach', name: 'Sam' },
  { role: 'responder', name: 'Riley' },
  { role: 'responder', name: 'Jordan' },
  { role: 'responder', name: 'Morgan' },
  { role: 'city_ops', name: 'Alex' },
];

function RolePicker({ onPick }: { onPick: (id: DevIdentity) => void }) {
  const { t } = useI18n();
  const [shelters, setShelters] = useState<Shelter[]>([]);
  useEffect(() => {
    const probe = devToken({ role: 'outreach', sub: 'dev-probe', name: 'probe', shelterId: null });
    request<Snapshot>(async () => probe, 'GET', '/api/snapshot')
      .then((s) => setShelters(s.shelters.filter((x) => x.kind === 'shelter')))
      .catch(() => setShelters([]));
  }, []);
  const pick = (role: Role, name: string, shelterId: string | null = null) =>
    onPick({ role, name, shelterId, sub: `dev-${role}-${(shelterId ?? name).toLowerCase()}` });

  return (
    <Splash text={t.pickRole}>
      <p className="muted small">{t.devModeNote}</p>
      <div className="stack">
        {PEOPLE.map((p) => (
          <button key={p.name} className="btn btn-xl" onClick={() => pick(p.role, p.name)}>
            {t[`role_${p.role}`]} · {p.name}
          </button>
        ))}
        {shelters.length > 0 && (
          <label className="field">
            <span>{t.role_shelter_admin}</span>
            <select
              className="input"
              defaultValue=""
              onChange={(e) => {
                const s = shelters.find((x) => x.id === e.target.value);
                if (s) pick('shelter_admin', s.name, s.id);
              }}
            >
              <option value="" disabled>
                —
              </option>
              {shelters.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </Splash>
  );
}

export function Splash({ text, children }: { text: string; children?: ReactNode }) {
  const { t, toggle } = useI18n();
  return (
    <main className="splash">
      <button className="btn btn-ghost lang" onClick={toggle}>
        {t.language}
      </button>
      <div className="brand-lg">
        <Snowflake /> {t.appName}
      </div>
      <p className="muted">{text}</p>
      {children}
    </main>
  );
}

export function Snowflake() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M12 2v20M4.9 6.5l14.2 11M4.9 17.5l14.2-11M9 4l3 3 3-3M9 20l3-3 3 3" />
    </svg>
  );
}
