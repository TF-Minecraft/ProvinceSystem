/**
 * @vitest-environment jsdom
 *
 * The studio's panels, mounted through their public exports. A lost `export`
 * here once left `ChronicleStudio` importing `undefined` and broke the build
 * while every node-env test stayed green; mounting each panel is the cheapest
 * thing that fails. Past that, each panel's controls are checked to report
 * what the reader chose.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CHRONICLE_SPEEDS,
  ChronicleBuildPanel,
  ChroniclePlaybackPanel,
  ChroniclePlayer,
  ChronicleRangePanel,
  ChronicleSteps,
  ChronicleTogglePanel,
  SectionHeading,
  chroniclePanelClass,
  primaryButtonClass,
  quietButtonClass,
  selectClass,
} from "./ChroniclePanels";
import { CHRONICLE_TOGGLES_OFF } from "./chronicleLayers";

afterEach(cleanup);

const noop = () => {};

const DAYS = Array.from({ length: 40 }, (_, index) => {
  const date = new Date(Date.UTC(2026, 7, 1 + index));
  return date.toISOString().slice(0, 10);
});

const ESTIMATE = {
  dayCount: 2,
  bytesPerFrame: 1,
  memoryBytes: 2,
  fetchMs: 1,
  cpuMs: 1,
  totalMs: 2,
  measured: false,
  staleSample: false,
  overCeiling: false,
};

describe("ChroniclePanels exports", () => {
  it("still exports every class token the studio imports by name", () => {
    for (const token of [
      chroniclePanelClass,
      primaryButtonClass,
      quietButtonClass,
      selectClass,
    ]) {
      expect(typeof token).toBe("string");
      expect(token.length).toBeGreaterThan(0);
    }
    expect(CHRONICLE_SPEEDS.length).toBeGreaterThan(0);
  });
});

describe("ChronicleSteps", () => {
  it("goes back to a step reached, but not on to one that is not", () => {
    const onSelect = vi.fn();
    render(
      <ChronicleSteps
        current="dates"
        reachable={{ layers: true, dates: true, watch: false }}
        onSelect={onSelect}
      />
    );
    expect(screen.getByRole("button", { name: /Dates/ }).getAttribute("aria-current")).toBe(
      "step"
    );
    expect(screen.getByRole("button", { name: /Watch/ }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Layers/ }));
    expect(onSelect).toHaveBeenCalledWith("layers");
  });
});

describe("ChronicleTogglePanel", () => {
  it("switches a layer from its tile, and says why one cannot be", () => {
    const onToggle = vi.fn();
    render(
      <ChronicleTogglePanel
        toggles={{ ...CHRONICLE_TOGGLES_OFF, nationFill: true }}
        onToggle={onToggle}
        disabledReasons={{ nationNames: "No geometry." }}
        notice={null}
        focusOptions={[]}
        focusNationId=""
        onFocusChange={noop}
        focusDisabledReason={null}
      />
    );
    expect(screen.getByRole("switch", { name: "Nation fill" }).getAttribute("aria-checked")).toBe(
      "true"
    );
    fireEvent.click(screen.getByRole("switch", { name: "Wars" }));
    expect(onToggle).toHaveBeenCalledWith("wars");
    expect(screen.getByRole("switch", { name: "Nation names" }).hasAttribute("disabled")).toBe(
      true
    );
    expect(screen.getByText(/Nation names: No geometry\./)).toBeDefined();
  });
});

describe("ChronicleRangePanel", () => {
  function renderRange(overrides: { start?: string; end?: string } = {}) {
    const onStartChange = vi.fn();
    const onEndChange = vi.fn();
    render(
      <ChronicleRangePanel
        days={DAYS}
        incompleteDays={new Set<string>([DAYS[3]!])}
        start={overrides.start ?? DAYS[33]!}
        end={overrides.end ?? DAYS[39]!}
        onStartChange={onStartChange}
        onEndChange={onEndChange}
        selection={{ days: DAYS.slice(33), incompleteDays: [], error: null }}
        estimate={ESTIMATE}
        renderSize={900}
        onRenderSizeChange={noop}
        blockReason={null}
      />
    );
    return { onStartChange, onEndChange };
  }

  it("shows the span a preset matches, and sets another from the latest day", () => {
    const { onStartChange, onEndChange } = renderRange();
    expect(
      screen.getByRole("button", { name: "Last 7 days" }).getAttribute("aria-pressed")
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Last 30 days" }));
    expect(onStartChange).toHaveBeenCalledWith(DAYS[10]);
    expect(onEndChange).toHaveBeenCalledWith(DAYS[39]);
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(onStartChange).toHaveBeenLastCalledWith(DAYS[0]);
  });

  it("names the days as a reader would", () => {
    renderRange();
    expect(screen.getAllByRole("option", { name: "1 Aug 2026" }).length).toBe(2);
    expect(screen.getAllByRole("option", { name: "4 Aug 2026 (incomplete)" }).length).toBe(2);
  });
});

describe("ChronicleBuildPanel", () => {
  it("shows how far the build has got", () => {
    render(
      <ChronicleBuildPanel
        progress={{ completed: 5, total: 20, day: "2026-08-05", painted: 4, reused: 1, skipped: 0 }}
        error={null}
      />
    );
    expect(screen.getByText("25%")).toBeDefined();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("5");
  });
});

describe("ChroniclePlayer", () => {
  function renderPlayer(activeIndex: number, speed = 4) {
    const props = {
      onScrub: vi.fn(),
      onTogglePlay: vi.fn(),
      onSpeedChange: vi.fn(),
      onLoopChange: vi.fn(),
    };
    render(
      <ChroniclePlayer
        variant="bar"
        days={DAYS.slice(0, 3)}
        activeIndex={activeIndex}
        playing={false}
        speed={speed}
        loop
        incomplete={false}
        {...props}
      />
    );
    return props;
  }

  it("shows the day on screen and steps either way", () => {
    const { onScrub } = renderPlayer(1);
    expect(screen.getByText("2 Aug 2026")).toBeDefined();
    expect(screen.getByText("Day 2 of 3")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Next day" }));
    expect(onScrub).toHaveBeenCalledWith(2);
    fireEvent.click(screen.getByRole("button", { name: "Previous day" }));
    expect(onScrub).toHaveBeenCalledWith(0);
  });

  it("cannot step past either end", () => {
    renderPlayer(0);
    expect(screen.getByRole("button", { name: "Previous day" }).hasAttribute("disabled")).toBe(
      true
    );
  });

  it("cycles the speed and wraps back to the slowest", () => {
    const { onSpeedChange } = renderPlayer(0, 16);
    fireEvent.click(screen.getByRole("button", { name: /Speed/ }));
    expect(onSpeedChange).toHaveBeenCalledWith(1);
  });

  it("plays and toggles looping", () => {
    const { onTogglePlay, onLoopChange } = renderPlayer(0);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(onTogglePlay).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Loop" }));
    expect(onLoopChange).toHaveBeenCalledWith(false);
  });
});

describe("ChroniclePlaybackPanel", () => {
  it("puts the watermark in a chosen corner, with no way to leave it off", () => {
    const onGifCornerChange = vi.fn();
    render(
      <ChroniclePlaybackPanel
        skippedDays={[]}
        exploreHref={null}
        chartsOpen={false}
        onToggleCharts={noop}
        gifSize={720}
        onGifSizeChange={noop}
        gifStampDay={false}
        onGifStampDayChange={noop}
        gifCorner="bottom-left"
        onGifCornerChange={onGifCornerChange}
        gifStatus={null}
        gifError={null}
        gifNotice={null}
      />
    );
    const corners = screen.getByRole("radiogroup", { name: "Watermark position" });
    expect(corners.querySelectorAll('[role="radio"]').length).toBe(4);
    expect(screen.getByRole("radio", { name: "Bottom left" }).getAttribute("aria-checked")).toBe(
      "true"
    );
    fireEvent.click(screen.getByRole("radio", { name: "Top right" }));
    expect(onGifCornerChange).toHaveBeenCalledWith("top-right");
    expect(screen.queryByRole("switch", { name: "Watermark" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "Discord link" })).toBeNull();
    expect(screen.getByRole("switch", { name: "Stamp the date" })).toBeDefined();
  });
});

describe("SectionHeading", () => {
  it("mounts", () => {
    const { container } = render(<SectionHeading title="Ledger" />);
    expect(container.textContent).toBe("Ledger");
  });
});
