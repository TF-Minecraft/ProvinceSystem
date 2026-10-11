import { describe, expect, it } from "vitest";

import type { ComputerInfo } from "./computer";
import { findings, packSeconds, type Results } from "./findings";
import { buildReport, reportText, sections } from "./rows";

const COMPUTER: ComputerInfo = {
  os: "Windows 11",
  arch: "x86",
  bitness: "64",
  mobile: false,
  browser: "Chrome 129",
  threads: 12,
  memoryGb: 8,
  gpu: "NVIDIA GeForce RTX 3060",
  gpuKind: "dedicated",
  webgl2: true,
  maxTextureSize: 16384,
  screen: "1920×1080",
  refreshHz: 144,
  timezone: "Asia/Manila",
  language: "en-PH",
  connection: null,
  saveData: false,
  battery: null,
};

const HEALTHY: Results = {
  status: {
    client: { country: "PH" },
    server: {
      online: true,
      address: "play.tfminecraft.net:25565",
      ip: "188.40.119.246",
      version: "Velocity",
      players_online: 20,
      players_max: 100,
      error: null,
    },
    pack: {
      sha1: "a".repeat(40),
      size: 66_000_000,
      url: "diagnostic/pack/x.zip",
      fetched_at: "2026-10-11T06:18:00Z",
      stale: false,
    },
    game_version: "1.21.10",
  },
  computer: COMPUTER,
  dns: [
    { resolver: "Cloudflare", ips: ["188.40.119.246"] },
    { resolver: "Google", ips: ["188.40.119.246"] },
  ],
  services: [{ host: "sessionserver.mojang.com", purpose: "Joining servers", ok: true, ms: 80 }],
  latency: { medianMs: 40, jitterMs: 3, lost: 0, sent: 10 },
  speed: { ok: true, bytes: 8 << 20, ms: 800, mbps: 83.9 },
  pack: null,
};

const titles = (r: Results) => findings(r).map((f) => f.title);

describe("findings", () => {
  it("finds nothing on a healthy setup", () => {
    expect(findings(HEALTHY)).toEqual([]);
  });

  it("estimates the pack download time", () => {
    expect(packSeconds(66_000_000, 2)).toBe(264);
    expect(packSeconds(66_000_000, null)).toBeNull();
  });

  it("puts the worst first and explains a slow, failing pack download", () => {
    const r: Results = {
      ...HEALTHY,
      computer: { ...COMPUTER, gpuKind: "integrated", gpu: "Intel(R) UHD Graphics 620" },
      latency: { medianMs: 320, jitterMs: 80, lost: 2, sent: 10 },
      pack: { ok: false, bytes: 1000, ms: 30000, mbps: 0, error: "timed out", sha1Match: null },
    };
    const found = findings(r);
    expect(found[0]).toMatchObject({ level: "fail", title: "The resource pack download failed" });
    expect(found.at(-1)).toMatchObject({ level: "info", title: "Built-in graphics" });
    expect(titles(r)).toContain("High round trip to our server (320 ms)");
    expect(titles(r)).toContain("2 of 10 round trips were lost");
  });

  it("warns before the pack test when the speed test is slow", () => {
    expect(titles({ ...HEALTHY, speed: { ok: true, bytes: 8 << 20, ms: 40000, mbps: 1.7 } })).toEqual([
      "The resource pack will take about 5 minutes to download",
    ]);
  });

  it("spots a damaged pack, a DNS mismatch and blocked sign-in", () => {
    const r: Results = {
      ...HEALTHY,
      dns: [{ resolver: "Cloudflare", ips: ["10.0.0.1"] }],
      services: [
        {
          host: "login.live.com",
          purpose: "Microsoft sign-in",
          ok: false,
          ms: 8000,
          error: "timed out",
        },
      ],
      pack: { ok: true, bytes: 66_000_000, ms: 9000, mbps: 58, sha1Match: false },
    };
    expect(titles(r)).toEqual([
      "Can't reach Minecraft services: microsoft sign-in",
      "The resource pack arrived damaged",
      "DNS gives a different server address",
    ]);
  });

  it("flags computers that can't run the game well", () => {
    const r: Results = {
      ...HEALTHY,
      computer: {
        ...COMPUTER,
        gpuKind: "software",
        gpu: "Microsoft Basic Render Driver",
        bitness: "32",
        memoryGb: 2,
        threads: 2,
      },
    };
    expect(titles(r)).toEqual([
      "No graphics driver is in use",
      "This is a 32-bit system",
      "This computer has very little memory",
      "Only 2 processor threads",
    ]);
  });

  it("blames the server, not the player, when it is down", () => {
    const status = HEALTHY.status!;
    const r = {
      ...HEALTHY,
      status: { ...status, server: { ...status.server, online: false, error: "refused" } },
    };
    expect(titles(r)[0]).toBe("The Minecraft server isn't answering");
  });
});

describe("report", () => {
  it("lays out every section and copies as text", () => {
    const laid = sections(HEALTHY, false);
    expect(laid.map((s) => s.title)).toEqual([
      "Minecraft server",
      "Your connection",
      "Resource pack",
      "Mojang and Microsoft",
      "This computer",
    ]);
    expect(laid[0].rows[0]).toEqual({
      label: "Server",
      status: "pass",
      detail: "Online, 20 of 100 players",
    });
    expect(laid[2].rows[1]).toEqual({ label: "Download test", status: "info", detail: "Not run" });
    const text = reportText(buildReport(HEALTHY, "UA", new Date("2026-10-11T12:00:00Z")));
    expect(text).toContain("Date: 2026-10-11T12:00:00.000Z");
    expect(text).toContain("       Address: play.tfminecraft.net, Minecraft Java 1.21.10");
    expect(text).toContain("  OK   Round trip to TFMC: 40 ms, jitter 3 ms");
    expect(text).not.toContain("Found:");
  });

  it("shows pending rows while checks run", () => {
    const laid = sections({ ...HEALTHY, status: null, latency: null, speed: null, services: [], computer: null }, true);
    expect(laid.flatMap((s) => s.rows).every((r) => r.status === "pending")).toBe(true);
  });
});
