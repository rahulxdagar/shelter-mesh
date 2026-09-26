"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase, supabaseAnonKey, supabaseConfigured, supabaseUrl } from "@/lib/supabase";
import { saveSyncConfig } from "@/lib/offline";
import { ROLE_HOME, type AppRole, type Profile } from "@/lib/types";

type AuthState =
  | { status: "loading"; session: null; profile: null }
  | { status: "signed_out"; session: null; profile: null }
  | { status: "no_profile"; session: Session; profile: null }
  | { status: "ready"; session: Session; profile: Profile };

type AuthContextValue = AuthState & { signOut: () => Promise<void> };

const AuthContext = createContext<AuthContextValue | null>(null);
const PROFILE_CACHE = "coldgrid-profile";

function cachedProfile(userId: string): Profile | null {
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_CACHE) ?? "null") as Profile | null;
    return p?.id === userId ? p : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() =>
    supabaseConfigured
      ? { status: "loading", session: null, profile: null }
      : { status: "signed_out", session: null, profile: null },
  );

  const resolve = useCallback(async (session: Session | null) => {
    if (!session) {
      setState({ status: "signed_out", session: null, profile: null });
      return;
    }
    void saveSyncConfig({ url: supabaseUrl, anonKey: supabaseAnonKey, accessToken: session.access_token });

    // Render instantly from the last known profile (critical in dead zones), then refresh it.
    const known = cachedProfile(session.user.id);
    if (known) setState({ status: "ready", session, profile: known });
    if (known && !navigator.onLine) return;

    const { data, error } = await supabase()
      .from("profiles")
      .select("id, full_name, role, shelter_id, callsign, operational_radius_km")
      .eq("id", session.user.id)
      .maybeSingle();

    if (data) {
      try {
        localStorage.setItem(PROFILE_CACHE, JSON.stringify(data));
      } catch {
        /* ignore */
      }
      setState({ status: "ready", session, profile: data as Profile });
      return;
    }
    // Network failure with a known profile: keep it. Only a definitive "no row" signs the user out.
    if (error && known) return;
    setState({ status: "no_profile", session, profile: null });
  }, []);

  useEffect(() => {
    if (!supabaseConfigured) return;
    const sb = supabase();
    let active = true;
    sb.auth.getSession().then(({ data }) => {
      if (active) void resolve(data.session);
    });
    const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "TOKEN_REFRESHED" && session) {
        void saveSyncConfig({ url: supabaseUrl, anonKey: supabaseAnonKey, accessToken: session.access_token });
        setState((s) => (s.status === "ready" ? { ...s, session } : s));
        return;
      }
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        // Defer: calling Supabase inside the auth callback can deadlock the client.
        setTimeout(() => active && resolve(session), 0);
      }
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [resolve]);

  const signOut = useCallback(async () => {
    try {
      localStorage.removeItem(PROFILE_CACHE);
    } catch {
      /* ignore */
    }
    void saveSyncConfig({ url: supabaseUrl, anonKey: supabaseAnonKey, accessToken: null });
    await supabase().auth.signOut();
  }, []);

  const value = useMemo(() => ({ ...state, signOut }) as AuthContextValue, [state, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/** Returns the profile once the signed-in user holds one of `roles`; redirects otherwise. */
export function useRequireRole(roles: AppRole[]): Profile | null {
  const auth = useAuth();
  const router = useRouter();
  const allowed = auth.status === "ready" && roles.includes(auth.profile.role);

  useEffect(() => {
    if (auth.status === "signed_out" || auth.status === "no_profile") router.replace("/login");
    else if (auth.status === "ready" && !roles.includes(auth.profile.role)) router.replace(ROLE_HOME[auth.profile.role]);
  }, [auth.status, auth.profile, roles, router]);

  return allowed ? auth.profile : null;
}
