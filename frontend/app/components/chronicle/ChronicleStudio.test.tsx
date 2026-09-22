/**
 * @vitest-environment jsdom
 *
 * Mount smoke for the studio shell.
 *
 * `ChronicleStudio` is the top of the chronicle component tree — mounting it
 * links every module it imports, which is exactly the failure this session
 * hit: a dropped `export` in `ChroniclePanels.tsx` broke the build while every
 * (node-env, `.test.ts`-only) test stayed green.
 *
 * It only goes as far as the first paint. The studio's geometry and per-day
 * fetches need a WebGL canvas and a live map API, so the assertions stop at
 * the compose step it renders before any of that resolves.
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ChronicleStudio from "./ChronicleStudio";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("ChronicleStudio", () => {
  it("is a component, not an accidentally-undefined import", () => {
    expect(typeof ChronicleStudio).toBe("function");
  });

  it("mounts and paints its first step", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://api.test");
    // This shell smoke test does not render canvas content; jsdom has no backend.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    // Never resolves: this test is about the shell mounting, not about what
    // the day/index fetches eventually return.
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    // jsdom implements neither of these; `useMapViewport` observes the stage
    // element on mount and the studio paints into a canvas.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );

    render(<ChronicleStudio mapId="main" />);
    await waitFor(() => expect(screen.getByText("Compose")).toBeDefined());
  });
});
