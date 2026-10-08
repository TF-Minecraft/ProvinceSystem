import { describe, expect, it } from "vitest";

// Midnight below is London's.
process.env.TZ = "Europe/London";

import type { ActivityEntry } from "./api";
import { groupActivity, groupRuns, placeName, targetName } from "./activity";

// 2026-10-07 22:13:20 BST.
const T = 1_791_407_600;

function entry(id: string, time: number, extra: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    id, time, kind: "block", verb: "broke", target: "short_grass", amount: null, victim: null, message: null,
    truncated: false, world: "TFMC_Map", x: 1, y: 64, z: 2, rolled_back: null,
    target_info: { name: "Short Grass", source: "vanilla", id: "short_grass", vanilla_name: "Short Grass",
                   source_id: null, custom_name: null },
    ...extra,
  };
}

const ids = (rows: ReturnType<typeof groupRuns>) => rows.map((r) => r.entries.map((e) => e.id));

describe("groupRuns", () => {
  it("merges consecutive changes to the same block", () => {
    expect(ids(groupRuns([entry("a", T), entry("b", T - 5), entry("c", T - 30)]))).toEqual([["a", "b", "c"]]);
  });

  it("limits a run to a minute end to end, not between neighbours", () => {
    const rows = groupRuns([entry("a", T), entry("b", T - 40), entry("c", T - 70)]);
    expect(ids(rows)).toEqual([["a", "b"], ["c"]]);
  });

  it("keeps different blocks, verbs, worlds and rollback states apart", () => {
    const other = { ...entry("x", 0).target_info!, id: "tall_grass", name: "Tall Grass" };
    const rows = groupRuns([
      entry("a", T),
      entry("b", T - 1, { target_info: other }),
      entry("c", T - 2, { target_info: other, verb: "placed" }),
      entry("d", T - 3, { target_info: other, verb: "placed", world: "TFMC_Map_nether" }),
      entry("e", T - 4, { target_info: other, verb: "placed", world: "TFMC_Map_nether", rolled_back: "rolled back" }),
    ]);
    expect(ids(rows)).toEqual([["a"], ["b"], ["c"], ["d"], ["e"]]);
  });

  it("never merges anything but block changes", () => {
    const kill = { kind: "kill", verb: "killed", target: "Bob", target_info: null };
    const chat = { kind: "chat", verb: "said", target: null, target_info: null, message: "hi" };
    const rows = groupRuns([entry("a", T, kill), entry("b", T - 1, kill), entry("c", T - 2, chat), entry("d", T - 3, chat)]);
    expect(rows).toHaveLength(4);
  });

  it("is broken by anything in between", () => {
    const rows = groupRuns([entry("a", T), entry("b", T - 1, { kind: "session", verb: "logged out" }), entry("c", T - 2)]);
    expect(rows).toHaveLength(3);
  });

  it("does not run across midnight", () => {
    const midnight = 1_791_414_000; // 2026-10-08 00:00 BST
    expect(ids(groupRuns([entry("a", midnight + 10), entry("b", midnight - 10)]))).toEqual([["a"], ["b"]]);
  });

  it("joins a run split across pages and keeps the newest id as its key", () => {
    const first = [entry("a", T), entry("b", T - 1)];
    const rows = groupRuns([...first, entry("c", T - 2)]);
    expect(rows[0].key).toBe("a");
    expect(rows[0].entries).toHaveLength(3);
  });
});

describe("groupActivity", () => {
  it("puts rows under local days", () => {
    const days = groupActivity([entry("a", T + 37_000, { kind: "session", verb: "logged in" }), entry("b", T)], T + 37_100);
    expect(days.map((d) => d.label)).toEqual(["Today", "Yesterday"]);
  });
});

describe("names", () => {
  it("calls the map's world by its name", () => {
    const names = { serverLabel: "Vardera", mapWorld: "TFMC_Map" };
    expect(placeName("TFMC_Map", names)).toBe("Vardera");
    expect(placeName("TFMC_Map_nether", names)).toBe("Nether");
    expect(placeName("TFMC_Map_the_end", names)).toBe("The End");
    expect(placeName("Arena", names)).toBe("Arena");
    expect(placeName("TFMC_Map", {})).toBe("TFMC_Map");
  });

  it("falls back to the plain label from older responses", () => {
    expect(targetName(entry("a", T, { target_info: undefined }))).toBe("short_grass");
    expect(targetName(entry("a", T))).toBe("Short Grass");
  });
});
