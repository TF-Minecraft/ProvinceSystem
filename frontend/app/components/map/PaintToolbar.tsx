"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

import {
  PAINT_COLORS,
  PAINT_COLOR_IDS,
  PAINT_COLOR_LABELS,
  PAINT_STAMP_ICON_IDS,
  PAINT_BG_OPACITY_MAX,
  PAINT_BG_OPACITY_STEP,
  PAINT_FONT_IDS,
  PAINT_FONT_LABELS,
  PAINT_INK_BACKING,
  PAINT_TEXT_BG_IDS,
  PAINT_TEXT_BG_LABELS,
  paintTextBgColor,
  PAINT_WIDTH_MAX,
  PAINT_WIDTH_MIN,
  PAINT_WIDTH_STEP,
  paintStampLabel,
  paintStampSrc,
  type PaintColorId,
  type PaintTool,
} from "../../lib/mapPaint";
import type { UseMapPaintResult } from "../../hooks/useMapPaint";

const panelClass = "map-frame";

const activeClass =
  "bg-[color-mix(in_srgb,var(--tfmc-cream)_92%,transparent)] text-[var(--tfmc-forest-deep)]";
const idleClass =
  "text-[var(--tfmc-cream)] hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_15%,transparent)]";

const TOOLS: { value: PaintTool; label: string; hint: string }[] = [
  { value: "brush", label: "Brush", hint: "Freehand line" },
  { value: "arrow", label: "Arrow", hint: "Drag to draw an arrow" },
  { value: "stamp", label: "Object", hint: "Click to place an object" },
  { value: "text", label: "Text", hint: "Click to place a label" },
  {
    value: "move",
    label: "Select",
    hint: "Drag to move · corners resize · knob rotates · click a label again to edit",
  },
  { value: "eraser", label: "Eraser", hint: "Click or drag to remove" },
];

const MARK_BASE: CSSProperties = { fontWeight: 500, fontStyle: "normal", textDecoration: "none" };

const TEXT_MARKS: {
  key: "bold" | "italic" | "underline" | "strike";
  label: string;
  title: string;
  /** Preview styling for the button glyph itself, so B looks bold and I italic. */
  style: CSSProperties;
}[] = [
  { key: "bold", label: "B", title: "Bold (§l)", style: { ...MARK_BASE, fontWeight: 700 } },
  { key: "italic", label: "I", title: "Italic (§o)", style: { ...MARK_BASE, fontStyle: "italic" } },
  { key: "underline", label: "U", title: "Underline (§n)", style: { ...MARK_BASE, textDecoration: "underline" } },
  { key: "strike", label: "S", title: "Strikethrough (§m)", style: { ...MARK_BASE, textDecoration: "line-through" } },
];

type PaintToolbarProps = { paint: UseMapPaintResult };

/**
 * Floating panel for the war-planning paint layer, shown while paint mode is
 * on (the Layers menu's "War planning" switch turns it on).
 */
export default function PaintToolbar({ paint }: PaintToolbarProps) {
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!shareNote) return;
    const timer = window.setTimeout(() => setShareNote(null), 5000);
    return () => window.clearTimeout(timer);
  }, [shareNote]);

  function handleExport() {
    const { json, filename } = paint.exportPlan();
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    setShareNote(`Exported ${paint.shapes.length} drawing(s).`);
  }

  async function handleImportFile(file: File) {
    const result = paint.importPlan(await file.text());
    setShareNote(
      result.ok
        ? `Imported ${result.shapes.length} drawing(s)` +
            (result.skipped ? `, skipped ${result.skipped} unreadable.` : ".")
        : result.reason
    );
  }

  useEffect(() => {
    if (!confirmingClear) return;
    const timer = window.setTimeout(() => setConfirmingClear(false), 4000);
    return () => window.clearTimeout(timer);
  }, [confirmingClear]);

  const hasShapes = paint.shapes.length > 0;
  const selectedStamp =
    paint.selectedShape?.type === "stamp" ? paint.selectedShape : null;
  const showStampOptions = paint.tool === "stamp" || !!selectedStamp;
  // Reflect the selected object's own state, falling back to what the next
  // placement is armed with.
  const mirrored = selectedStamp ? !!selectedStamp.flipX : paint.stampFlipX;

  return (
    <div className={`${panelClass} p-2`}>
      <div className="flex w-full items-center justify-between gap-2 px-1 py-0.5">
        <span className="truncate text-xs font-semibold uppercase tracking-wide text-[var(--tfmc-stone)]">
          War planning
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={paint.enabled}
          aria-label="Toggle war planning"
          onClick={() => paint.setEnabled(!paint.enabled)}
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
            paint.enabled
              ? "bg-[var(--tfmc-accent)]"
              : "bg-[color-mix(in_srgb,var(--tfmc-cream)_20%,transparent)]"
          }`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-[var(--tfmc-cream)] transition-all ${
              paint.enabled ? "left-[1.125rem]" : "left-0.5"
            }`}
          />
        </button>
      </div>

      {paint.enabled ? (
        <div className="mt-2 flex items-center gap-1 border-t border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] pt-2">
          <button
            type="button"
            onClick={handleExport}
            disabled={!paint.shapes.length}
            title="Download this plan"
            className={`rounded-md px-2 py-1 text-xs ${idleClass} disabled:opacity-35`}
          >
            Download plan
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Open a downloaded plan (replaces this one)"
            className={`rounded-md px-2 py-1 text-xs ${idleClass}`}
          >
            Open plan
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Reset first, so picking the same file twice still fires.
              event.target.value = "";
              if (file) void handleImportFile(file);
            }}
          />
        </div>
      ) : null}

      {shareNote ? (
        <p className="mt-1 px-1 text-[0.65rem] leading-tight text-[var(--tfmc-mist)]">
          {shareNote}
        </p>
      ) : null}

      {paint.enabled ? (
        <div className="mt-2 space-y-2 border-t border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] pt-2">
          <div className="grid grid-cols-3 gap-1">
            {TOOLS.map((entry) => (
              <button
                key={entry.value}
                type="button"
                title={entry.hint}
                aria-pressed={paint.tool === entry.value}
                onClick={() => paint.setTool(entry.value)}
                className={`rounded-md px-2 py-1.5 text-xs ${
                  paint.tool === entry.value ? activeClass : idleClass
                }`}
              >
                {entry.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {PAINT_COLOR_IDS.map((id) => (
              <button
                key={id}
                type="button"
                title={PAINT_COLOR_LABELS[id]}
                aria-label={`Ink colour ${PAINT_COLOR_LABELS[id]}`}
                aria-pressed={paint.color === id}
                onClick={() => paint.setColor(id)}
                className={`h-6 w-6 rounded-full border-2 transition-transform ${
                  paint.color === id
                    ? "scale-110 border-[var(--tfmc-cream)]"
                    : "border-transparent"
                }`}
                style={{ backgroundColor: PAINT_COLORS[id] }}
              />
            ))}
          </div>

          <div className="space-y-1">
            <div className="flex items-baseline justify-between">
              <span className="text-[0.65rem] uppercase tracking-wide text-[var(--tfmc-stone)]">
                {PAINT_COLOR_LABELS[paint.color]}
              </span>
              <span className="text-[0.65rem] tabular-nums text-[var(--tfmc-stone)]">
                Size {paint.width.toFixed(1)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={PAINT_WIDTH_MIN}
                max={PAINT_WIDTH_MAX}
                step={PAINT_WIDTH_STEP}
                value={paint.width}
                onChange={(event) => paint.setWidth(Number(event.target.value))}
                aria-label="Stroke size"
                className="h-6 w-full accent-[var(--tfmc-accent)]"
                style={{ accentColor: PAINT_COLORS[paint.color] }}
              />
              {/* Live sample of what the slider is about to draw. */}
              <span
                aria-hidden
                className="block w-6 shrink-0 rounded-full"
                style={{
                  height: Math.max(2, paint.width),
                  backgroundColor: PAINT_COLORS[paint.color],
                }}
              />
            </div>
          </div>

          {paint.tool === "text" || paint.selectedShape?.type === "text" ? (
            <div className="space-y-1.5 rounded-md border border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] p-1.5">
              <div className="grid grid-cols-3 gap-1">
                {PAINT_FONT_IDS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={paint.textStyle.font === id}
                    onClick={() => paint.setTextStyle({ font: id })}
                    className={`rounded-md px-2 py-1 text-xs ${
                      paint.textStyle.font === id ? activeClass : idleClass
                    }`}
                  >
                    {PAINT_FONT_LABELS[id]}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1">
                <span className="flex items-center gap-1">
                  {TEXT_MARKS.map((mark) => (
                    <button
                      key={mark.key}
                      type="button"
                      title={mark.title}
                      aria-label={mark.title}
                      aria-pressed={paint.textStyle[mark.key]}
                      onClick={() =>
                        paint.setTextStyle({ [mark.key]: !paint.textStyle[mark.key] })
                      }
                      className={`h-6 w-6 rounded-md text-xs ${
                        paint.textStyle[mark.key] ? activeClass : idleClass
                      }`}
                      style={mark.style}
                    >
                      {mark.label}
                    </button>
                  ))}
                </span>
              </div>
              <label className="flex items-center gap-2 text-[0.65rem] uppercase tracking-wide text-[var(--tfmc-stone)]">
                Background
                <input
                  type="range"
                  min={0}
                  max={PAINT_BG_OPACITY_MAX}
                  step={PAINT_BG_OPACITY_STEP}
                  value={paint.textStyle.bgOpacity}
                  onChange={(event) =>
                    paint.setTextStyle({ bgOpacity: Number(event.target.value) })
                  }
                  aria-label="Label background opacity"
                  className="h-6 w-full"
                  style={{ accentColor: PAINT_COLORS[paint.color] }}
                />
                <span className="tabular-nums">
                  {Math.round(paint.textStyle.bgOpacity * 100)}%
                </span>
              </label>
              {paint.textStyle.bgOpacity > 0 ? (
                <div className="flex flex-wrap items-center gap-1">
                  {PAINT_TEXT_BG_IDS.map((id) => {
                    const swatch = paintTextBgColor(id, paint.color);
                    const label =
                      PAINT_TEXT_BG_LABELS[id] ?? PAINT_COLOR_LABELS[id as PaintColorId];
                    return (
                      <button
                        key={id}
                        type="button"
                        title={`Background: ${label}`}
                        aria-label={`Background colour ${label}`}
                        aria-pressed={paint.textStyle.bgColor === id}
                        onClick={() => paint.setTextStyle({ bgColor: id })}
                        className={`h-5 w-5 rounded-full border-2 ${
                          paint.textStyle.bgColor === id
                            ? "scale-110 border-[var(--tfmc-cream)]"
                            : "border-transparent"
                        }`}
                        style={{
                          backgroundColor: swatch,
                          // "Match ink" is the only one whose colour is derived,
                          // so mark it rather than leaving two identical dots.
                          backgroundImage:
                            id === "ink"
                              ? `linear-gradient(135deg, ${swatch} 50%, ${PAINT_INK_BACKING} 50%)`
                              : undefined,
                        }}
                      />
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : null}

          {showStampOptions ? (
            <button
              type="button"
              aria-pressed={mirrored}
              onClick={() => paint.setStampFlipX(!mirrored)}
              title="Mirror the object left-to-right"
              className={`w-full rounded-md px-2 py-1 text-xs ${
                mirrored ? activeClass : idleClass
              }`}
            >
              Mirror horizontally
            </button>
          ) : null}

          {paint.tool === "stamp" ? (
            <div className="max-h-40 overflow-auto rounded-md border border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] p-1">
              <div className="grid grid-cols-5 gap-1">
                {PAINT_STAMP_ICON_IDS.map((icon) => (
                  <button
                    key={icon}
                    type="button"
                    title={paintStampLabel(icon)}
                    aria-label={paintStampLabel(icon)}
                    aria-pressed={paint.stampIcon === icon}
                    onClick={() => paint.setStampIcon(icon)}
                    className={`flex aspect-square items-center justify-center rounded-md p-1 ${
                      paint.stampIcon === icon ? activeClass : idleClass
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={paintStampSrc(icon)}
                      alt=""
                      className="max-h-full max-w-full object-contain [image-rendering:pixelated]"
                    />
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {paint.enabled || hasShapes ? (
        <div className="mt-2 flex items-center gap-1 border-t border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] pt-2">
          <button
            type="button"
            onClick={paint.undo}
            disabled={!paint.canUndo}
            aria-label="Undo"
            className={`rounded-md px-2 py-1 text-xs ${idleClass} disabled:opacity-35`}
          >
            Undo
          </button>
          <button
            type="button"
            onClick={paint.redo}
            disabled={!paint.canRedo}
            aria-label="Redo"
            className={`rounded-md px-2 py-1 text-xs ${idleClass} disabled:opacity-35`}
          >
            Redo
          </button>
          <button
            type="button"
            onClick={() => paint.setVisible(!paint.visible)}
            aria-pressed={!paint.visible}
            aria-label={paint.visible ? "Hide drawings" : "Show drawings"}
            className={`rounded-md px-2 py-1 text-xs ${idleClass}`}
          >
            {paint.visible ? "Hide" : "Show"}
          </button>
          <button
            type="button"
            disabled={!hasShapes}
            onClick={() => {
              if (confirmingClear) {
                paint.clearAll();
                setConfirmingClear(false);
              } else {
                setConfirmingClear(true);
              }
            }}
            className={`ml-auto rounded-md px-2 py-1 text-xs disabled:opacity-35 ${
              confirmingClear
                ? "bg-[color-mix(in_srgb,#e85d5d_80%,transparent)] text-[var(--tfmc-forest-deep)]"
                : idleClass
            }`}
          >
            {confirmingClear ? "Sure?" : "Clear"}
          </button>
        </div>
      ) : null}

      {paint.enabled ? (
        <p className="mt-2 px-1 text-[0.65rem] leading-tight text-[var(--tfmc-stone)]">
          Drag to draw. Select a drawing to move, resize or rotate it.
        </p>
      ) : null}
    </div>
  );
}
