/** Network checks the browser can run. Raw game ports are out of reach from a web page. */

export type ServiceCheck = {
  host: string;
  purpose: string;
  ok: boolean;
  ms: number;
  error?: string;
};
export type DnsCheck = { resolver: string; ips: string[]; error?: string };
export type LatencyCheck = {
  medianMs: number | null;
  jitterMs: number | null;
  lost: number;
  sent: number;
};
export type DownloadCheck = {
  ok: boolean;
  bytes: number;
  ms: number;
  mbps: number | null;
  error?: string;
};

/** Hosts Minecraft and its launcher need besides our server. */
export const MINECRAFT_SERVICES: { host: string; purpose: string }[] = [
  { host: "sessionserver.mojang.com", purpose: "Joining servers" },
  { host: "api.minecraftservices.com", purpose: "Chat signing and profile" },
  { host: "login.live.com", purpose: "Microsoft sign-in" },
  { host: "textures.minecraft.net", purpose: "Skins and capes" },
  { host: "piston-meta.mojang.com", purpose: "Launcher game versions" },
  { host: "resources.download.minecraft.net", purpose: "Launcher game files" },
  { host: "libraries.minecraft.net", purpose: "Launcher libraries" },
];

const DOH = [
  { resolver: "Cloudflare", url: "https://cloudflare-dns.com/dns-query" },
  { resolver: "Google", url: "https://dns.google/resolve" },
];

function errorText(err: unknown): string {
  if (err === "cancelled") return "cancelled";
  if (err instanceof DOMException && (err.name === "AbortError" || err.name === "TimeoutError")) return "timed out";
  return err instanceof Error ? err.message : String(err);
}

function timeoutSignal(ms: number, cancel?: AbortSignal): AbortSignal {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  cancel?.addEventListener("abort", () => ctrl.abort(cancel.reason));
  return ctrl.signal;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Mean change between consecutive samples, as games measure jitter. */
export function jitter(values: number[]): number | null {
  if (values.length < 2) return null;
  let total = 0;
  for (let i = 1; i < values.length; i++) total += Math.abs(values[i] - values[i - 1]);
  return total / (values.length - 1);
}

/** An opaque reply still proves DNS, TCP and TLS worked; only a network error throws. */
export async function checkService(host: string, purpose: string): Promise<ServiceCheck> {
  const started = performance.now();
  try {
    await fetch(`https://${host}/?_diag=${Date.now().toString(36)}`, {
      mode: "no-cors",
      cache: "no-store",
      signal: timeoutSignal(8000),
    });
    return { host, purpose, ok: true, ms: Math.round(performance.now() - started) };
  } catch (err) {
    return {
      host,
      purpose,
      ok: false,
      ms: Math.round(performance.now() - started),
      error: errorText(err),
    };
  }
}

export async function checkDns(name: string): Promise<DnsCheck[]> {
  return Promise.all(
    DOH.map(async ({ resolver, url }) => {
      try {
        const res = await fetch(`${url}?name=${encodeURIComponent(name)}&type=A`, {
          headers: { Accept: "application/dns-json" },
          cache: "no-store",
          signal: timeoutSignal(8000),
        });
        const body = (await res.json()) as {
          Status?: number;
          Answer?: { type: number; data: string }[];
        };
        const ips = (body.Answer ?? []).filter((a) => a.type === 1).map((a) => a.data);
        return ips.length ? { resolver, ips } : { resolver, ips, error: `no address (status ${body.Status ?? "?"})` };
      } catch (err) {
        return { resolver, ips: [], error: errorText(err) };
      }
    }),
  );
}

/** Round trips to our API; the first sets up the connection and is dropped. */
export async function checkLatency(url: string, count = 10): Promise<LatencyCheck> {
  const samples: number[] = [];
  let lost = 0;
  for (let i = 0; i <= count; i++) {
    const started = performance.now();
    try {
      const res = await fetch(`${url}?n=${i}-${Date.now()}`, {
        cache: "no-store",
        signal: timeoutSignal(5000),
      });
      await res.arrayBuffer();
      if (i > 0) samples.push(performance.now() - started);
    } catch {
      if (i > 0) lost++;
    }
  }
  const m = median(samples);
  const j = jitter(samples);
  return {
    medianMs: m === null ? null : Math.round(m),
    jitterMs: j === null ? null : Math.round(j),
    lost,
    sent: count,
  };
}

export function mbps(bytes: number, ms: number): number | null {
  return ms > 0 ? Math.round(((bytes * 8) / ms / 1000) * 10) / 10 : null;
}

/** Streams a download, reporting progress, and returns the bytes when keep is set. */
export async function download(
  url: string,
  opts: {
    timeoutMs: number;
    keep?: boolean;
    cancel?: AbortSignal;
    onProgress?: (received: number, total: number) => void;
  },
): Promise<DownloadCheck & { data?: Uint8Array }> {
  const started = performance.now();
  let received = 0;
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: timeoutSignal(opts.timeoutMs, opts.cancel),
    });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const total = Number(res.headers.get("content-length") ?? 0);
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (opts.keep) chunks.push(value);
      opts.onProgress?.(received, total);
    }
    const ms = Math.round(performance.now() - started);
    if (total && received < total) throw new Error(`stopped after ${received} of ${total} bytes`);
    let data: Uint8Array | undefined;
    if (opts.keep) {
      data = new Uint8Array(received);
      let offset = 0;
      for (const c of chunks) {
        data.set(c, offset);
        offset += c.length;
      }
    }
    return { ok: true, bytes: received, ms, mbps: mbps(received, ms), data };
  } catch (err) {
    const ms = Math.round(performance.now() - started);
    return { ok: false, bytes: received, ms, mbps: mbps(received, ms), error: errorText(err) };
  }
}

export async function sha1Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", data as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
