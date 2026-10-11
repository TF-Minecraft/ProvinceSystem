"use client";

import { useSiteStaffAccess } from "@/app/hooks/useSiteStaffAccess";
import { isSiteDevGateEnabled } from "@/lib/site/config";
import SiteHeader from "../shell/SiteHeader";
import DevLandingPage from "./DevLandingPage";

type Props = {
  children: React.ReactNode;
};

export default function SiteDevGate({ children }: Props) {
  // Reports "staff" straight away when the gate is off or in UI dev mode.
  const { state, retry } = useSiteStaffAccess({ enabled: isSiteDevGateEnabled() });

  if (state === "staff") {
    return (
      <>
        <SiteHeader />
        {children}
      </>
    );
  }

  return (
    <DevLandingPage
      loading={state === "loading"}
      accessDenied={state === "denied"}
      onStaffVerified={retry}
    />
  );
}
