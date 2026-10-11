/** Turns check results into plain advice, worst first. */

import type { ComputerInfo } from "./computer";
import type { DnsCheck, DownloadCheck, LatencyCheck, ServiceCheck } from "./network";

export type Level = "fail" | "warn" | "info";
export type Finding = { level: Level; title: string; fix: string };

export type ServerStatus = {
  online: boolean;
  address: string;
  ip: string | null;
  version: string | null;
  players_online: number | null;
  players_max: number | null;
  error: string | null;
};

export type PackStatus = {
  sha1: string;
  size: number;
  url: string;
  fetched_at: string;
  stale: boolean;
} | null;

export type DiagnosticStatus = {
  client: { country: string | null };
  server: ServerStatus;
  pack: PackStatus;
  game_version: string;
};

export type PackCheck = DownloadCheck & { sha1Match: boolean | null };

export type Results = {
  status: DiagnosticStatus | null;
  statusError?: string;
  computer: ComputerInfo | null;
  dns: DnsCheck[];
  services: ServiceCheck[];
  latency: LatencyCheck | null;
  speed: DownloadCheck | null;
  pack: PackCheck | null;
};

/** Seconds to fetch the pack at a measured speed. */
export function packSeconds(sizeBytes: number, mbps: number | null): number | null {
  return mbps && mbps > 0 ? Math.round((sizeBytes * 8) / (mbps * 1_000_000)) : null;
}

const RANK: Record<Level, number> = { fail: 0, warn: 1, info: 2 };

export function findings(r: Results): Finding[] {
  const out: Finding[] = [];
  const add = (level: Level, title: string, fix: string) => out.push({ level, title, fix });
  const c = r.computer;

  if (c?.mobile) add("warn", "This is a phone or tablet", "Open this page on the computer you play Minecraft on.");

  if (!r.status) {
    add(
      "fail",
      "Our website's checks didn't answer",
      "Reload the page. If it keeps failing, your network may be blocking tfminecraft.net.",
    );
  } else {
    const s = r.status.server;
    if (!s.online)
      add(
        "fail",
        "The Minecraft server isn't answering",
        "This is on our side, not yours. Check Discord for news and try again later.",
      );
    const expected = s.ip;
    const answered = r.dns.filter((d) => d.ips.length);
    if (r.dns.length && !answered.length) {
      add(
        "fail",
        `${s.address.split(":")[0]} can't be looked up`,
        "Your network is blocking DNS lookups. Change your DNS to 1.1.1.1 or 8.8.8.8.",
      );
    } else if (expected && answered.some((d) => !d.ips.includes(expected))) {
      add(
        "warn",
        "DNS gives a different server address",
        `Expected ${expected}. Restart your router, or change your DNS to 1.1.1.1.`,
      );
    }
    if (!r.status.pack)
      add(
        "warn",
        "The website has no copy of the resource pack",
        "Tell staff: the site couldn't fetch the pack from the game server.",
      );
  }

  const blocked = r.services.filter((s) => !s.ok);
  if (blocked.length) {
    const names = blocked.map((s) => s.purpose.toLowerCase()).join(", ");
    add(
      blocked.some((s) => s.host === "sessionserver.mojang.com" || s.host === "login.live.com") ? "fail" : "warn",
      `Can't reach Minecraft services: ${names}`,
      "A firewall, antivirus, VPN or school/work network may be blocking them. Try another network or turn the VPN off.",
    );
  }

  if (r.latency) {
    const { medianMs, jitterMs, lost, sent } = r.latency;
    if (lost === sent)
      add(
        "fail",
        "Every round trip to our server failed",
        "Your connection dropped during the test. Check it and run the test again.",
      );
    else if (lost > 0)
      add(
        "warn",
        `${lost} of ${sent} round trips were lost`,
        "Your connection is dropping packets. Use a cable instead of Wi-Fi if you can.",
      );
    if (medianMs !== null && medianMs > 300)
      add(
        "warn",
        `High round trip to our server (${medianMs} ms)`,
        "Expect lag. Our server is in Germany; a cable or a closer network route helps.",
      );
    if (jitterMs !== null && jitterMs > 50)
      add(
        "warn",
        `Unsteady connection (jitter ${jitterMs} ms)`,
        "Close downloads and streams, and use a cable instead of Wi-Fi if you can.",
      );
  }

  const size = r.status?.pack?.size ?? 0;
  if (r.pack) {
    if (!r.pack.ok)
      add(
        "fail",
        "The resource pack download failed",
        `${r.pack.error ?? "Unknown error"}. Try again on another network, or with your VPN off.`,
      );
    else if (r.pack.sha1Match === false)
      add(
        "fail",
        "The resource pack arrived damaged",
        "Something between you and us changed the file: often antivirus web scanning or a proxy. Turn it off and try again.",
      );
  } else if (r.speed?.ok && size) {
    const secs = packSeconds(size, r.speed.mbps);
    if (secs !== null && secs > 120)
      add(
        "warn",
        `The resource pack will take about ${Math.round(secs / 60)} minutes to download`,
        "If Minecraft gives up, download the pack below and add it yourself.",
      );
  } else if (r.speed && !r.speed.ok) {
    add("warn", "The speed test failed", `${r.speed.error ?? "Unknown error"}. Your connection may be unstable.`);
  }

  if (c) {
    if (c.gpuKind === "software")
      add(
        "fail",
        "No graphics driver is in use",
        `The browser draws with "${c.gpu}". Install the latest driver from your graphics card maker (NVIDIA, AMD or Intel).`,
      );
    if (c.bitness === "32")
      add("fail", "This is a 32-bit system", "Minecraft Java needs 64-bit Windows, macOS or Linux.");
    if (c.os === "Windows 7 or 8" || c.os === "Windows 7" || c.os === "Windows 8")
      add("warn", `${c.os} is no longer supported`, "Recent Minecraft and Java versions need Windows 10 or later.");
    if (c.memoryGb !== null && c.memoryGb <= 2)
      add(
        "fail",
        "This computer has very little memory",
        "Minecraft with our resource pack needs at least 8 GB of RAM.",
      );
    else if (c.memoryGb !== null && c.memoryGb <= 4)
      add(
        "warn",
        "This computer has little memory",
        "Close other programs, and give Minecraft 4 GB in the launcher's installation settings.",
      );
    if (c.threads !== null && c.threads < 4)
      add("warn", `Only ${c.threads} processor threads`, "Lower render and simulation distance in Video Settings.");
    if (c.gpuKind === "integrated")
      add(
        "info",
        "Built-in graphics",
        "Fine for TFMC on lower settings. If your laptop also has an NVIDIA or AMD card, set Java to use it in Windows Graphics settings.",
      );
    if (c.battery && !c.battery.charging)
      add("info", "Running on battery", "Laptops slow down on battery. Plug in while you play.");
    if (c.saveData)
      add("info", "Data saver is on", "Your browser or phone is limiting data use, which can slow downloads.");
  }

  return out.sort((a, b) => RANK[a.level] - RANK[b.level]);
}
