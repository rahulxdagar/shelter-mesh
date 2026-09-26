"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { FullscreenLoader } from "@/components/app-shell";
import { ROLE_HOME } from "@/lib/types";

export default function Home() {
  const auth = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (auth.status === "ready") router.replace(ROLE_HOME[auth.profile.role]);
    else if (auth.status === "signed_out" || auth.status === "no_profile") router.replace("/login");
  }, [auth, router]);
  return <FullscreenLoader />;
}
