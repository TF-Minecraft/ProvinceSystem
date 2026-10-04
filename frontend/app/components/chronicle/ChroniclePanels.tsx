import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import {
  CHRONICLE_RENDER_SIZES,
  formatChronicleBytes,
  formatChronicleDuration,
  type ChronicleBuildProgress,
  type ChronicleEstimate,
  type ChronicleRangeSelection,
} from "../../lib/map/chronicleBuild";
import { formatChronicleDay } from "../../lib/map/chronicleDayLabel";
import {
  CHRONICLE_GIF_SIZES,
  CHRONICLE_WATERMARK_CORNERS,
  type ChronicleWatermarkCorner,
} from "../../lib/map/chronicleGifFrame";
import {
  CHRONICLE_FOCUS_NONE,
  type ChronicleFocusOption,
} from "../../lib/map/chronicleFocus";
import {
  layerTileButtonClass,
  layerTileFrameClass,
  layerTileIconClass,
  layerTileLabelClass,
  layerTileRingClass,
} from "../map/shell/layerTiles";
import {
  BackIcon,
  BordersIcon,
  ChartIcon,
  FortIcon,
  HatchIcon,
  LoopIcon,
  NameChipIcon,
  NamesIcon,
  OccupationIcon,
  PauseIcon,
  PinIcon,
  PlayIcon,
  ProsperityIcon,
  RealmIcon,
  StepBackIcon,
  StepForwardIcon,
  SwordsIcon,
  TradeIcon,
} from "../map/shell/MapIcons";
import {
  CHRONICLE_TOGGLE_ORDER,
  type ChronicleToggleKey,
  type ChronicleToggles,
} from "./chronicleLayers";

/**
 * The timelapse studio's panels, in the live map's look. They own no state:
 * each is a view over what `ChronicleStudio` already decided, so the studio's
 * flow reads top to bottom in one file. The studio places them in the map
 * shell: the steps in its side panel (a bottom sheet on a phone), the player
 * along the foot of the map on a desktop.
 */

/** A card over the map, as the live map's panels are. */
export const chroniclePanelClass = "map-frame";

export const primaryButtonClass =
  "inline-flex h-10 items-center justify-center gap-2 rounded-full bg-[var(--tfmc-accent)] px-4 text-sm font-semibold text-[var(--tfmc-forest-deep)] transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tfmc-cream)] disabled:cursor-not-allowed disabled:bg-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] disabled:text-[var(--tfmc-stone)] disabled:hover:brightness-100";

const quietButtonBaseClass =
  "inline-flex h-10 items-center justify-center gap-1.5 rounded-full px-4 text-sm transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tfmc-accent)] disabled:cursor-not-allowed disabled:opacity-45";

export const quietButtonClass = `${quietButtonBaseClass} border border-[color-mix(in_srgb,var(--tfmc-cream)_18%,transparent)] text-[var(--tfmc-stone)] hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_6%,transparent)] hover:text-[var(--tfmc-cream)]`;

/** A quiet button that is switched on: filled, as the map's pressed controls are. */
const pressedButtonClass = `${quietButtonBaseClass} border border-transparent bg-[var(--tfmc-cream)] font-semibold text-[var(--tfmc-forest-deep)]`;

export const selectClass =
  "h-10 w-full rounded-lg border border-[color-mix(in_srgb,var(--tfmc-cream)_15%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-cream)_5%,var(--tfmc-forest-deep))] px-2.5 text-sm text-[var(--tfmc-cream)] focus-visible:outline-2 focus-visible:outline-[var(--tfmc-accent)] disabled:cursor-not-allowed disabled:opacity-50";

const sectionRuleClass =
  "border-t border-[color-mix(in_srgb,var(--tfmc-cream)_10%,transparent)]";

export function SectionHeading({ title }: { title: string }) {
  return <h3 className="text-base font-semibold text-[var(--tfmc-cream)]">{title}</h3>;
}

/** Something the reader should know before going on: a warning or an aside. */
export function ChronicleNotice({
  children,
  tone = "warn",
}: {
  children: ReactNode;
  tone?: "warn" | "quiet";
}) {
  return (
    <p
      className={`rounded-lg px-3 py-2 text-xs leading-snug ${
        tone === "warn"
          ? "bg-[color-mix(in_srgb,var(--tfmc-accent)_16%,transparent)] text-[var(--tfmc-cream)]"
          : "bg-[color-mix(in_srgb,var(--tfmc-cream)_6%,transparent)] text-[var(--tfmc-stone)]"
      }`}
    >
      {children}
    </p>
  );
}

/** A row of choices, one of them on: frame sizes, GIF sizes, date spans. */
function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`h-8 rounded-full px-3 text-xs transition focus-visible:outline-2 focus-visible:outline-[var(--tfmc-accent)] disabled:cursor-not-allowed disabled:opacity-45 ${
              active
                ? "bg-[var(--tfmc-cream)] font-semibold text-[var(--tfmc-forest-deep)]"
                : "border border-[color-mix(in_srgb,var(--tfmc-cream)_18%,transparent)] text-[var(--tfmc-stone)] hover:enabled:text-[var(--tfmc-cream)]"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* The plaque. */

/** The studio's name plate, top left: back to the live map, and whose history this is. */
export function ChroniclePlaque({
  displayName,
  liveHref,
}: {
  displayName: string;
  liveHref: string;
}) {
  return (
    <div className="map-frame flex items-center gap-2.5 p-2 md:gap-3 md:p-3">
      <Link
        href={liveHref}
        aria-label="Back to the live map"
        title="Back to the live map"
        className="map-control h-10 w-10 shrink-0 rounded-full p-0"
      >
        <BackIcon size={18} />
      </Link>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-[var(--tfmc-mist)]">Timelapse</p>
        <h1 className="truncate font-[family-name:var(--font-fraunces)] text-lg leading-tight text-[var(--tfmc-cream)] md:text-2xl">
          {displayName}
        </h1>
      </div>
    </div>
  );
}

/* Steps. */

export type ChronicleStep = "layers" | "dates" | "watch";

const STEPS: { key: ChronicleStep; label: string }[] = [
  { key: "layers", label: "Layers" },
  { key: "dates", label: "Dates" },
  { key: "watch", label: "Watch" },
];

/**
 * The three steps across the top of the panel, pinned while it scrolls. A step
 * already reached can be gone back to; one not yet reached cannot be skipped
 * to, since each needs what the one before it settles.
 */
export function ChronicleSteps({
  current,
  reachable,
  onSelect,
}: {
  current: ChronicleStep;
  reachable: Record<ChronicleStep, boolean>;
  onSelect: (step: ChronicleStep) => void;
}) {
  const currentIndex = STEPS.findIndex((step) => step.key === current);
  return (
    // Pinned at the very top of the panel body, which has no top padding, so
    // Safari and Chrome agree where it rests (see PanelHeader). The upward
    // shadow seals the hairline iOS can leave above a sticky bar.
    <nav
      aria-label="Timelapse steps"
      className="sticky top-0 z-10 -mx-4 mb-4 border-b border-[color-mix(in_srgb,var(--tfmc-cream)_10%,transparent)] bg-[var(--tfmc-forest-deep)] px-3 pb-2.5 pt-1 shadow-[0_-4px_0_var(--tfmc-forest-deep)] md:rounded-t-[9px] md:pt-3"
    >
      <ol className="flex items-center gap-1">
        {STEPS.map((step, index) => {
          const isCurrent = step.key === current;
          const done = index < currentIndex;
          return (
            <li key={step.key} className="flex min-w-0 flex-1 items-center gap-1">
              <button
                type="button"
                aria-current={isCurrent ? "step" : undefined}
                disabled={!isCurrent && !reachable[step.key]}
                onClick={() => onSelect(step.key)}
                className={`flex min-w-0 flex-1 items-center justify-center gap-2 rounded-full py-1.5 pl-1.5 pr-3 text-sm transition focus-visible:outline-2 focus-visible:outline-[var(--tfmc-accent)] disabled:cursor-not-allowed ${
                  isCurrent
                    ? "bg-[color-mix(in_srgb,var(--tfmc-cream)_10%,transparent)] font-semibold text-[var(--tfmc-cream)]"
                    : "text-[var(--tfmc-stone)] enabled:hover:text-[var(--tfmc-cream)] disabled:opacity-50"
                }`}
              >
                <span
                  aria-hidden
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    isCurrent
                      ? "bg-[var(--tfmc-accent)] text-[var(--tfmc-forest-deep)]"
                      : done
                        ? "bg-[color-mix(in_srgb,var(--tfmc-accent)_35%,transparent)] text-[var(--tfmc-cream)]"
                        : "ring-1 ring-inset ring-[color-mix(in_srgb,var(--tfmc-cream)_25%,transparent)]"
                  }`}
                >
                  {index + 1}
                </span>
                <span className="truncate">{step.label}</span>
              </button>
              {index < STEPS.length - 1 ? (
                <span
                  aria-hidden
                  className="h-px w-2 shrink-0 bg-[color-mix(in_srgb,var(--tfmc-cream)_18%,transparent)]"
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/* Step 1: layers. */

type IconComponent = (props: { size?: number }) => ReactNode;

/** Each layer's tile: its icon, and a name short enough for a quarter of the panel. */
const TOGGLE_TILES: Record<ChronicleToggleKey, { icon: IconComponent; short: string }> = {
  nationFill: { icon: RealmIcon, short: "Nation fill" },
  nationBorders: { icon: BordersIcon, short: "Borders" },
  occupation: { icon: OccupationIcon, short: "Occupation" },
  tradeLeagues: { icon: TradeIcon, short: "Trade leagues" },
  prosperity: { icon: ProsperityIcon, short: "Prosperity" },
  nationNames: { icon: NamesIcon, short: "Nation names" },
  settlements: { icon: PinIcon, short: "Settlements" },
  markerNames: { icon: NameChipIcon, short: "Marker names" },
  forts: { icon: FortIcon, short: "Forts" },
  fortControl: { icon: HatchIcon, short: "Fort control" },
  wars: { icon: SwordsIcon, short: "Wars" },
};

/** The ground's colour, then what is drawn over it. */
const TOGGLE_GROUPS: { title: string; keys: ChronicleToggleKey[] }[] = [
  {
    title: "Territory",
    keys: ["nationFill", "nationBorders", "occupation", "tradeLeagues", "prosperity"],
  },
  {
    title: "On the map",
    keys: ["nationNames", "settlements", "markerNames", "forts", "fortControl", "wars"],
  },
];

const TOGGLE_DETAILS = new Map(
  CHRONICLE_TOGGLE_ORDER.map((toggle) => [toggle.key, toggle])
);

export function ChronicleTogglePanel({
  toggles,
  onToggle,
  disabledReasons,
  notice,
  focusOptions,
  focusNationId,
  onFocusChange,
  focusDisabledReason,
}: {
  toggles: ChronicleToggles;
  onToggle: (key: ChronicleToggleKey) => void;
  disabledReasons: Partial<Record<ChronicleToggleKey, string>>;
  notice: string | null;
  /** The realms the latest stored day knows about, already sorted by name. */
  focusOptions: ChronicleFocusOption[];
  focusNationId: string;
  onFocusChange: (nationId: string) => void;
  /**
   * Why a realm cannot be picked right now, or null. A focus is an optional
   * narrowing, so not being able to set one never blocks the next step.
   */
  focusDisabledReason: string | null;
}) {
  return (
    <div className="space-y-5">
      {/* Not on a phone, where the sheet's peek has room for the tiles only. */}
      <p className="text-sm leading-snug text-[var(--tfmc-stone)] max-md:hidden">
        The map starts bare. Pick what each day should show; the map previews the
        latest day as you go.
      </p>
      {notice ? <ChronicleNotice>{notice}</ChronicleNotice> : null}

      {TOGGLE_GROUPS.map((group) => (
        <section key={group.title}>
          <SectionHeading title={group.title} />
          <ul className="mt-3 grid grid-cols-4 gap-x-1 gap-y-3">
            {group.keys.map((key) => {
              const { icon: Glyph, short } = TOGGLE_TILES[key];
              const toggle = TOGGLE_DETAILS.get(key)!;
              const reason = disabledReasons[key];
              const on = toggles[key];
              return (
                <li key={key}>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={toggle.label}
                    title={reason ?? `${toggle.label}: ${toggle.detail}`}
                    disabled={Boolean(reason)}
                    onClick={() => onToggle(key)}
                    className={layerTileButtonClass}
                  >
                    <span
                      className={`${layerTileFrameClass} ${layerTileRingClass(on)} ${layerTileIconClass(on)}`}
                    >
                      <Glyph size={28} />
                    </span>
                    <span lang="en" className={layerTileLabelClass(on)}>
                      {short}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {Object.entries(disabledReasons).map(([key, reason]) => (
        <ChronicleNotice key={key} tone="quiet">
          {TOGGLE_DETAILS.get(key as ChronicleToggleKey)?.label}: {reason}
        </ChronicleNotice>
      ))}

      <section className={`${sectionRuleClass} pt-4`}>
        <label className="block">
          <SectionHeading title="Focus a nation" />
          <select
            className={`${selectClass} mt-2`}
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
          <span className="mt-1.5 block text-xs text-[var(--tfmc-stone)]">
            {focusDisabledReason ?? "One nation keeps its colour; the rest are shaded."}
          </span>
        </label>
      </section>
    </div>
  );
}

/* Step 2: dates. */

/** Quick spans, counted back from the latest stored day. */
const RANGE_PRESETS = [7, 14, 30] as const;

/** The first day of the last `count` stored days. */
function presetStart(days: string[], count: number): string | undefined {
  return days[Math.max(0, days.length - count)];
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
  notice,
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
  notice?: string | null;
}) {
  const last = days[days.length - 1];
  const presets = [
    ...RANGE_PRESETS.filter((count) => count < days.length).map((count) => ({
      value: `last-${count}`,
      label: `Last ${count} days`,
      start: presetStart(days, count),
    })),
    { value: "all", label: "All", start: days[0] },
  ];
  const activePreset =
    end === last ? (presets.find((preset) => preset.start === start)?.value ?? null) : null;

  const dayOption = (day: string) => (
    <option key={day} value={day}>
      {formatChronicleDay(day)}
      {incompleteDays.has(day) ? " (incomplete)" : ""}
    </option>
  );

  return (
    <div className="space-y-5">
      {notice ? <ChronicleNotice>{notice}</ChronicleNotice> : null}
      <section>
        <SectionHeading title="Which days" />
        <div className="mt-3">
          <Segmented
            label="Quick spans"
            options={presets.map(({ value, label }) => ({ value, label }))}
            value={activePreset}
            onChange={(value) => {
              const preset = presets.find((candidate) => candidate.value === value);
              if (!preset?.start || !last) return;
              onStartChange(preset.start);
              onEndChange(last);
            }}
          />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="text-xs text-[var(--tfmc-mist)]">
            From
            <select
              className={`${selectClass} mt-1`}
              value={start ?? ""}
              onChange={(e) => onStartChange(e.target.value)}
            >
              {days.map(dayOption)}
            </select>
          </label>
          <label className="text-xs text-[var(--tfmc-mist)]">
            To
            <select
              className={`${selectClass} mt-1`}
              value={end ?? ""}
              onChange={(e) => onEndChange(e.target.value)}
            >
              {days.map(dayOption)}
            </select>
          </label>
        </div>
        {selection.incompleteDays.length && !selection.error ? (
          <p className="mt-2 text-xs text-[var(--tfmc-accent)]">
            {selection.incompleteDays.length} day
            {selection.incompleteDays.length === 1 ? " was" : "s were"} captured with
            missing sources.
          </p>
        ) : null}
      </section>

      <section>
        <SectionHeading title="Frame size" />
        <div className="mt-3">
          <Segmented
            label="Frame size"
            options={CHRONICLE_RENDER_SIZES.map((size) => ({
              value: size,
              label: `${size} px`,
            }))}
            value={renderSize}
            onChange={onRenderSizeChange}
          />
        </div>
      </section>

      <section
        aria-label="Estimate"
        className="rounded-xl bg-[color-mix(in_srgb,var(--tfmc-cream)_6%,transparent)] p-3"
      >
        {selection.error ? (
          <p className="text-sm text-[var(--tfmc-accent)]">{selection.error}</p>
        ) : (
          <dl className="grid grid-cols-3 gap-2 text-center">
            <div>
              <dt className="text-xs text-[var(--tfmc-mist)]">Frames</dt>
              <dd className="mt-0.5 text-lg font-semibold text-[var(--tfmc-cream)]">
                {selection.days.length}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--tfmc-mist)]">Build time</dt>
              <dd className="mt-0.5 text-lg font-semibold text-[var(--tfmc-cream)]">
                ~{formatChronicleDuration(estimate.totalMs)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--tfmc-mist)]">Memory</dt>
              <dd className="mt-0.5 text-lg font-semibold text-[var(--tfmc-cream)]">
                ~{formatChronicleBytes(estimate.memoryBytes)}
              </dd>
            </div>
          </dl>
        )}
      </section>

      {estimate.overCeiling ? (
        <ChronicleNotice>
          {formatChronicleBytes(estimate.memoryBytes)} of frames is more than this
          browser should hold at once. Shorten the range or pick a smaller frame size.
        </ChronicleNotice>
      ) : blockReason && !selection.error ? (
        <ChronicleNotice>{blockReason}</ChronicleNotice>
      ) : null}
    </div>
  );
}

/** The build in progress, in place of the date controls. */
export function ChronicleBuildPanel({
  progress,
  error,
}: {
  progress: ChronicleBuildProgress | null;
  error: string | null;
}) {
  const total = progress?.total ?? 0;
  const completed = progress?.completed ?? 0;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="space-y-3" aria-live="polite">
      <SectionHeading title="Building frames" />
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-[family-name:var(--font-fraunces)] text-2xl text-[var(--tfmc-cream)]">
          {pct}%
        </p>
        <p className="text-sm text-[var(--tfmc-stone)]">
          {completed} of {total} days
        </p>
      </div>
      <div
        role="progressbar"
        aria-label="Build progress"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={completed}
        className="h-2 w-full overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)]"
      >
        <div
          className="h-full rounded-full bg-[var(--tfmc-accent)] transition-[width] duration-150 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      {progress ? (
        <p className="text-xs text-[var(--tfmc-stone)]">
          {progress.day ? `${formatChronicleDay(progress.day)} · ` : ""}
          {progress.painted} painted, {progress.reused} reused
          {progress.skipped ? `, ${progress.skipped} skipped` : ""}
        </p>
      ) : null}
      {error ? <ChronicleNotice>{error}</ChronicleNotice> : null}
    </div>
  );
}

/* Step 3: watch. */

export const CHRONICLE_SPEEDS = [1, 2, 4, 8, 16] as const;

function nextSpeed(speed: number): number {
  const index = CHRONICLE_SPEEDS.findIndex((value) => value === speed);
  return CHRONICLE_SPEEDS[(index + 1) % CHRONICLE_SPEEDS.length] ?? CHRONICLE_SPEEDS[0];
}

const transportButtonClass =
  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--tfmc-stone)] transition hover:enabled:bg-[color-mix(in_srgb,var(--tfmc-cream)_8%,transparent)] hover:enabled:text-[var(--tfmc-cream)] focus-visible:outline-2 focus-visible:outline-[var(--tfmc-accent)] disabled:opacity-35";

export type ChroniclePlayerProps = {
  days: string[];
  activeIndex: number;
  onScrub: (index: number) => void;
  playing: boolean;
  onTogglePlay: () => void;
  speed: number;
  onSpeedChange: (speed: number) => void;
  loop: boolean;
  onLoopChange: (loop: boolean) => void;
  /** The day on screen was captured with sources missing. */
  incomplete: boolean;
  /** A card along the foot of the map, or rows at the top of the phone sheet. */
  variant: "bar" | "sheet";
};

/**
 * The timelapse's transport, like a video player's: play, the day on screen,
 * a scrubber across every built day, step a day either way, speed and loop.
 */
export function ChroniclePlayer({
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
  variant,
}: ChroniclePlayerProps) {
  const total = days.length;
  const day = days[activeIndex];
  const max = Math.max(0, total - 1);
  const progress = max > 0 ? (activeIndex / max) * 100 : 0;

  const play = (
    <button
      type="button"
      onClick={onTogglePlay}
      disabled={total < 2}
      aria-label={playing ? "Pause" : "Play"}
      title={playing ? "Pause (Space)" : "Play (Space)"}
      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--tfmc-accent)] text-[var(--tfmc-forest-deep)] shadow-[0_2px_10px_rgb(0_0_0/0.35)] transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tfmc-cream)] disabled:opacity-45"
    >
      {playing ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
    </button>
  );
  const dateBlock = (
    <div className="min-w-0">
      <p
        className="truncate font-[family-name:var(--font-fraunces)] text-lg leading-tight text-[var(--tfmc-cream)]"
        aria-live={playing ? "off" : "polite"}
      >
        {day ? formatChronicleDay(day) : "—"}
      </p>
      <p className="truncate text-xs text-[var(--tfmc-mist)]">
        Day {Math.min(activeIndex + 1, total)} of {total}
        {incomplete ? <span className="text-[var(--tfmc-accent)]"> · sources missing</span> : null}
      </p>
    </div>
  );
  const scrubber = (
    <div className="flex min-w-0 flex-1 items-center gap-0.5">
      <button
        type="button"
        className={transportButtonClass}
        aria-label="Previous day"
        title="Previous day"
        disabled={activeIndex <= 0}
        onClick={() => onScrub(activeIndex - 1)}
      >
        <StepBackIcon size={16} />
      </button>
      <input
        type="range"
        className="chronicle-scrubber min-w-0 flex-1"
        style={{ "--progress": `${progress}%` } as CSSProperties}
        min={0}
        max={max}
        step={1}
        value={activeIndex}
        onChange={(e) => onScrub(Number(e.target.value))}
        aria-label="Day"
        aria-valuetext={day ? formatChronicleDay(day) : undefined}
      />
      <button
        type="button"
        className={transportButtonClass}
        aria-label="Next day"
        title="Next day"
        disabled={activeIndex >= max}
        onClick={() => onScrub(activeIndex + 1)}
      >
        <StepForwardIcon size={16} />
      </button>
    </div>
  );
  const settings = (
    <div className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        className={`${transportButtonClass} w-auto min-w-9 px-2 text-xs font-semibold tabular-nums`}
        onClick={() => onSpeedChange(nextSpeed(speed))}
        aria-label={`Speed: ${speed} ${speed === 1 ? "day" : "days"} a second`}
        title={`${speed} ${speed === 1 ? "day" : "days"} a second; click for ${nextSpeed(speed)}`}
      >
        {speed}×
      </button>
      <button
        type="button"
        className={`${transportButtonClass} ${
          loop ? "bg-[color-mix(in_srgb,var(--tfmc-accent)_28%,transparent)] text-[var(--tfmc-cream)]" : ""
        }`}
        aria-pressed={loop}
        aria-label="Loop"
        title={loop ? "Looping: on" : "Looping: off"}
        onClick={() => onLoopChange(!loop)}
      >
        <LoopIcon size={17} />
      </button>
    </div>
  );

  if (variant === "sheet") {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          {play}
          <div className="min-w-0 flex-1">{dateBlock}</div>
          {settings}
        </div>
        {scrubber}
      </div>
    );
  }
  return (
    <div className="map-frame flex items-center gap-3 py-2 pl-2 pr-3">
      {play}
      <div className="w-32 shrink-0">{dateBlock}</div>
      {scrubber}
      {settings}
    </div>
  );
}

function ExportSwitch({
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
      className={`flex items-center justify-between gap-3 py-1.5 text-sm ${
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      } text-[var(--tfmc-cream)]`}
    >
      <span>{label}</span>
      <input
        type="checkbox"
        role="switch"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        aria-hidden
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--tfmc-accent)] ${
          checked
            ? "bg-[var(--tfmc-accent)]"
            : "bg-[color-mix(in_srgb,var(--tfmc-cream)_18%,transparent)]"
        }`}
      >
        <span
          className={`h-3.5 w-3.5 rounded-full bg-[var(--tfmc-cream)] shadow transition-transform ${
            checked ? "translate-x-[1.125rem]" : "translate-x-[0.1875rem]"
          }`}
        />
      </span>
    </label>
  );
}

/**
 * Where the watermark goes: a little frame with a spot in each corner, the
 * chosen one filled, as the logo and link will sit in the GIF.
 */
function WatermarkCornerPicker({
  value,
  onChange,
  disabled,
}: {
  value: ChronicleWatermarkCorner;
  onChange: (corner: ChronicleWatermarkCorner) => void;
  disabled: boolean;
}) {
  const label = CHRONICLE_WATERMARK_CORNERS.find((corner) => corner.value === value)?.label;
  return (
    <div className="mt-4 flex items-center gap-4">
      <div
        role="radiogroup"
        aria-label="Watermark position"
        className="grid h-20 w-28 shrink-0 grid-cols-2 grid-rows-2 gap-1 rounded-lg border border-[color-mix(in_srgb,var(--tfmc-cream)_18%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-cream)_5%,transparent)] p-1.5"
      >
        {CHRONICLE_WATERMARK_CORNERS.map((corner) => {
          const active = corner.value === value;
          const [vertical, horizontal] = corner.value.split("-");
          return (
            <button
              key={corner.value}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={corner.label}
              title={corner.label}
              disabled={disabled}
              onClick={() => onChange(corner.value)}
              className={`group flex rounded focus-visible:outline-2 focus-visible:outline-[var(--tfmc-accent)] disabled:cursor-not-allowed ${
                vertical === "top" ? "items-start" : "items-end"
              } ${horizontal === "left" ? "justify-start" : "justify-end"}`}
            >
              <span
                aria-hidden
                className={`h-3 w-7 rounded-sm transition ${
                  active
                    ? "bg-[var(--tfmc-accent)]"
                    : "bg-[color-mix(in_srgb,var(--tfmc-cream)_16%,transparent)] group-hover:group-enabled:bg-[color-mix(in_srgb,var(--tfmc-cream)_32%,transparent)]"
                }`}
              />
            </button>
          );
        })}
      </div>
      <div className="min-w-0 text-sm">
        <p className="text-[var(--tfmc-cream)]">Watermark</p>
        <p className="text-xs text-[var(--tfmc-stone)]">
          {label}. The TFMC logo and Discord link go on every GIF.
        </p>
      </div>
    </div>
  );
}

export function ChroniclePlaybackPanel({
  player,
  skippedDays,
  exploreHref,
  chartsOpen,
  onToggleCharts,
  charts,
  gifSize,
  onGifSizeChange,
  gifStampDay,
  onGifStampDayChange,
  gifCorner,
  onGifCornerChange,
  gifStatus,
  gifError,
  gifNotice,
}: {
  /** The player, for a phone: on a desktop it runs along the foot of the map. */
  player?: ReactNode;
  skippedDays: string[];
  /**
   * Route to the standalone viewer for the day currently on screen, or `null`
   * when there is no day to explore. Built by `ChronicleStudio`, which is the
   * component that knows the `mapId`; rebuilding the route in here would mean
   * a second place that has to remember the `dev` -> `r3b1rth` rename.
   */
  exploreHref?: string | null;
  /** Whether the ledger charts are showing. */
  chartsOpen: boolean;
  onToggleCharts: () => void;
  /** The charts themselves, for a phone: on a desktop they sit on the right. */
  charts?: ReactNode;
  gifSize: number;
  onGifSizeChange: (size: number) => void;
  /**
   * Whether each exported frame carries its own day. A property of the file
   * only — the preview never draws it.
   */
  gifStampDay: boolean;
  onGifStampDayChange: (stamp: boolean) => void;
  /** The corner the TFMC logo and discord.gg/tfmc line sit in. Always drawn. */
  gifCorner: ChronicleWatermarkCorner;
  onGifCornerChange: (corner: ChronicleWatermarkCorner) => void;
  /**
   * What the export is doing right now, or null when idle. Non-null also
   * disables the export options, so they cannot change under a running export.
   */
  gifStatus: string | null;
  gifError: string | null;
  /** A GIF that was produced with something missing from it. Not a failure. */
  gifNotice: string | null;
}) {
  const exporting = gifStatus != null;
  return (
    <div className="space-y-5">
      {player ? <div className="md:hidden">{player}</div> : null}

      <div className="flex flex-wrap gap-2">
        {exploreHref ? (
          <Link href={exploreHref} className={`${quietButtonClass} no-underline`}>
            Open this day on the map
          </Link>
        ) : null}
        <button
          type="button"
          className={chartsOpen ? pressedButtonClass : quietButtonClass}
          onClick={onToggleCharts}
          aria-pressed={chartsOpen}
        >
          <ChartIcon size={16} />
          Charts
        </button>
      </div>

      {chartsOpen && charts ? <div className="space-y-3 md:hidden">{charts}</div> : null}

      {skippedDays.length ? (
        <ChronicleNotice tone="quiet">
          {skippedDays.length} day{skippedDays.length === 1 ? " had" : "s had"} no stored
          sources and {skippedDays.length === 1 ? "was" : "were"} left out.
        </ChronicleNotice>
      ) : null}

      <section className={`${sectionRuleClass} pt-4`}>
        <SectionHeading title="Export a GIF" />
        <div className="mt-3">
          <Segmented
            label="GIF size"
            options={CHRONICLE_GIF_SIZES.map((size) => ({ value: size, label: `${size} px` }))}
            value={gifSize}
            onChange={onGifSizeChange}
            disabled={exporting}
          />
        </div>
        <WatermarkCornerPicker
          value={gifCorner}
          onChange={onGifCornerChange}
          disabled={exporting}
        />
        <div className="mt-2">
          <ExportSwitch
            label="Stamp the date"
            checked={gifStampDay}
            disabled={exporting}
            onChange={onGifStampDayChange}
          />
        </div>
        {gifError ? (
          <div className="mt-2">
            <ChronicleNotice>{gifError}</ChronicleNotice>
          </div>
        ) : null}
        {gifNotice ? (
          <div className="mt-2">
            <ChronicleNotice tone="quiet">{gifNotice}</ChronicleNotice>
          </div>
        ) : null}
      </section>
    </div>
  );
}

/**
 * The phone sheet pulled down out of the way: one row naming the step, which
 * opens it again. The map is the point of a timelapse, so it can have the
 * whole screen.
 */
export function ChronicleSheetSummary({
  step,
  summary,
  onOpen,
}: {
  step: ChronicleStep;
  summary: string;
  onOpen: () => void;
}) {
  const label = STEPS.find((candidate) => candidate.key === step)?.label ?? "";
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 py-2 text-left"
      aria-label={`Show the timelapse controls: ${label}`}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-[var(--tfmc-mist)]">{label}</span>
        <span className="block truncate text-sm text-[var(--tfmc-cream)]">{summary}</span>
      </span>
      <BackIcon size={18} className="rotate-90 text-[var(--tfmc-stone)]" />
    </button>
  );
}
