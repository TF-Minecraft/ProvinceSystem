import { describe, expect, it } from "vitest";

import { counts, flags, severity, waiting, type PluginCopy, type ServerPlugin } from "./servers";

const copy = (over: Partial<PluginCopy> = {}): PluginCopy => ({
  state: "latest",
  files: ["core-1.0.0.jar"],
  version: "1.0.0",
  release: "1.0.0",
  loaded: "1.0.0",
  loaded_state: "same",
  update: false,
  duplicate: false,
  ...over,
});

const plugin = (main?: PluginCopy, dev?: PluginCopy): ServerPlugin => ({
  repo: "Core",
  latest: { version: "1.0.0", published_at: "2026-10-01T00:00:00Z", url: "" },
  servers: { main, dev },
});

describe("server plugin flags", () => {
  it("has nothing to say about the latest release, running", () => {
    expect(flags(copy())).toEqual([]);
    expect(severity(plugin(copy(), copy()))).toBeNull();
  });

  it("names every problem with a copy", () => {
    expect(
      flags(
        copy({
          state: "not_release",
          duplicate: true,
          loaded_state: "different",
        }),
      ).map((f) => f.label),
    ).toEqual(["Not a release", "Two jars", "Needs restart"]);
    expect(flags(copy({ state: "older_release", loaded_state: "not_loaded" })).map((f) => f.label)).toEqual([
      "Older release",
      "Didn’t start",
    ]);
    expect(flags(copy({ state: "missing" }))).toEqual([{ label: "Not installed", tone: "none" }]);
  });

  it("counts a jar in plugins/update as waiting for a restart", () => {
    expect(waiting(copy({ update: true }))).toBe(true);
    expect(waiting(copy({ state: "missing", update: true }))).toBe(false);
  });

  it("ranks the worst copy and ignores plugins that are only missing", () => {
    expect(severity(plugin(copy({ state: "missing" }), copy({ state: "missing" })))).toBeNull();
    expect(severity(plugin(copy({ loaded_state: "different" }), copy({ state: "test_build" })))).toBe(1);
    expect(severity(plugin(copy({ state: "not_release" }), undefined))).toBe(0);
  });

  it("totals each server's problems", () => {
    const list = [
      plugin(copy({ state: "not_release" }), copy({ state: "test_build" })),
      plugin(copy({ loaded_state: "different" }), copy({ state: "older_release", loaded_state: "not_loaded" })),
    ];
    expect(counts(list, "main")).toEqual({
      notReleases: 1,
      older: 0,
      waiting: 1,
      didNotStart: 0,
    });
    expect(counts(list, "dev")).toEqual({
      notReleases: 1,
      older: 1,
      waiting: 0,
      didNotStart: 1,
    });
  });
});
