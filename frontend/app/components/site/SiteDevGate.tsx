"use client";

import { useSiteStaffAccess } from "@/app/hooks/useSiteStaffAccess";
import { isSiteDevGateEnabled } from "@/lib/site/config";
import SiteHeader from "../shell/SiteHeader";
import PageScroll from "../shell/PageScroll";
import DevLandingPage from "./DevLandingPage";

type Props = {
  children: React.ReactNode;
};

export default function SiteDevGate({ children }: Props) {
  // Reports "staff" straight away when the gate is off or in UI dev mode.
  const { state, retry } = useSiteStaffAccess({ enabled: isSiteDevGateEnabled() });
  const staff = state === "staff";

  return (
    <>
      {staff && <SiteHeader />}
      <PageScroll>
        {staff ? (
          children
        ) : (
          <DevLandingPage loading={state === "loading"} accessDenied={state === "denied"} onStaffVerified={retry} />
        )}
      </PageScroll>
    </>
  );
}
