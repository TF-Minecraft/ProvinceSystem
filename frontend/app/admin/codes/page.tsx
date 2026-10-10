"use client";

import { useEffect, useState } from "react";

import AdminColumn from "../../components/admin/AdminColumn";
import CodeLookup from "../../components/admin/CodeLookup";
import { StaffGateMessage, gateKind, type GateKind } from "../../components/admin/StaffGate";
import { getAdminMe } from "../../../lib/admin/api";

export default function AdminCodesPage() {
  const [gate, setGate] = useState<GateKind | "loading" | "ready">("loading");

  useEffect(() => {
    let live = true;
    getAdminMe()
      .then(() => live && setGate("ready"))
      .catch((err) => live && setGate(gateKind(err)));
    return () => {
      live = false;
    };
  }, []);

  return (
    <AdminColumn>
      {gate === "loading" ? (
        <p className="mt-6 text-[var(--tfmc-mist)]">Loading…</p>
      ) : gate === "ready" ? (
        <>
          <p className="mt-6 text-sm text-[var(--tfmc-mist)]">
            What a skin or drink code is and what it unlocks. Looking it up does not use it.
          </p>
          <CodeLookup />
        </>
      ) : (
        <StaffGateMessage kind={gate} />
      )}
    </AdminColumn>
  );
}
