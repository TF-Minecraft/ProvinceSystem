import Link from "next/link";
import { AccountApiError } from "../../../lib/account/api";

export type GateKind = "signed_out" | "forbidden" | "unavailable" | "error";

/** Which notice a failed staff request should show instead of the page. */
export function gateKind(err: unknown): GateKind {
  const status = err instanceof AccountApiError ? err.status : 0;
  return status === 401 ? "signed_out" : status === 403 ? "forbidden" : status === 503 ? "unavailable" : "error";
}

export function StaffGateMessage({ kind }: { kind: GateKind }) {
  if (kind === "signed_out") {
    return (
      <p className="mt-6 text-[var(--tfmc-mist)]">
        <Link href="/account" className="text-[var(--tfmc-accent)] underline-offset-2 hover:underline">
          Sign in with Discord
        </Link>{" "}
        to use the staff panel.
      </p>
    );
  }
  if (kind === "forbidden") return <p className="mt-6 text-[var(--tfmc-mist)]">This page is for TFMC staff only.</p>;
  if (kind === "unavailable") return <p className="mt-6 text-[var(--tfmc-mist)]">The staff panel isn’t available yet.</p>;
  return (
    <p className="mt-6 text-sm text-[#e8a0a0]" role="alert">
      We couldn’t load the staff panel. Please refresh the page.
    </p>
  );
}
