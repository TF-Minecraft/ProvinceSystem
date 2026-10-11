import { adminRequest } from "../admin/api";
import { detailMessage, getApiBase, parseJson } from "../site/api";
import type { DiagnosticStatus } from "./findings";

export function apiUrl(path: string): string {
  return `${getApiBase()}/${path.replace(/^\//, "")}`;
}

export async function getDiagnosticStatus(): Promise<DiagnosticStatus> {
  const res = await fetch(apiUrl("diagnostic/status"), { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as DiagnosticStatus;
}

const SEND_ERRORS: Record<string, string> = {
  too_many_requests: "You’ve sent a few already. Wait ten minutes and try again.",
  bad_minecraft_name: "That isn’t a Minecraft name.",
};

/** Sends the report to staff; signed-in players are named on it. */
export async function sendDiagnosticReport(report: object, minecraftName: string): Promise<string> {
  const res = await fetch(apiUrl("diagnostic/reports"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ report, minecraft_name: minecraftName.trim() || null }),
  });
  const data = await parseJson(res);
  if (!res.ok) {
    const detail = detailMessage(data, "");
    throw new Error(SEND_ERRORS[detail] ?? "The report couldn’t be sent. Copy it instead.");
  }
  return (data as { code: string }).code;
}

export type DiagnosticReportRow = {
  code: string;
  created_at: string;
  user_id: number | null;
  discord_name: string | null;
  minecraft_name: string | null;
  country: string | null;
  worst: "fail" | "warn" | "info" | "ok";
  summary: string;
};

export async function listDiagnosticReports(): Promise<DiagnosticReportRow[]> {
  return (await adminRequest<{ reports: DiagnosticReportRow[] }>("/diagnostic/reports")).reports;
}

export function getDiagnosticReport(code: string): Promise<DiagnosticReportRow & { report: unknown }> {
  return adminRequest(`/diagnostic/reports/${encodeURIComponent(code.trim())}`);
}
