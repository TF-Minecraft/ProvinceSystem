import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/map/api", () => ({ fetchMapJson: vi.fn() }));

import { fetchMapJson } from "@/lib/map/api";

import { fetchCompiledProvinces } from "./compiledProvinces";

describe("fetchCompiledProvinces", () => {
  beforeEach(() => {
    vi.mocked(fetchMapJson).mockReset();
  });

  it("shares one fetch across concurrent and repeat callers", async () => {
    vi.mocked(fetchMapJson).mockResolvedValue({ 1: { terrain: "plains" } });
    const [a, b] = await Promise.all([
      fetchCompiledProvinces("shared", "tok"),
      fetchCompiledProvinces("shared", "tok"),
    ]);
    const c = await fetchCompiledProvinces("shared", "tok");
    expect(a).toBe(b);
    expect(c).toBe(a);
    expect(vi.mocked(fetchMapJson)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchMapJson)).toHaveBeenCalledWith("/shared/compiled_data/provinces", { sessionToken: "tok" });
  });

  it("keeps maps and access contexts apart, and evicts failures for retry", async () => {
    vi.mocked(fetchMapJson)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ 2: { terrain: "sea" } });
    await expect(fetchCompiledProvinces("flaky")).rejects.toThrow("offline");
    await expect(fetchCompiledProvinces("flaky")).resolves.toEqual({ 2: { terrain: "sea" } });
    expect(vi.mocked(fetchMapJson)).toHaveBeenCalledTimes(2);
  });
});
