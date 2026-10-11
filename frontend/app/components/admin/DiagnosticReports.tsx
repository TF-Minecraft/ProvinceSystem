"use client";

import { FormEvent, useEffect, useState } from "react";

import DiagnosticSections, { FindingList } from "@/app/components/diagnostic/DiagnosticSections";
import { adminErrorMessage } from "@/lib/admin/api";
import { writeUrl } from "@/lib/admin/urlState";
import { getDiagnosticReport, type DiagnosticReportRow } from "@/lib/diagnostic/api";
import type { Finding, Results } from "@/lib/diagnostic/findings";
import { sections } from "@/lib/diagnostic/rows";
import { formatLocal } from "@/lib/skins/formatTime";
import { badgeClass, buttonClass, errorClass, headingClass, inputClass, mutedClass, panelClass, rowClass } from "./ui";

const TONE: Record<DiagnosticReportRow["worst"], string> = {
  fail: "bg-[#5a2a2a] text-[#f0c0c0]",
  warn: "bg-[#5a4a2a] text-[#f0e0b0]",
  info: "bg-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] text-[var(--tfmc-mist)]",
  ok: "bg-[#2a4a2e] text-[#b8e0b0]",
};
const LABEL: Record<DiagnosticReportRow["worst"], string> = {
  fail: "Problem",
  warn: "Warning",
  info: "Note",
  ok: "OK",
};

type Opened = DiagnosticReportRow & { report: unknown };

function who(row: DiagnosticReportRow): string {
  return [row.minecraft_name, row.discord_name && `@${row.discord_name}`].filter(Boolean).join(" · ") || "Not named";
}

/** Players send the report, so check its shape before laying it out. */
function readReport(raw: unknown): { results: Results; findings: Finding[]; userAgent: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { results?: Partial<Results>; findings?: unknown; user_agent?: unknown };
  const res = r.results;
  if (!res || typeof res !== "object") return null;
  const list = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    results: {
      status: res.status ?? null,
      computer: res.computer ?? null,
      dns: list(res.dns),
      services: list(res.services),
      latency: res.latency ?? null,
      speed: res.speed ?? null,
      pack: res.pack ?? null,
    },
    findings: list<Finding>(r.findings).filter((f) => f && typeof f.title === "string"),
    userAgent: typeof r.user_agent === "string" ? r.user_agent : "",
  };
}

function ReportView({ opened }: { opened: Opened }) {
  const parsed = readReport(opened.report);
  let laidOut: ReturnType<typeof sections> | null = null;
  try {
    laidOut = parsed ? sections(parsed.results, false) : null;
  } catch {
    laidOut = null;
  }
  return (
    <section className={panelClass}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className={`${headingClass} font-mono tracking-widest`}>{opened.code}</h2>
        <span className={`${badgeClass} ${TONE[opened.worst]}`}>{LABEL[opened.worst]}</span>
      </div>
      <p className={`mt-1 ${mutedClass}`}>
        {who(opened)}
        {opened.country ? ` · ${opened.country}` : ""} · {formatLocal(opened.created_at)}
      </p>
      {parsed?.userAgent ? <p className="mt-1 break-all text-xs text-[var(--tfmc-stone)]">{parsed.userAgent}</p> : null}
      {parsed?.findings.length ? (
        <div className="mt-5">
          <FindingList items={parsed.findings} />
        </div>
      ) : null}
      <div className="mt-6">
        {laidOut ? (
          <DiagnosticSections sections={laidOut} />
        ) : (
          <pre className="overflow-x-auto text-xs text-[var(--tfmc-stone)]">
            {JSON.stringify(opened.report, null, 2)}
          </pre>
        )}
      </div>
    </section>
  );
}

export default function DiagnosticReports({ initial }: { initial: DiagnosticReportRow[] }) {
  const [code, setCode] = useState("");
  const [opened, setOpened] = useState<Opened | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function open(wanted: string, push = true) {
    const clean = wanted.trim().toUpperCase();
    if (!clean) return;
    setLoading(true);
    setError(null);
    try {
      setOpened(await getDiagnosticReport(clean));
      if (push) writeUrl(`?code=${encodeURIComponent(clean)}`, false);
    } catch (err) {
      setOpened(null);
      setError(adminErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("code");
    if (fromUrl) {
      const start = setTimeout(() => {
        setCode(fromUrl);
        void open(fromUrl, false);
      }, 0);
      return () => clearTimeout(start);
    }
  }, []);

  function submit(e: FormEvent) {
    e.preventDefault();
    void open(code);
  }

  return (
    <>
      <section className={panelClass}>
        <h2 className={headingClass}>Diagnostic reports</h2>
        <p className={`mt-1 ${mutedClass}`}>
          Players run tfminecraft.net/diagnostic and send you a code. Reports are kept for 30 days.
        </p>
        <form className="mt-4 flex flex-wrap gap-2" onSubmit={submit}>
          <input
            className={`${inputClass} w-40 font-mono uppercase tracking-widest`}
            placeholder="Code"
            aria-label="Report code"
            maxLength={8}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <button type="submit" className={buttonClass} disabled={loading || !code.trim()}>
            {loading ? "Opening…" : "Open"}
          </button>
        </form>
        {error ? (
          <p className={`mt-3 ${errorClass}`} role="alert">
            {error}
          </p>
        ) : null}
      </section>

      {opened ? <ReportView opened={opened} /> : null}

      <section className={panelClass}>
        <h2 className={headingClass}>Recent</h2>
        {initial.length ? (
          <ul className={`mt-2 ${rowClass}`}>
            {initial.map((row) => (
              <li key={row.code}>
                <button
                  type="button"
                  className="grid w-full grid-cols-[5.5rem_4.5rem_1fr] items-baseline gap-x-3 py-2 text-left text-sm hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_5%,transparent)] sm:grid-cols-[5.5rem_4.5rem_12rem_1fr_auto]"
                  onClick={() => {
                    setCode(row.code);
                    void open(row.code);
                  }}
                >
                  <span className="font-mono tracking-wider text-[var(--tfmc-cream)]">{row.code}</span>
                  <span className={`${badgeClass} w-fit ${TONE[row.worst]}`}>{LABEL[row.worst]}</span>
                  <span className="truncate text-[var(--tfmc-cream)]">{who(row)}</span>
                  <span className="col-span-3 truncate text-[var(--tfmc-mist)] sm:col-span-1">{row.summary}</span>
                  <span className="hidden whitespace-nowrap text-xs text-[var(--tfmc-stone)] sm:inline">
                    {formatLocal(row.created_at)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className={`mt-2 ${mutedClass}`}>No reports yet.</p>
        )}
      </section>
    </>
  );
}
