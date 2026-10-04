/**
 * @vitest-environment jsdom
 *
 * Smoke coverage for the ledger panel. Before this file existed no `.tsx` in
 * the repo was imported by any test at all (`vitest.config.ts` only matched
 * `app/**\/*.test.ts` and ran node-env), so a component could stop compiling
 * — a dropped `export`, a renamed import — with the whole suite still green.
 *
 * It also pins the band cap end-to-end: `stackBreakdown` capping its return
 * value is only useful if the panel renders one `<path>`/legend entry per
 * returned key and nothing else.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import LedgerChartsPanel from "./LedgerChartsPanel";
import * as useLedgerSeriesModule from "./useLedgerSeries";
import type { LedgerChartsResult } from "./useLedgerSeries";
import type { LedgerFactionSeries, LedgerSeries } from "../../lib/map/ledgerData";
import * as ledgerSeriesModule from "../../lib/map/ledgerSeries";
import { LEDGER_MAX_BREAKDOWN_BANDS } from "../../lib/map/ledgerSeries";

afterEach(cleanup);

const DAYS = ["2026-08-01", "2026-08-02"];

function factionSeries(bandCount: number): LedgerFactionSeries {
  const wealth: Record<string, Array<number | null>> = {};
  for (let i = 0; i < bandCount; i++) wealth[`band-${i}`] = [i + 1, i + 1];
  return {
    key: "f1|2026-08-01T00:00:00Z",
    id: "f1",
    founded_at: "2026-08-01T00:00:00Z",
    name: "Aurelia",
    rgb: "#ffffff",
    series: {
      wealth: [10, 20],
      prestige: [1, 2],
      net_income: [3, 4],
      inflation_delta: [0, 0],
      bank: [0, 0],
    },
    rank: [null, null],
    tier: [null, null],
    breakdowns: { wealth, prestige: { honour: [1, 2] } },
  };
}

function readyResult(bandCount: number): LedgerChartsResult {
  const series: LedgerSeries = {
    days: DAYS,
    server_day: [1, 2],
    captured_at: [null, null],
    complete: [true, true],
    global: { pouch_wealth: [5, 6], player_bank_wealth: [7, 8] },
    factions: [factionSeries(bandCount)],
    truncated: false,
  };
  return {
    status: "ready",
    options: [
      {
        name: "Aurelia",
        keys: ["f1|2026-08-01T00:00:00Z"],
        foundedAt: ["2026-08-01T00:00:00Z"],
        label: "Aurelia",
      },
    ],
    selections: { wealth: "Aurelia", prestige: "Aurelia", income: "Aurelia" },
    onSelect: () => {},
    series,
    seriesLoading: false,
    seriesError: null,
  };
}

describe("LedgerChartsPanel", () => {
  it("mounts the ready state and renders all three cards", () => {
    render(<LedgerChartsPanel result={readyResult(3)} cursorDay={DAYS[0]!} />);
    expect(screen.getByText("Wealth")).toBeDefined();
    expect(screen.getByText("Prestige")).toBeDefined();
    expect(screen.getByText("Income")).toBeDefined();
  });

  it("mounts every non-ready state without throwing", () => {
    for (const result of [
      { status: "loading" },
      { status: "empty" },
      { status: "no-options" },
      { status: "error", message: "boom" },
    ] as LedgerChartsResult[]) {
      const { unmount } = render(<LedgerChartsPanel result={result} cursorDay={null} />);
      unmount();
    }
  });

  it("does not mount one band per server key when the breakdown is huge", () => {
    // The hang: breakdown keys are attacker-controlled, and each one became a
    // `<path>` plus a legend `<span>` on every card.
    const { container } = render(
      <LedgerChartsPanel result={readyResult(4_000)} cursorDay={DAYS[0]!} />
    );
    // First card, first `<svg>`: the stacked wealth chart itself (the second
    // svg in the card is the separate globals strip, which is two fixed lines).
    const stack = container.firstElementChild!.querySelector("svg")!;
    const bands = stack.querySelectorAll("path");
    expect(bands.length).toBeLessThanOrEqual(LEDGER_MAX_BREAKDOWN_BANDS + 1);
    // The legend is capped with it — same key list drives both. `band-0`
    // has the smallest peak, so it is one of the folded-away bands.
    expect(screen.queryByText("band-0")).toBeNull();
  });

  it("does not re-splice the faction or rebuild chart geometry on a cursor-only re-render", () => {
    // Cursor updates during playback must reuse the faction series and chart
    // geometry instead of repeating work proportional to the day count.
    const factionSpy = vi.spyOn(useLedgerSeriesModule, "factionForKey");
    const stackSpy = vi.spyOn(ledgerSeriesModule, "stackBreakdown");

    const result = readyResult(3);
    const { rerender } = render(
      <LedgerChartsPanel result={result} cursorDay={DAYS[0]!} />
    );

    const factionCallsAfterMount = factionSpy.mock.calls.length;
    const stackCallsAfterMount = stackSpy.mock.calls.length;
    expect(factionCallsAfterMount).toBeGreaterThan(0);
    expect(stackCallsAfterMount).toBeGreaterThan(0);

    // Same `result` object (series/options/selections all identical), only
    // the cursor moves — exactly what one RAF playback tick does.
    rerender(<LedgerChartsPanel result={result} cursorDay={DAYS[1]!} />);

    expect(factionSpy.mock.calls.length).toBe(factionCallsAfterMount);
    expect(stackSpy.mock.calls.length).toBe(stackCallsAfterMount);

    factionSpy.mockRestore();
    stackSpy.mockRestore();
  });

  it("still calls onSelect with the right card and key after memoising the handler", () => {
    // The `useCallback` wrap around the three `onSelect` closures (added so
    // `React.memo` on the cards isn't defeated by a fresh arrow every render)
    // must not lose which card a change came from, or the stale-closure key.
    const onSelect = vi.fn();
    const base = readyResult(1) as Extract<LedgerChartsResult, { status: "ready" }>;
    const result: LedgerChartsResult = {
      ...base,
      options: [
        {
          name: "Aurelia",
          keys: ["f1|2026-08-01T00:00:00Z"],
          foundedAt: ["2026-08-01T00:00:00Z"],
          label: "Aurelia",
        },
        { name: "Second Realm", keys: ["f2"], foundedAt: ["2026-08-01T00:00:00Z"], label: "Second Realm" },
      ],
      onSelect,
    };

    render(<LedgerChartsPanel result={result} cursorDay={DAYS[0]!} />);

    fireEvent.click(screen.getByRole("combobox", { name: "Wealth nation" }));
    fireEvent.click(screen.getByRole("option", { name: "Second Realm" }));
    expect(onSelect).toHaveBeenCalledWith("wealth", "Second Realm");

    fireEvent.click(screen.getByRole("combobox", { name: "Prestige nation" }));
    fireEvent.click(screen.getByRole("option", { name: "Second Realm" }));
    expect(onSelect).toHaveBeenCalledWith("prestige", "Second Realm");

    fireEvent.click(screen.getByRole("combobox", { name: "Income nation" }));
    fireEvent.click(screen.getByRole("option", { name: "Second Realm" }));
    expect(onSelect).toHaveBeenCalledWith("income", "Second Realm");

    expect(onSelect).toHaveBeenCalledTimes(3);
  });
});
