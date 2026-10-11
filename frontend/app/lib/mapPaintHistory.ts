/**
 * Undo/redo for the paint layer. Shapes are immutable, so a snapshot is just an
 * array copy — cheap, and structurally shared with the previous snapshot.
 *
 * Granularity is one entry per completed *gesture* (stroke, stamp, erase drag,
 * move), never per intermediate pointer sample. In-progress geometry lives in
 * a separate draft outside `present` so the live preview never enters history.
 */

import type { PaintShape } from "./mapPaint";

export const PAINT_HISTORY_LIMIT = 60;

export type PaintHistory = {
  past: PaintShape[][];
  present: PaintShape[];
  future: PaintShape[][];
};

export function createPaintHistory(present: PaintShape[] = []): PaintHistory {
  return { past: [], present, future: [] };
}

export function commitPaintHistory(history: PaintHistory, next: PaintShape[]): PaintHistory {
  if (next === history.present) return history;
  const past = [...history.past, history.present];
  return {
    past: past.length > PAINT_HISTORY_LIMIT ? past.slice(past.length - PAINT_HISTORY_LIMIT) : past,
    present: next,
    future: [],
  };
}

export function canUndoPaint(history: PaintHistory): boolean {
  return history.past.length > 0;
}

export function canRedoPaint(history: PaintHistory): boolean {
  return history.future.length > 0;
}

export function undoPaintHistory(history: PaintHistory): PaintHistory {
  if (!canUndoPaint(history)) return history;
  const previous = history.past[history.past.length - 1];
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redoPaintHistory(history: PaintHistory): PaintHistory {
  if (!canRedoPaint(history)) return history;
  const [next, ...rest] = history.future;
  return {
    past: [...history.past, history.present],
    present: next,
    future: rest,
  };
}
