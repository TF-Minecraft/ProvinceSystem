/** What the browser can tell about the computer the player is on. */

export type GpuKind = "software" | "integrated" | "dedicated" | "apple" | "unknown";

export type ComputerInfo = {
  os: string | null;
  arch: string | null;
  bitness: string | null;
  mobile: boolean;
  browser: string | null;
  threads: number | null;
  /** navigator.deviceMemory: rounded down to a power of two and capped at 8 by Chromium. */
  memoryGb: number | null;
  gpu: string | null;
  gpuKind: GpuKind;
  webgl2: boolean;
  maxTextureSize: number | null;
  screen: string;
  refreshHz: number | null;
  timezone: string | null;
  language: string | null;
  connection: string | null;
  saveData: boolean;
  battery: { charging: boolean; level: number } | null;
};

type UaData = {
  mobile?: boolean;
  brands?: { brand: string; version: string }[];
  getHighEntropyValues?: (hints: string[]) => Promise<Record<string, unknown>>;
};

type NavigatorExtras = Navigator & {
  userAgentData?: UaData;
  deviceMemory?: number;
  connection?: { effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean };
  getBattery?: () => Promise<{ charging: boolean; level: number }>;
};

/** Windows 11 reports platformVersion 13 or later; 1-10 is Windows 10 and 0 is 7/8. */
export function windowsName(platformVersion: string): string {
  const major = Number.parseInt(platformVersion, 10);
  if (Number.isNaN(major)) return "Windows";
  if (major >= 13) return "Windows 11";
  if (major > 0) return "Windows 10";
  return "Windows 7 or 8";
}

/** Fallback when User-Agent Client Hints are missing (Firefox, Safari). */
export function osFromUserAgent(ua: string): string | null {
  const win = /Windows NT (\d+\.\d+)/.exec(ua);
  if (win) {
    if (win[1] === "10.0") return "Windows 10 or 11";
    if (win[1] === "6.3" || win[1] === "6.2") return "Windows 8";
    if (win[1] === "6.1") return "Windows 7";
    return `Windows NT ${win[1]}`;
  }
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
  if (/Android/.test(ua)) return "Android";
  if (/CrOS/.test(ua)) return "ChromeOS";
  if (/Mac OS X/.test(ua)) return "macOS";
  if (/Linux/.test(ua)) return "Linux";
  return null;
}

export function browserFromUserAgent(ua: string): string | null {
  const rules: [RegExp, string][] = [
    [/Edg\/(\d+)/, "Edge"],
    [/OPR\/(\d+)/, "Opera"],
    [/Firefox\/(\d+)/, "Firefox"],
    [/Chrome\/(\d+)/, "Chrome"],
    [/Version\/(\d+)[^ ]* .*Safari/, "Safari"],
  ];
  for (const [re, name] of rules) {
    const m = re.exec(ua);
    if (m) return `${name} ${m[1]}`;
  }
  return null;
}

/** Strips the ANGLE wrapper and PCI ids: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x2504) Direct3D11 ...)" → "NVIDIA GeForce RTX 3060". */
export function cleanGpuName(renderer: string): string {
  const angle = /^ANGLE \((?:[^,]+), (.+?)(?: \(0x[0-9a-fA-F]+\))?(?: Direct3D\S*| OpenGL| Metal| Vulkan|,).*\)$/.exec(
    renderer,
  );
  const name = angle ? angle[1] : renderer;
  return name
    .replace(/\s*\(0x[0-9a-fA-F]+\)/g, "")
    .replace(/, or similar$/, "")
    .trim();
}

export function gpuKind(name: string | null): GpuKind {
  if (!name) return "unknown";
  if (/swiftshader|llvmpipe|softpipe|basic render|software|warp/i.test(name)) return "software";
  if (/apple (m\d|gpu)/i.test(name)) return "apple";
  if (/nvidia|geforce|quadro|rtx|gtx|radeon (rx|pro)|\brx \d{3,4}|intel.*arc|arc a\d/i.test(name)) return "dedicated";
  if (/intel|uhd|iris|hd graphics|radeon\(tm\) graphics|radeon graphics|vega \d+|adreno|mali/i.test(name))
    return "integrated";
  return "unknown";
}

function readGpu(): { name: string | null; webgl2: boolean; maxTextureSize: number | null } {
  try {
    const canvas = document.createElement("canvas");
    const gl2 = canvas.getContext("webgl2");
    const gl = gl2 ?? canvas.getContext("webgl");
    if (!gl) return { name: null, webgl2: false, maxTextureSize: null };
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const raw = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return {
      name: typeof raw === "string" && raw ? cleanGpuName(raw) : null,
      webgl2: !!gl2,
      maxTextureSize,
    };
  } catch {
    return { name: null, webgl2: false, maxTextureSize: null };
  }
}

/** Frame rate over about half a second; a busy or hidden tab reads low. */
function measureRefresh(): Promise<number | null> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== "function") return resolve(null);
    const stamps: number[] = [];
    const timeout = setTimeout(() => resolve(null), 2000);
    const step = (t: number) => {
      stamps.push(t);
      if (stamps.length < 31) return requestAnimationFrame(step);
      clearTimeout(timeout);
      const gaps = stamps
        .slice(1)
        .map((s, i) => s - stamps[i])
        .sort((a, b) => a - b);
      const median = gaps[Math.floor(gaps.length / 2)];
      resolve(median > 0 ? Math.round(1000 / median) : null);
    };
    requestAnimationFrame(step);
  });
}

export async function readComputer(): Promise<ComputerInfo> {
  const nav = navigator as NavigatorExtras;
  const ua = nav.userAgent;
  let os = osFromUserAgent(ua);
  let arch: string | null = null;
  let bitness: string | null = null;
  let browser = browserFromUserAgent(ua);
  const uaData = nav.userAgentData;
  if (uaData?.getHighEntropyValues) {
    try {
      const hints = await uaData.getHighEntropyValues([
        "platformVersion",
        "architecture",
        "bitness",
        "fullVersionList",
      ]);
      const platform = String(hints.platform ?? "");
      if (platform === "Windows") os = windowsName(String(hints.platformVersion ?? ""));
      else if (platform === "macOS") os = `macOS ${String(hints.platformVersion ?? "").split(".")[0]}`.trim();
      else if (platform) os = platform === "Chrome OS" ? "ChromeOS" : platform;
      arch = (hints.architecture as string) || null;
      bitness = (hints.bitness as string) || null;
      const brands = (hints.fullVersionList as { brand: string; version: string }[] | undefined) ?? [];
      const brand =
        brands.find((b) => !/Not.?A.?Brand|Chromium/i.test(b.brand)) ?? brands.find((b) => b.brand === "Chromium");
      if (brand)
        browser = `${brand.brand.replace("Google ", "").replace("Microsoft ", "")} ${brand.version.split(".")[0]}`;
    } catch {
      // Hints were refused; the user agent string is enough.
    }
  }
  const gpu = readGpu();
  let battery: ComputerInfo["battery"] = null;
  try {
    const b = await nav.getBattery?.();
    // Desktops report a full, charging battery.
    if (b && !(b.charging && b.level === 1)) battery = { charging: b.charging, level: b.level };
  } catch {
    battery = null;
  }
  const conn = nav.connection;
  const dpr = window.devicePixelRatio || 1;
  return {
    os,
    arch,
    bitness,
    mobile: uaData?.mobile ?? /Mobi|Android|iPhone|iPad/.test(ua),
    browser,
    threads: nav.hardwareConcurrency || null,
    memoryGb: nav.deviceMemory ?? null,
    gpu: gpu.name,
    gpuKind: gpuKind(gpu.name),
    webgl2: gpu.webgl2,
    maxTextureSize: gpu.maxTextureSize,
    screen: `${Math.round(screen.width * dpr)}×${Math.round(screen.height * dpr)}${dpr !== 1 ? ` (${Math.round(dpr * 100)}% scale)` : ""}`,
    refreshHz: await measureRefresh(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
    language: nav.language || null,
    connection: conn?.effectiveType
      ? [conn.effectiveType, conn.downlink ? `~${conn.downlink} Mbit/s` : null, conn.rtt ? `~${conn.rtt} ms` : null]
          .filter(Boolean)
          .join(", ")
      : null,
    saveData: !!conn?.saveData,
    battery,
  };
}
