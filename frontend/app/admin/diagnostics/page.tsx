"use client";

import LoadingSkeleton from "@/app/components/shared/LoadingSkeleton";
import { useEffect, useState } from "react";

import AdminColumn from "../../components/admin/AdminColumn";
import DiagnosticReports from "../../components/admin/DiagnosticReports";
import { StaffGateMessage, gateKind, type GateKind } from "../../components/admin/StaffGate";
import { listDiagnosticReports, type DiagnosticReportRow } from "../../../lib/diagnostic/api";

export default function AdminDiagnosticsPage() {
  const [gate, setGate] = useState<GateKind | "loading" | "ready">("loading");
  const [reports, setReports] = useState<DiagnosticReportRow[]>([]);

  useEffect(() => {
    let live = true;
    listDiagnosticReports()
      .then((rows) => {
        if (!live) return;
        setReports(rows);
        setGate("ready");
      })
      .catch((err) => live && setGate(gateKind(err)));
    return () => {
      live = false;
    };
  }, []);

  return (
    <AdminColumn>
      {gate === "loading" ? (
        <LoadingSkeleton variant="table" className="mt-6" />
      ) : gate === "ready" ? (
        <DiagnosticReports initial={reports} />
      ) : (
        <StaffGateMessage kind={gate} />
      )}
    </AdminColumn>
  );
}
