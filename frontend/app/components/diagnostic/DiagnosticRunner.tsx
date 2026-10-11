"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { buttonClass, inputClass, quietButtonClass } from "@/app/components/admin/ui";
import { readComputer } from "@/lib/diagnostic/computer";
import { apiUrl, getDiagnosticStatus, sendDiagnosticReport } from "@/lib/diagnostic/api";
import { findings, type Results } from "@/lib/diagnostic/findings";
import { checkDns, checkLatency, checkService, download, MINECRAFT_SERVICES, sha1Hex } from "@/lib/diagnostic/network";
import { buildReport, formatBytes, reportText, sections } from "@/lib/diagnostic/rows";
import DiagnosticSections, { FindingList } from "./DiagnosticSections";

const EMPTY: Results = {
  status: null,
  computer: null,
  dns: [],
  services: [],
  latency: null,
  speed: null,
  pack: null,
};
const DEFAULT_HOST = "play.tfminecraft.net";

type PackRun = { received: number; total: number; cancel: AbortController } | null;
type Send = { state: "idle" | "sending" | "sent" | "error"; code?: string; error?: string };

export default function DiagnosticRunner() {
  const [results, setResults] = useState<Results>(EMPTY);
  const [running, setRunning] = useState(false);
  const [packRun, setPackRun] = useState<PackRun>(null);
  const [packBlob, setPackBlob] = useState<string | null>(null);
  const [send, setSend] = useState<Send>({ state: "idle" });
  const [name, setName] = useState("");
  const [copied, setCopied] = useState(false);
  const runId = useRef(0);

  const update = useCallback((id: number, patch: Partial<Results>) => {
    if (runId.current === id) setResults((r) => ({ ...r, ...patch }));
  }, []);

  const runAll = useCallback(async () => {
    const id = ++runId.current;
    setRunning(true);
    setSend({ state: "idle" });
    setResults((r) => ({ ...EMPTY, pack: r.pack }));

    const computer = readComputer().then((computer) => update(id, { computer }));
    let host = DEFAULT_HOST;
    try {
      const status = await getDiagnosticStatus();
      host = status.server.address.split(":")[0] || DEFAULT_HOST;
      update(id, { status });
    } catch (err) {
      update(id, { statusError: err instanceof Error ? err.message : String(err) });
    }
    const dns = checkDns(host).then((dns) => update(id, { dns }));
    const services = Promise.all(MINECRAFT_SERVICES.map((s) => checkService(s.host, s.purpose))).then((services) =>
      update(id, { services }),
    );
    // One after the other, so the speed test doesn't skew the round trips.
    const latency = await checkLatency(apiUrl("ping"));
    update(id, { latency });
    const speed = await download(apiUrl(`diagnostic/speed?n=${Date.now()}`), { timeoutMs: 60_000 });
    update(id, { speed });
    await Promise.all([computer, dns, services]);
    if (runId.current === id) setRunning(false);
  }, [update]);

  useEffect(() => {
    const start = setTimeout(() => void runAll(), 0);
    return () => clearTimeout(start);
  }, [runAll]);

  useEffect(
    () => () => {
      if (packBlob) URL.revokeObjectURL(packBlob);
    },
    [packBlob],
  );

  const pack = results.status?.pack ?? null;

  async function testPack() {
    if (!pack) return;
    const cancel = new AbortController();
    setPackRun({ received: 0, total: pack.size, cancel });
    const { data, ...check } = await download(apiUrl(pack.url), {
      timeoutMs: 15 * 60_000,
      keep: true,
      cancel: cancel.signal,
      onProgress: (received, total) => setPackRun((p) => p && { ...p, received, total: total || pack.size }),
    });
    let sha1Match: boolean | null = null;
    if (check.ok && data) {
      sha1Match = (await sha1Hex(data)) === pack.sha1;
      if (sha1Match) setPackBlob(URL.createObjectURL(new Blob([data as BlobPart], { type: "application/zip" })));
    }
    setResults((r) => ({ ...r, pack: { ...check, sha1Match } }));
    setPackRun(null);
  }

  const report = () => buildReport(results, navigator.userAgent);
  const found = findings(results);

  async function copyReport() {
    try {
      await navigator.clipboard.writeText(reportText(report()));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  async function sendReport() {
    setSend({ state: "sending" });
    try {
      setSend({ state: "sent", code: await sendDiagnosticReport(report(), name) });
    } catch (err) {
      setSend({ state: "error", error: err instanceof Error ? err.message : String(err) });
    }
  }

  const packTools = pack ? (
    <div className="mt-3 flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        {packRun ? (
          <>
            <progress
              className="h-2 w-48 accent-[var(--tfmc-accent)]"
              max={packRun.total || 1}
              value={packRun.received}
              aria-label="Resource pack download"
            />
            <span className="tabular-nums text-[var(--tfmc-mist)]">
              {formatBytes(packRun.received)} of {formatBytes(packRun.total)}
            </span>
            <button type="button" className={quietButtonClass} onClick={() => packRun.cancel.abort("cancelled")}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" className={buttonClass} onClick={() => void testPack()}>
            {results.pack ? "Test again" : `Test the download (${formatBytes(pack.size)})`}
          </button>
        )}
        <a className={quietButtonClass} href={packBlob ?? apiUrl(pack.url)} download="TFMC-resource-pack.zip">
          Download the pack
        </a>
      </div>
      <details className="text-[var(--tfmc-stone)]">
        <summary className="cursor-pointer text-[var(--tfmc-mist)] hover:text-[var(--tfmc-cream)]">
          Install it yourself if it won’t load in game
        </summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Download the pack. Don’t unzip it.</li>
          <li>In Minecraft, open Options → Resource Packs → Open Pack Folder, and put the file there.</li>
          <li>Move TFMC-resource-pack to the Selected side and press Done.</li>
          <li>When the server download works again, remove it: your copy won’t get updates.</li>
        </ol>
      </details>
    </div>
  ) : null;

  return (
    <div className="mt-8 flex flex-col gap-10">
      <section aria-live="polite" aria-label="Summary">
        {running ? (
          <p className="text-[var(--tfmc-mist)]">Checking…</p>
        ) : found.length ? (
          <FindingList items={found} />
        ) : (
          <p className="rounded-sm border border-[var(--tfmc-accent)]/60 bg-[var(--tfmc-accent)]/10 px-4 py-3 text-[var(--tfmc-cream)]">
            No problems found.
          </p>
        )}
      </section>

      <DiagnosticSections sections={sections(results, running)} extra={{ "Resource pack": packTools }} />

      <section
        aria-label="Send to staff"
        className="flex flex-col gap-3 border-t border-[color-mix(in_srgb,var(--tfmc-cream)_14%,transparent)] pt-6"
      >
        {send.state === "sent" ? (
          <p className="text-[var(--tfmc-cream)]">
            Sent. Put this code in your ticket:{" "}
            <strong className="select-all rounded-sm bg-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] px-2 py-0.5 font-mono text-lg tracking-widest">
              {send.code}
            </strong>
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <input
              className={`${inputClass} w-56`}
              placeholder="Minecraft name (optional)"
              aria-label="Minecraft name"
              maxLength={16}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button
              type="button"
              className={buttonClass}
              disabled={running || send.state === "sending"}
              onClick={() => void sendReport()}
            >
              {send.state === "sending" ? "Sending…" : "Send to staff"}
            </button>
          </div>
        )}
        {send.state === "error" ? (
          <p className="text-sm text-[#e8a0a0]" role="alert">
            {send.error}
          </p>
        ) : null}
        <div className="flex gap-5">
          <button type="button" className={quietButtonClass} disabled={running} onClick={() => void copyReport()}>
            {copied ? "Copied" : "Copy report"}
          </button>
          <button type="button" className={quietButtonClass} disabled={running} onClick={() => void runAll()}>
            Run again
          </button>
        </div>
      </section>
    </div>
  );
}
