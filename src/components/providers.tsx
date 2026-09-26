"use client";

import { useEffect, type ReactNode } from "react";
import { Toaster } from "sonner";
import { AuthProvider } from "./auth-provider";

function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // Dev builds change chunk names constantly; only production gets offline caching.
    if (process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  }, []);
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <ServiceWorker />
      {children}
      <Toaster
        theme="dark"
        position="top-center"
        richColors
        closeButton
        toastOptions={{
          style: {
            background: "var(--color-panel)",
            border: "1px solid var(--color-line-strong)",
            color: "var(--color-ink)",
            fontFamily: "var(--font-sans)",
          },
        }}
      />
    </AuthProvider>
  );
}
