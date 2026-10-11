import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { editorUrl, probeCanEditMap } from "@/lib/map/editorAccess";
import * as api from "@/lib/map/api";

describe("editorAccess", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://api.test");
    vi.stubEnv("NEXT_PUBLIC_CHARACTER_UI_DEV", "");
    vi.stubEnv("NEXT_PUBLIC_MAP_EDITOR_ENABLED", "");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("editorUrl encodes map query param", () => {
    expect(editorUrl("main")).toBe("/map/editor?map=main");
    expect(editorUrl("dev")).toBe("/map/editor?map=dev");
  });

  it("probeCanEditMap returns false when editor product gate is off", async () => {
    const fetchSpy = vi.spyOn(api, "fetchMapApi");

    await expect(probeCanEditMap("main", "staff-token")).resolves.toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("probeCanEditMap returns true on 200 when editor enabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_MAP_EDITOR_ENABLED", "1");
    vi.spyOn(api, "fetchMapApi").mockResolvedValue(new Response(JSON.stringify({ provinces: [] }), { status: 200 }));

    await expect(probeCanEditMap("main", "staff-token")).resolves.toBe(true);
    expect(api.fetchMapApi).toHaveBeenCalledWith("/main/editor/provinces", {
      sessionToken: "staff-token",
    });
  });

  it("probeCanEditMap returns false on 403 when editor enabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_MAP_EDITOR_ENABLED", "1");
    vi.spyOn(api, "fetchMapApi").mockResolvedValue(
      new Response(JSON.stringify({ detail: "Staff map access required" }), {
        status: 403,
      }),
    );

    await expect(probeCanEditMap("main", "anon-token")).resolves.toBe(false);
  });

  it("probeCanEditMap returns false without token when not UI dev", async () => {
    vi.stubEnv("NEXT_PUBLIC_MAP_EDITOR_ENABLED", "1");
    const fetchSpy = vi.spyOn(api, "fetchMapApi");

    await expect(probeCanEditMap("main", "")).resolves.toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("probeCanEditMap returns true in UI dev without fetch when editor enabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_MAP_EDITOR_ENABLED", "1");
    vi.stubEnv("NEXT_PUBLIC_CHARACTER_UI_DEV", "1");
    const fetchSpy = vi.spyOn(api, "fetchMapApi");

    await expect(probeCanEditMap("main", "")).resolves.toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
