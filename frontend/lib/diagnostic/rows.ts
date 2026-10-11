/** Lays check results out as labelled rows, for the page, the staff view and the copied report. */

import { findings, packSeconds, type Finding, type Results } from "./findings";

export type RowStatus = "pass" | "warn" | "fail" | "info" | "pending";
export type Row = { label: string; status: RowStatus; detail: string };
export type Section = { title: string; rows: Row[] };

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function formatDuration(seconds: number): string {
  return seconds < 90 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
}

const pending = (label: string, detail = "Checking…"): Row => ({
  label,
  status: "pending",
  detail,
});

export function sections(r: Results, running: boolean): Section[] {
  const s = r.status;
  const server: Row[] = [];
  if (s) {
    const host = s.server.address.replace(/:25565$/, "");
    server.push(
      s.server.online
        ? {
            label: "Server",
            status: "pass",
            detail: `Online, ${s.server.players_online ?? "?"} of ${s.server.players_max ?? "?"} players`,
          }
        : {
            label: "Server",
            status: "fail",
            detail: `Not answering (${s.server.error ?? "no reply"})`,
          },
      { label: "Address", status: "info", detail: `${host}, Minecraft Java ${s.game_version}` },
    );
    for (const d of r.dns) {
      const ok = d.ips.length > 0 && (!s.server.ip || d.ips.includes(s.server.ip));
      server.push({
        label: `DNS via ${d.resolver}`,
        status: d.error ? "fail" : ok ? "pass" : "warn",
        detail: d.error ?? (ok ? d.ips.join(", ") : `${d.ips.join(", ")}, expected ${s.server.ip}`),
      });
    }
    if (!r.dns.length && running) server.push(pending("DNS"));
  } else {
    server.push(
      r.statusError
        ? { label: "Server", status: "fail", detail: `Checks unavailable (${r.statusError})` }
        : pending("Server"),
    );
  }

  const connection: Row[] = [];
  const timezone = r.computer?.timezone;
  if (s || timezone)
    connection.push({
      label: "Location",
      status: "info",
      detail: [s?.client.country, timezone].filter(Boolean).join(", ") || "Unknown",
    });
  if (r.latency) {
    const { medianMs, jitterMs, lost, sent } = r.latency;
    connection.push({
      label: "Round trip to TFMC",
      status: medianMs === null ? "fail" : lost || medianMs > 300 || (jitterMs ?? 0) > 50 ? "warn" : "pass",
      detail:
        medianMs === null
          ? "Every attempt failed"
          : `${medianMs} ms, jitter ${jitterMs ?? 0} ms${lost ? `, ${lost} of ${sent} lost` : ""}`,
    });
  } else if (running) connection.push(pending("Round trip to TFMC"));
  if (r.speed) {
    const size = s?.pack?.size;
    const secs = size ? packSeconds(size, r.speed.mbps) : null;
    connection.push(
      r.speed.ok
        ? {
            label: "Download speed",
            status: secs !== null && secs > 120 ? "warn" : "pass",
            detail: `${r.speed.mbps ?? "?"} Mbit/s${secs !== null ? `; the resource pack takes about ${formatDuration(secs)}` : ""}`,
          }
        : {
            label: "Download speed",
            status: "fail",
            detail: `Failed after ${formatBytes(r.speed.bytes)}: ${r.speed.error}`,
          },
    );
  } else if (running) connection.push(pending("Download speed"));
  if (r.computer?.connection)
    connection.push({ label: "Browser estimate", status: "info", detail: r.computer.connection });

  const pack: Row[] = [];
  if (s?.pack) {
    pack.push({
      label: "Current pack",
      status: s.pack.stale ? "warn" : "pass",
      detail: `${formatBytes(s.pack.size)}, SHA-1 ${s.pack.sha1.slice(0, 12)}…${s.pack.stale ? " (couldn’t refresh from the game server)" : ""}`,
    });
  } else if (s) pack.push({ label: "Current pack", status: "fail", detail: "The website has no copy" });
  if (r.pack) {
    pack.push(
      r.pack.ok
        ? {
            label: "Download test",
            status: r.pack.sha1Match === false ? "fail" : "pass",
            detail: `${formatBytes(r.pack.bytes)} in ${formatMs(r.pack.ms)} (${r.pack.mbps ?? "?"} Mbit/s), ${
              r.pack.sha1Match === false ? "file damaged on the way" : "file intact"
            }`,
          }
        : {
            label: "Download test",
            status: "fail",
            detail: `Failed after ${formatBytes(r.pack.bytes)}: ${r.pack.error}`,
          },
    );
  } else if (s?.pack) pack.push({ label: "Download test", status: "info", detail: "Not run" });

  const services: Row[] = r.services.map((c) => ({
    label: c.purpose,
    status: c.ok ? "pass" : "fail",
    detail: c.ok ? `${c.host}, ${formatMs(c.ms)}` : `${c.host}: ${c.error}`,
  }));
  if (!services.length && running) services.push(pending("Mojang and Microsoft"));

  const computer: Row[] = [];
  const c = r.computer;
  if (c) {
    const sys = [c.os, c.arch && c.bitness ? `${c.arch} ${c.bitness}-bit` : c.bitness ? `${c.bitness}-bit` : null]
      .filter(Boolean)
      .join(", ");
    computer.push({
      label: "System",
      status: c.bitness === "32" || /Windows 7|Windows 8/.test(c.os ?? "") ? "warn" : c.mobile ? "warn" : "info",
      detail: `${sys || "Unknown"}${c.mobile ? " (phone or tablet)" : ""}`,
    });
    if (c.browser) computer.push({ label: "Browser", status: "info", detail: c.browser });
    computer.push({
      label: "Processor",
      status: c.threads !== null && c.threads < 4 ? "warn" : "info",
      detail: c.threads ? `${c.threads} threads` : "Unknown",
    });
    computer.push({
      label: "Memory",
      status: c.memoryGb !== null && c.memoryGb <= 4 ? "warn" : "info",
      detail:
        c.memoryGb === null ? "Not shown by this browser" : c.memoryGb >= 8 ? "8 GB or more" : `About ${c.memoryGb} GB`,
    });
    computer.push({
      label: "Graphics",
      status: c.gpuKind === "software" ? "fail" : "info",
      detail: c.gpu
        ? `${c.gpu}${c.gpuKind === "software" ? " (no graphics driver)" : c.gpuKind === "integrated" ? " (built in)" : ""}`
        : "Not shown by this browser",
    });
    computer.push({
      label: "Graphics support",
      status: "info",
      detail: `WebGL ${c.webgl2 ? "2" : "1 only"}${c.maxTextureSize ? `, textures up to ${c.maxTextureSize}px` : ""}`,
    });
    computer.push({
      label: "Screen",
      status: "info",
      detail: `${c.screen}${c.refreshHz ? `, ${c.refreshHz} Hz` : ""}`,
    });
    if (c.battery)
      computer.push({
        label: "Battery",
        status: c.battery.charging ? "info" : "warn",
        detail: `${Math.round(c.battery.level * 100)}%, ${c.battery.charging ? "charging" : "on battery"}`,
      });
  } else if (running) computer.push(pending("Computer"));

  return [
    { title: "Minecraft server", rows: server },
    { title: "Your connection", rows: connection },
    { title: "Resource pack", rows: pack },
    { title: "Mojang and Microsoft", rows: services },
    { title: "This computer", rows: computer },
  ];
}

export type DiagnosticReport = {
  version: 1;
  created_at: string;
  user_agent: string;
  results: Results;
  findings: Finding[];
};

export function buildReport(results: Results, userAgent: string, now = new Date()): DiagnosticReport {
  return {
    version: 1,
    created_at: now.toISOString(),
    user_agent: userAgent,
    results,
    findings: findings(results),
  };
}

const MARK: Record<RowStatus, string> = {
  pass: "OK  ",
  warn: "WARN",
  fail: "FAIL",
  info: "    ",
  pending: "... ",
};

export function reportText(report: DiagnosticReport): string {
  const lines = ["TFMC diagnostic", `Date: ${report.created_at}`, `Browser: ${report.user_agent}`, ""];
  if (report.findings.length) {
    lines.push("Found:");
    for (const f of report.findings) lines.push(`  [${f.level.toUpperCase()}] ${f.title}`);
    lines.push("");
  }
  for (const section of sections(report.results, false)) {
    if (!section.rows.length) continue;
    lines.push(`${section.title}:`);
    for (const row of section.rows) lines.push(`  ${MARK[row.status]} ${row.label}: ${row.detail}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}
