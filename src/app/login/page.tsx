"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Ambulance, ArrowRight, Building, Eye, Footprints, KeyRound, Landmark, Mail, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-provider";
import { Logo } from "@/components/app-shell";
import { Button } from "@/components/ui";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import { cn } from "@/lib/format";
import { ROLE_HOME } from "@/lib/types";

const DEMO_PASSWORD = "ColdGrid-2026!";

const DEMO_ACCOUNTS = [
  { email: "outreach@coldgrid.demo", label: "Street Outreach", sub: "Maya · OUTREACH-7", icon: Footprints },
  { email: "staff.mission@coldgrid.demo", label: "Shelter Intake", sub: "The Ottawa Mission desk", icon: Building },
  { email: "ems@coldgrid.demo", label: "EMS Crisis Team", sub: "Sam · MEDIC-12", icon: Ambulance },
  { email: "ops@coldgrid.demo", label: "City Ops · 3-1-1", sub: "Louise · Command", icon: Landmark },
  { email: "observer@coldgrid.demo", label: "Field Observer", sub: "Drop Pin only", icon: Eye },
];

export default function LoginPage() {
  const auth = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (auth.status === "ready") router.replace(ROLE_HOME[auth.profile.role]);
  }, [auth, router]);

  async function signIn(e?: React.FormEvent, creds?: { email: string; password: string }) {
    e?.preventDefault();
    const c = creds ?? { email: email.trim(), password };
    if (!c.email || !c.password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await supabase().auth.signInWithPassword(c);
    setBusy(false);
    if (error) {
      setError(error.message === "Invalid login credentials" ? "Email or password is incorrect." : error.message);
      return;
    }
    toast.success("Signed in");
  }

  return (
    <main className="grid-field relative flex min-h-dvh items-center justify-center overflow-hidden bg-void px-4 py-10">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[900px] -translate-x-1/2 rounded-full bg-ice/10 blur-[120px]" />
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full max-w-[420px]"
      >
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo />
          <h1 className="mt-6 text-2xl font-semibold tracking-[-0.03em]">Sign in to the mesh</h1>
          <p className="mt-1.5 text-sm text-muted">City of Ottawa inter-agency emergency logistics</p>
        </div>

        {!supabaseConfigured && (
          <div className="mb-4 flex gap-3 rounded-xl border border-caution/40 bg-caution-dim p-3 text-sm text-caution">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>
              Supabase is not configured. Add <code className="font-mono">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
              <code className="font-mono">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to <code className="font-mono">.env.local</code>.
            </span>
          </div>
        )}

        <form onSubmit={signIn} className="space-y-3 rounded-2xl border border-line bg-panel/90 p-5 backdrop-blur">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.08em] text-muted">Email</span>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-12 w-full rounded-xl border border-line-strong bg-deep pl-10 pr-3 text-[15px] outline-none transition-colors placeholder:text-faint focus:border-ice"
                placeholder="you@agency.ca"
              />
            </div>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.08em] text-muted">Password</span>
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-12 w-full rounded-xl border border-line-strong bg-deep pl-10 pr-3 text-[15px] outline-none transition-colors placeholder:text-faint focus:border-ice"
                placeholder="••••••••"
              />
            </div>
          </label>
          {error && (
            <p className="text-sm text-alarm" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" tone="primary" size="lg" className="w-full" loading={busy} disabled={!supabaseConfigured}>
            Sign in <ArrowRight className="size-4" />
          </Button>
        </form>

        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Demo accounts</span>
            <span className="font-mono text-[11px] text-faint">pw {DEMO_PASSWORD}</span>
          </div>
          <div className="grid gap-1.5">
            {DEMO_ACCOUNTS.map((a) => (
              <button
                key={a.email}
                type="button"
                disabled={busy || !supabaseConfigured}
                onClick={() => {
                  setEmail(a.email);
                  setPassword(DEMO_PASSWORD);
                  void signIn(undefined, { email: a.email, password: DEMO_PASSWORD });
                }}
                className={cn(
                  "group flex items-center gap-3 rounded-xl border border-line bg-panel/70 px-3 py-2.5 text-left transition-colors",
                  "hover:border-line-strong hover:bg-raised disabled:opacity-50",
                )}
              >
                <span className="flex size-9 items-center justify-center rounded-lg bg-raised text-ink-2 group-hover:text-ice">
                  <a.icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{a.label}</span>
                  <span className="block truncate text-xs text-muted">{a.sub}</span>
                </span>
                <ArrowRight className="size-4 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-ink-2" />
              </button>
            ))}
          </div>
        </div>
      </motion.div>
    </main>
  );
}
