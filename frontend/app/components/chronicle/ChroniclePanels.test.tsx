/**
 * @vitest-environment jsdom
 *
 * Mount smoke for the studio's step panels.
 *
 * This is the file that would have caught the break this session: a lost
 * `export` here left `ChronicleStudio` importing `undefined` and the build
 * failed, while every (node-env, `.test.ts`-only) test stayed green. Mounting
 * each panel through its public export is the cheapest thing that fails.
 */

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  CHRONICLE_SPEEDS,
  ChronicleBuildPanel,
  ChroniclePlaybackPanel,
  ChronicleRangePanel,
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

describe("ChronicleTogglePanel", () => {
  it("mounts", () => {
    const { container } = render(
      <ChronicleTogglePanel
        toggles={CHRONICLE_TOGGLES_OFF}
        onToggle={noop}
        disabledReasons={{}}
        busy={false}
        blockReason={null}
        notice={null}
        focusOptions={[]}
        focusNationId=""
        onFocusChange={noop}
        focusDisabledReason={null}
        onNext={noop}
      />
    );
    expect(container.textContent).toContain("Compose");
  });
});

describe("ChronicleRangePanel", () => {
  it("mounts", () => {
    const { container } = render(
      <ChronicleRangePanel
        days={["2026-08-01", "2026-08-02"]}
        incompleteDays={new Set<string>()}
        start="2026-08-01"
        end="2026-08-02"
        onStartChange={noop}
        onEndChange={noop}
        selection={{ days: ["2026-08-01", "2026-08-02"], incompleteDays: [], error: null }}
        estimate={{
          dayCount: 2,
          bytesPerFrame: 1,
          memoryBytes: 2,
          fetchMs: 1,
          cpuMs: 1,
          totalMs: 2,
          measured: false,
          staleSample: false,
          overCeiling: false,
        }}
        renderSize={512}
        onRenderSizeChange={noop}
        blockReason={null}
        onBack={noop}
        onBuild={noop}
      />
    );
    expect(container.textContent).toContain("Range");
  });
});

describe("ChronicleBuildPanel", () => {
  it("mounts", () => {
    const { container } = render(
      <ChronicleBuildPanel progress={null} error={null} onCancel={noop} onBack={noop} />
    );
    expect(container.textContent).toContain("Build");
  });
});

describe("ChroniclePlaybackPanel", () => {
  it("mounts", () => {
    const { container } = render(
      <ChroniclePlaybackPanel
        days={["2026-08-01"]}
        activeIndex={0}
        onScrub={noop}
        playing={false}
        onTogglePlay={noop}
        speed={1}
        onSpeedChange={noop}
        loop={false}
        onLoopChange={noop}
        incomplete={false}
        skippedDays={[]}
        exploreHref={null}
        chartsOpen={false}
        onToggleCharts={noop}
        gifSize={256}
        onGifSizeChange={noop}
        gifStampDay={false}
        onGifStampDayChange={noop}
        gifWatermark
        onGifWatermarkChange={noop}
        gifDiscordLink
        onGifDiscordLinkChange={noop}
        onExportGif={noop}
        gifStatus={null}
        gifError={null}
        gifNotice={null}
        onDiscard={noop}
      />
    );
    expect(container.textContent).toContain("2026-08-01");
    expect(container.textContent).toContain("Watermark");
    expect(container.textContent).toContain("Discord link");
    expect(container.textContent).toContain("Stamp the date");
  });
});

describe("SectionHeading", () => {
  it("mounts", () => {
    const { container } = render(<SectionHeading title="Ledger" />);
    expect(container.textContent).toBe("Ledger");
  });
});
