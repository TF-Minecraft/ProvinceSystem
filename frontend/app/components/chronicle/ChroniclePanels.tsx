import Link from "next/link";

import {
  CHRONICLE_RENDER_SIZES,
  describeChronicleEstimate,
  formatChronicleBytes,
  type ChronicleBuildProgress,
  type ChronicleEstimate,
  type ChronicleRangeSelection,
} from "../../lib/map/chronicleBuild";
import { CHRONICLE_GIF_SIZES } from "../../lib/map/chronicleGifFrame";
import {
  CHRONICLE_FOCUS_NONE,
  type ChronicleFocusOption,
} from "../../lib/map/chronicleFocus";
import {
  CHRONICLE_TOGGLE_ORDER,
  anyChronicleToggleOn,
  type ChronicleToggleKey,
  type ChronicleToggles,
} from "./chronicleLayers";

/**
 * The studio's step panels. They own no state — every one of them is a pure
 * view over what `ChronicleStudio` already decided, so the studio's flow reads
 * top to bottom in one file.
 */

export const chroniclePanelClass =
  "rounded-lg border border-[color-mix(in_srgb,var(--tfmc-cream)_15%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_92%,transparent)] shadow-xl backdrop-blur-sm";

export const primaryButtonClass =
  "rounded-md border border-[color-mix(in_srgb,var(--tfmc-cream)_20%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-moss)_45%,var(--tfmc-forest-deep))] px-3 py-2 text-sm font-medium text-[var(--tfmc-cream)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45";

export const quietButtonClass =
  "rounded-md border border-[color-mix(in_srgb,var(--tfmc-cream)_15%,transparent)] px-3 py-1.5 text-xs text-[var(--tfmc-stone)] transition hover:text-[var(--tfmc-cream)] disabled:cursor-not-allowed disabled:opacity-45";

export const selectClass =
  "w-full rounded-md border border-[color-mix(in_srgb,var(--tfmc-cream)_18%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_45%,var(--tfmc-forest-deep))] px-2 py-1.5 text-sm text-[var(--tfmc-cream)]";

const headingClass =
  "text-xs font-medium uppercase tracking-widest text-[var(--tfmc-mist)]";

export function SectionHeading({ title }: { title: string }) {
  return <p className={headingClass}>{title}</p>;
}

export function ChronicleTogglePanel({
  toggles,
  onToggle,
  disabledReasons,
  busy,
  blockReason,
  notice,
  focusOptions,
  focusNationId,
  onFocusChange,
  focusDisabledReason,
  onNext,
}: {
  toggles: ChronicleToggles;
  onToggle: (key: ChronicleToggleKey) => void;
  disabledReasons: Partial<Record<ChronicleToggleKey, string>>;
  busy: boolean;
  /** Set when the composed look cannot be carried forward yet. Blocks Next. */
  blockReason: string | null;
  notice: string | null;
  /** The realms the latest stored day knows about, already sorted by name. */
  focusOptions: ChronicleFocusOption[];
  focusNationId: string;
  onFocusChange: (nationId: string) => void;
  /**
   * Why a realm cannot be picked right now, or null. Unlike `blockReason` this
   * does not gate Next: a focus is an optional narrowing, and not being able to
   * set one is never a reason to refuse a timelapse of the whole map.
   */
  focusDisabledReason: string | null;
  onNext: () => void;
}) {
  return (
    <div className={`${chroniclePanelClass} p-3`}>
      <SectionHeading title="Compose" />
      <p className="mt-1 text-xs leading-snug text-[var(--tfmc-stone)]">
        The map starts empty. Toggle layers to build the look you want.
      </p>

      <ul className="mt-3 space-y-1.5">
        {CHRONICLE_TOGGLE_ORDER.map(({ key, label, detail }) => {
          const reason = disabledReasons[key];
          return (
            <li key={key}>
              <label
                className={`flex items-start gap-2 text-sm ${
                  reason
                    ? "cursor-not-allowed text-[var(--tfmc-stone)] opacity-60"
                    : "cursor-pointer text-[var(--tfmc-cream)]"
                }`}
                title={reason ?? detail}
              >
                <input
                  type="checkbox"
                  className="mt-1 accent-[var(--tfmc-accent)]"
                  checked={toggles[key]}
                  disabled={Boolean(reason)}
                  onChange={() => onToggle(key)}
                />
                <span>
                  {label}
                  <span className="block text-xs text-[var(--tfmc-stone)]">
                    {reason ?? detail}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <label className="mt-3 block text-xs text-[var(--tfmc-mist)]">
        Focus a Nation
        <select
          className={`${selectClass} mt-1`}
          value={focusNationId}
          disabled={Boolean(focusDisabledReason)}
          onChange={(e) => onFocusChange(e.target.value)}
        >
          <option value={CHRONICLE_FOCUS_NONE}>Every nation</option>
          {focusOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs text-[var(--tfmc-stone)]">
          {focusDisabledReason ??
            "One nation keeps its color. The rest are shaded."}
        </span>
      </label>

      {notice ? (
        <p className="mt-3 rounded-md border border-[color-mix(in_srgb,var(--tfmc-accent)_35%,transparent)] px-2 py-1.5 text-xs leading-snug text-[var(--tfmc-cream)]">
          {notice}
        </p>
      ) : null}

      {blockReason ? (
        <p className="mt-3 rounded-md border border-[color-mix(in_srgb,var(--tfmc-accent)_35%,transparent)] px-2 py-1.5 text-xs leading-snug text-[var(--tfmc-cream)]">
          {blockReason}
        </p>
      ) : null}

      <button
        type="button"
        className={`${primaryButtonClass} mt-3 w-full`}
        onClick={onNext}
        disabled={busy || Boolean(blockReason) || !anyChronicleToggleOn(toggles)}
      >
        {busy
          ? "Loading layers…"
          : blockReason
            ? "Waiting on label geometry…"
            : anyChronicleToggleOn(toggles)
              ? "Pick a date range"
              : "Switch on a layer first"}
      </button>
    </div>
  );
}

export function ChronicleRangePanel({
  days,
  incompleteDays,
  start,
  end,
  onStartChange,
  onEndChange,
  selection,
  estimate,
  renderSize,
  onRenderSizeChange,
  blockReason,
  onBack,
  onBuild,
}: {
  days: string[];
  incompleteDays: Set<string>;
  start: string | null;
  end: string | null;
  onStartChange: (day: string) => void;
  onEndChange: (day: string) => void;
  selection: ChronicleRangeSelection;
  estimate: ChronicleEstimate;
  renderSize: number;
  onRenderSizeChange: (size: number) => void;
  /**
   * Why this build cannot start, from `chronicleBuildBlockReason`. The same
   * value `startBuild` re-checks, so the button and the guard cannot disagree.
   */
  blockReason: string | null;
  onBack: () => void;
  onBuild: () => void;
}) {
  const dayOption = (day: string) => (
    <option key={day} value={day}>
      {incompleteDays.has(day) ? `${day} (incomplete)` : day}
    </option>
  );

  return (
    <div className={`${chroniclePanelClass} p-3`}>
      <SectionHeading title="Range" />

      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="text-xs text-[var(--tfmc-mist)]">
          First day
          <select
            className={`${selectClass} mt-1`}
            value={start ?? ""}
            onChange={(e) => onStartChange(e.target.value)}
          >
            {days.map(dayOption)}
          </select>
        </label>
        <label className="text-xs text-[var(--tfmc-mist)]">
          Last day
          <select
            className={`${selectClass} mt-1`}
            value={end ?? ""}
            onChange={(e) => onEndChange(e.target.value)}
          >
            {days.map(dayOption)}
          </select>
        </label>
      </div>

      <div className="mt-3 border-t border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] pt-3">
        <SectionHeading title="Estimate" />
        {selection.error ? (
          <p className="mt-1 text-sm text-[var(--tfmc-accent)]">
            {selection.error}
          </p>
        ) : (
          <>
            <p className="mt-1 text-sm text-[var(--tfmc-cream)]">
              {describeChronicleEstimate(estimate)}
            </p>
            {selection.incompleteDays.length ? (
              <p className="mt-1 text-xs text-[var(--tfmc-accent)]">
                {selection.incompleteDays.length} day
                {selection.incompleteDays.length === 1 ? "" : "s"} in this range
                were captured with missing sources.
              </p>
            ) : null}
          </>
        )}

        <label className="mt-3 block text-xs text-[var(--tfmc-mist)]">
          Frame size
          <select
            className={`${selectClass} mt-1`}
            value={renderSize}
            onChange={(e) => onRenderSizeChange(Number(e.target.value))}
          >
            {CHRONICLE_RENDER_SIZES.map((size) => (
              <option key={size} value={size}>
                {size} x {size} px
              </option>
            ))}
          </select>
        </label>

        {estimate.overCeiling ? (
          <p className="mt-2 rounded-md border border-[color-mix(in_srgb,var(--tfmc-accent)_40%,transparent)] px-2 py-1.5 text-xs leading-snug text-[var(--tfmc-cream)]">
            {formatChronicleBytes(estimate.memoryBytes)} of frames is more than
            this browser should hold at once. Shorten the range or pick a
            smaller frame size before building.
          </p>
        ) : blockReason && !selection.error ? (
          <p className="mt-2 rounded-md border border-[color-mix(in_srgb,var(--tfmc-accent)_40%,transparent)] px-2 py-1.5 text-xs leading-snug text-[var(--tfmc-cream)]">
            {blockReason}
          </p>
        ) : null}
      </div>

      <div className="mt-3 flex gap-2">
        <button type="button" className={quietButtonClass} onClick={onBack}>
          Back to layers
        </button>
        <button
          type="button"
          className={`${primaryButtonClass} flex-1`}
          onClick={onBuild}
          disabled={Boolean(blockReason)}
        >
          Build {selection.days.length || ""} frames
        </button>
      </div>
    </div>
  );
}

export function ChronicleBuildPanel({
  progress,
  error,
  onCancel,
  onBack,
}: {
  progress: ChronicleBuildProgress | null;
  error: string | null;
  onCancel: () => void;
  onBack: () => void;
}) {
  const total = progress?.total ?? 0;
  const completed = progress?.completed ?? 0;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className={`${chroniclePanelClass} p-3`}>
      <SectionHeading title="Build" />
      <p className="mt-1 text-sm text-[var(--tfmc-cream)]">
        {completed} / {total} days
        {progress?.day ? ` — ${progress.day}` : ""}
      </p>

      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)]">
        <div
          className="h-full rounded-full bg-[var(--tfmc-accent)] transition-[width] duration-150 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>

      {progress ? (
        <p className="mt-2 text-xs text-[var(--tfmc-stone)]">
          {progress.painted} painted, {progress.reused} reused
          {progress.skipped ? `, ${progress.skipped} skipped` : ""}
        </p>
      ) : null}

      {error ? (
        <p className="mt-2 text-xs text-[var(--tfmc-accent)]">{error}</p>
      ) : null}

      <div className="mt-3 flex gap-2">
        <button type="button" className={quietButtonClass} onClick={onBack}>
          Back to range
        </button>
        <button
          type="button"
          className={`${primaryButtonClass} flex-1`}
          onClick={onCancel}
          disabled={Boolean(error)}
        >
          Cancel build
        </button>
      </div>
    </div>
  );
}

export const CHRONICLE_SPEEDS = [1, 2, 4, 8, 16] as const;

function ExportCheck({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={`mt-2 flex items-start gap-2 text-sm ${
        disabled
          ? "cursor-not-allowed text-[var(--tfmc-stone)] opacity-60"
          : "cursor-pointer text-[var(--tfmc-cream)]"
      }`}
    >
      <input
        type="checkbox"
        className="mt-1 accent-[var(--tfmc-accent)]"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

export function ChroniclePlaybackPanel({
  days,
  activeIndex,
  onScrub,
  playing,
  onTogglePlay,
  speed,
  onSpeedChange,
  loop,
  onLoopChange,
  incomplete,
  skippedDays,
  exploreHref,
  chartsOpen,
  onToggleCharts,
  gifSize,
  onGifSizeChange,
  gifStampDay,
  onGifStampDayChange,
  gifWatermark,
  onGifWatermarkChange,
  gifDiscordLink,
  onGifDiscordLinkChange,
  onExportGif,
  gifStatus,
  gifError,
  gifNotice,
  onDiscard,
}: {
  days: string[];
  activeIndex: number;
  onScrub: (index: number) => void;
  playing: boolean;
  onTogglePlay: () => void;
  speed: number;
  onSpeedChange: (speed: number) => void;
  loop: boolean;
  onLoopChange: (loop: boolean) => void;
  incomplete: boolean;
  skippedDays: string[];
  /** Whether the ledger charts rail (right side) is showing. */
  chartsOpen: boolean;
  onToggleCharts: () => void;
  /**
   * Route to the standalone viewer for the day currently on screen, or `null`
   * when there is no day to explore. Built by `ChronicleStudio`, which is the
   * component that knows the `mapId`; rebuilding the route in here would mean
   * a second place that has to remember the `dev` -> `r3b1rth` rename.
   */
  exploreHref?: string | null;
  gifSize: number;
  onGifSizeChange: (size: number) => void;
  /**
   * Whether each exported frame carries its own day. A property of the file
   * only — the preview never draws it.
   */
  gifStampDay: boolean;
  onGifStampDayChange: (stamp: boolean) => void;
  /** The TFMC logo in the corner of the file. Independent of the Discord line. */
  gifWatermark: boolean;
  onGifWatermarkChange: (watermark: boolean) => void;
  /** The discord.gg/tfmc line. Independent of the logo. */
  gifDiscordLink: boolean;
  onGifDiscordLinkChange: (discordLink: boolean) => void;
  onExportGif: () => void;
  /**
   * What the export is doing right now, or null when idle. Non-null is also
   * what disables the button, so a busy export cannot be started twice and the
   * button can never be left disabled with no reason showing beside it.
   */
  gifStatus: string | null;
  gifError: string | null;
  /** A GIF that was produced with something missing from it. Not a failure. */
  gifNotice: string | null;
  onDiscard: () => void;
}) {
  const exporting = gifStatus != null;
  return (
    <div className={`${chroniclePanelClass} p-3`}>
      <SectionHeading title="Play" />
      <p className="mt-1 font-[family-name:var(--font-fraunces)] text-xl text-[var(--tfmc-cream)]">
        {days[activeIndex] ?? "—"}
      </p>
      {incomplete ? (
        <p className="text-xs text-[var(--tfmc-accent)]">
          This day was captured with missing sources.
        </p>
      ) : null}

      <button
        type="button"
        className={`${quietButtonClass} mt-2`}
        onClick={onToggleCharts}
        aria-pressed={chartsOpen}
      >
        {chartsOpen ? "Hide charts" : "Show charts"}
      </button>

      <input
        type="range"
        className="mt-2 w-full accent-[var(--tfmc-accent)]"
        min={0}
        max={Math.max(0, days.length - 1)}
        step={1}
        value={activeIndex}
        onChange={(e) => onScrub(Number(e.target.value))}
        aria-label="Chronicle day"
      />

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          className={`${primaryButtonClass} flex-1`}
          onClick={onTogglePlay}
        >
          {playing ? "Pause" : "Play"}
        </button>
        <label className="text-xs text-[var(--tfmc-mist)]">
          <span className="sr-only">Days per second</span>
          <select
            className={selectClass}
            value={speed}
            onChange={(e) => onSpeedChange(Number(e.target.value))}
          >
            {CHRONICLE_SPEEDS.map((value) => (
              <option key={value} value={value}>
                {value}x
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-[var(--tfmc-stone)]">
        <span id="chronicle-loop-label">Loop</span>
        {/*
          `role="switch"` rather than a checkbox: the state is on/off and takes
          effect immediately, which is what a switch means to a screen reader.
          The visual is the track; the inner span is the knob.
        */}
        <button
          type="button"
          role="switch"
          aria-checked={loop}
          aria-labelledby="chronicle-loop-label"
          onClick={() => onLoopChange(!loop)}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition ${
            loop
              ? "border-[var(--tfmc-accent)] bg-[color-mix(in_srgb,var(--tfmc-accent)_55%,transparent)]"
              : "border-[color-mix(in_srgb,var(--tfmc-cream)_20%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-cream)_10%,transparent)]"
          }`}
        >
          <span
            className={`h-3.5 w-3.5 rounded-full bg-[var(--tfmc-cream)] transition-transform ${
              loop ? "translate-x-[1.125rem]" : "translate-x-[0.1875rem]"
            }`}
          />
        </button>
      </div>

      {exploreHref ? (
        <Link
          href={exploreHref}
          className="mt-2 inline-flex text-xs text-[var(--tfmc-accent)] underline-offset-2 hover:underline"
        >
          Explore this day on the full map &rarr;
        </Link>
      ) : null}

      <div className="mt-3 border-t border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] pt-3">
        <SectionHeading title="Export" />
        <label className="mt-2 block text-xs text-[var(--tfmc-mist)]">
          GIF size
          <select
            className={`${selectClass} mt-1`}
            value={gifSize}
            disabled={exporting}
            onChange={(e) => onGifSizeChange(Number(e.target.value))}
          >
            {CHRONICLE_GIF_SIZES.map((size) => (
              <option key={size} value={size}>
                {size} x {size} px
              </option>
            ))}
          </select>
        </label>
        <ExportCheck
          label="Watermark"
          checked={gifWatermark}
          disabled={exporting}
          onChange={onGifWatermarkChange}
        />
        <ExportCheck
          label="Discord link"
          checked={gifDiscordLink}
          disabled={exporting}
          onChange={onGifDiscordLinkChange}
        />
        <ExportCheck
          label="Stamp the date"
          checked={gifStampDay}
          disabled={exporting}
          onChange={onGifStampDayChange}
        />
        <button
          type="button"
          className={`${primaryButtonClass} mt-2 w-full`}
          onClick={onExportGif}
          disabled={exporting}
        >
          {gifStatus ?? "Export GIF"}
        </button>
        {gifError ? (
          <p className="mt-2 text-xs text-[var(--tfmc-accent)]">{gifError}</p>
        ) : null}
        {gifNotice ? (
          <p className="mt-2 text-xs leading-snug text-[var(--tfmc-stone)]">
            {gifNotice}
          </p>
        ) : null}
      </div>

      {skippedDays.length ? (
        <p className="mt-1 text-xs text-[var(--tfmc-accent)]">
          {skippedDays.length} day{skippedDays.length === 1 ? "" : "s"} had no
          stored sources and were left out.
        </p>
      ) : null}

      <button
        type="button"
        className={`${quietButtonClass} mt-3 w-full`}
        onClick={onDiscard}
      >
        Discard frames and start over
      </button>
    </div>
  );
}
