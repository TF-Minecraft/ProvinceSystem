import { describe, expect, it } from "vitest";

import { browserFromUserAgent, cleanGpuName, gpuKind, osFromUserAgent, windowsName } from "./computer";

describe("computer", () => {
  it("names Windows from the client hint version", () => {
    expect(windowsName("15.0.0")).toBe("Windows 11");
    expect(windowsName("10.0.0")).toBe("Windows 10");
    expect(windowsName("0.3.0")).toBe("Windows 7 or 8");
  });

  it("falls back to the user agent", () => {
    expect(osFromUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0")).toBe(
      "Windows 10 or 11",
    );
    expect(osFromUserAgent("Mozilla/5.0 (Windows NT 6.1; Win64; x64)")).toBe("Windows 7");
    expect(osFromUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe("iOS");
    expect(osFromUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("macOS");
    expect(browserFromUserAgent("Mozilla/5.0 (Windows NT 10.0) Gecko/20100101 Firefox/131.0")).toBe("Firefox 131");
    expect(browserFromUserAgent("Mozilla/5.0 Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0")).toBe("Edge 129");
  });

  it("cleans and sorts graphics names", () => {
    const nvidia = cleanGpuName("ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11)");
    expect(nvidia).toBe("NVIDIA GeForce RTX 3060");
    expect(gpuKind(nvidia)).toBe("dedicated");
    const intel = cleanGpuName("ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)");
    expect(intel).toBe("Intel(R) UHD Graphics 620");
    expect(gpuKind(intel)).toBe("integrated");
    expect(
      gpuKind(
        cleanGpuName("ANGLE (Microsoft, Microsoft Basic Render Driver (0x0000008C) Direct3D11 vs_5_0 ps_5_0, D3D11)"),
      ),
    ).toBe("software");
    expect(
      gpuKind("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)"),
    ).toBe("software");
    expect(gpuKind("llvmpipe (LLVM 15.0.7, 256 bits)")).toBe("software");
    expect(gpuKind(cleanGpuName("NVIDIA GeForce GTX 980, or similar"))).toBe("dedicated");
    expect(gpuKind("Apple M2")).toBe("apple");
    expect(gpuKind("AMD Radeon RX 6700 XT")).toBe("dedicated");
    expect(gpuKind("AMD Radeon(TM) Graphics")).toBe("integrated");
    expect(gpuKind(null)).toBe("unknown");
  });
});
