"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from "react";

import type { MapId } from "../components/map/types";
import {
  PAINT_BRUSH_MIN_POINT_SCREEN_PX,
  PAINT_ERASER_SCREEN_PX,
  PAINT_HANDLE_SCREEN_PX,
  PAINT_ROTATION_SNAP_DEGREES,
  PAINT_TEXT_STYLE_DEFAULT,
  PAINT_MAX_BRUSH_POINTS,
  PAINT_MAX_SHAPES,
  PAINT_MAX_TEXT_LENGTH,
  createPaintShapeId,
  paintMapPx,
  paintShapeRotation,
  paintSizesMapPx,
  type PaintColorId,
  type PaintPoint,
  type PaintShape,
  type PaintStampIconId,
  type PaintStampShape,
  type PaintTextShape,
  type PaintTextStyle,
  type PaintTool,
  PAINT_WIDTH_DEFAULT,
  clampPaintWidth,
  type PaintWidth,
} from "../lib/mapPaint";
import {
  appendBrushPoint,
  boundsCentre,
  paintShapeBounds,
  pickPaintHandle,
  pickTopPaintShapeAt,
  rotatePaintShape,
  scalePaintShape,
  toShapeLocalPoint,
  translatePaintShape,
} from "../lib/mapPaintGeometry";
import {
  canRedoPaint,
  canUndoPaint,
  commitPaintHistory,
  createPaintHistory,
  redoPaintHistory,
  undoPaintHistory,
  type PaintHistory,
} from "../lib/mapPaintHistory";
import {
  exportPaintDocument,
  importPaintDocument,
  loadPaintPlan,
  paintExportFilename,
  savePaintShapes,
  type PaintImportResult,
} from "../lib/mapPaintStorage";
import { screenPointToMap, type MapPickViewport } from "./useMapCoords";

const SAVE_DEBOUNCE_MS = 400;

/** How far above the selection box the rotation knob sits, in handle widths. */
const ROTATION_KNOB_GAP = 3;

function pointerAngle(centre: PaintPoint, p: PaintPoint): number {
  return (Math.atan2(p.y - centre.y, p.x - centre.x) * 180) / Math.PI;
}

/** Knob position in the shape's own unrotated frame. */
export function paintRotationKnob(
  bounds: { x: number; y: number; w: number; h: number },
  handleMapPx: number,
): PaintPoint {
  return {
    x: bounds.x + bounds.w / 2,
    y: bounds.y - handleMapPx * ROTATION_KNOB_GAP,
  };
}

type Gesture =
  | { kind: "brush"; pointerId: number }
  | { kind: "arrow"; pointerId: number }
  | { kind: "erase"; pointerId: number; snapshot: PaintShape[] }
  | {
      kind: "move";
      pointerId: number;
      snapshot: PaintShape[];
      shapeId: string;
      last: PaintPoint;
    }
  | {
      kind: "rotate";
      pointerId: number;
      snapshot: PaintShape[];
      shapeId: string;
      centre: PaintPoint;
      /** Rotation at grab time, plus the pointer angle then, so drags are relative. */
      startRotation: number;
      startAngle: number;
    }
  | {
      kind: "resize";
      pointerId: number;
      snapshot: PaintShape[];
      /** Scaled from the original each move, so repeated factors cannot drift. */
      original: PaintShape;
      anchor: PaintPoint;
      startDistance: number;
    };

export type PaintTextEditorState = {
  shape: PaintTextShape;
  value: string;
  isNew: boolean;
};

export type UseMapPaintOptions = {
  mapId: MapId;
  viewportCoordsRef: MutableRefObject<MapPickViewport | null>;
};

export type UseMapPaintResult = {
  enabled: boolean;
  setEnabled: (next: boolean) => void;
  visible: boolean;
  setVisible: (next: boolean) => void;
  tool: PaintTool;
  setTool: (next: PaintTool) => void;
  color: PaintColorId;
  setColor: (next: PaintColorId) => void;
  width: PaintWidth;
  setWidth: (next: PaintWidth) => void;
  stampIcon: PaintStampIconId;
  setStampIcon: (next: PaintStampIconId) => void;
  stampFlipX: boolean;
  /** Mirrors the selected object, and arms the next one to be placed the same way. */
  setStampFlipX: (next: boolean) => void;
  textStyle: PaintTextStyle;
  /** Updates the default for new labels, and restyles the one being worked on. */
  setTextStyle: (patch: Partial<PaintTextStyle>) => void;
  selectedShape: PaintShape | null;
  shapes: PaintShape[];
  draft: PaintShape | null;
  selectedId: string | null;
  textEditor: PaintTextEditorState | null;
  setTextValue: (next: string) => void;
  commitText: () => void;
  cancelText: () => void;
  /** Serialised plan plus a suggested filename, for the Export button. */
  exportPlan: () => { json: string; filename: string };
  /** Replaces the current plan with an imported one. Undoable. */
  importPlan: (raw: string) => PaintImportResult;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  clearAll: () => void;
  handlers: {
    onPointerDown: (event: ReactPointerEvent<Element>) => void;
    onPointerMove: (event: ReactPointerEvent<Element>) => void;
    onPointerUp: (event: ReactPointerEvent<Element>) => void;
    onPointerCancel: (event: ReactPointerEvent<Element>) => void;
  };
};

/**
 * All paint-mode state: tool selection, the gesture state machine, undo/redo,
 * keybindings and localStorage persistence.
 *
 * Pointer handling is deliberately narrow — every handler bails on anything but
 * the left button and never calls stopPropagation — so middle-click panning and
 * wheel zooming (bound by useMapViewport on an ancestor element) keep working
 * untouched while painting.
 */
export default function useMapPaint({ mapId, viewportCoordsRef }: UseMapPaintOptions): UseMapPaintResult {
  const [enabled, setEnabled] = useState(false);
  const [visible, setVisible] = useState(true);
  const [tool, setTool] = useState<PaintTool>("brush");
  const [color, setColor] = useState<PaintColorId>("attack");
  const [width, setWidthState] = useState<PaintWidth>(PAINT_WIDTH_DEFAULT);
  // The slider is the only caller today, but clamping here means no shape can
  // ever be created with a width the renderer cannot draw.
  const setWidth = useCallback((next: PaintWidth) => setWidthState(clampPaintWidth(next)), []);
  const [stampIcon, setStampIcon] = useState<PaintStampIconId>("raid");
  const [stampFlipX, setStampFlipXState] = useState(false);
  const [textStyle, setTextStyleState] = useState<PaintTextStyle>(PAINT_TEXT_STYLE_DEFAULT);

  const [history, setHistory] = useState<PaintHistory>(() => createPaintHistory([]));
  const [draft, setDraftState] = useState<PaintShape | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [textEditor, setTextEditor] = useState<PaintTextEditorState | null>(null);

  const gestureRef = useRef<Gesture | null>(null);
  const draftRef = useRef<PaintShape | null>(null);
  const textEditorRef = useRef<PaintTextEditorState | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const shapesRef = useRef<PaintShape[]>([]);
  const hydratedRef = useRef(false);
  const readOnlyRef = useRef(false);

  const shapes = history.present;

  textEditorRef.current = textEditor;
  selectedIdRef.current = selectedId;
  shapesRef.current = shapes;

  /**
   * Mirrors the in-progress shape into a ref as it is set, not at render time:
   * pointerup has to read the finished stroke without depending on React having
   * re-rendered in between.
   */
  const setDraft = useCallback((next: PaintShape | null | ((current: PaintShape | null) => PaintShape | null)) => {
    const resolved = typeof next === "function" ? next(draftRef.current) : next;
    draftRef.current = resolved;
    setDraftState(resolved);
  }, []);

  // ---- persistence -------------------------------------------------------

  useEffect(() => {
    hydratedRef.current = false;
    const plan = loadPaintPlan(mapId);
    readOnlyRef.current = plan.readOnly;
    setHistory(createPaintHistory(plan.shapes));
    setDraft(null);
    setSelectedId(null);
    setTextEditor(null);
    hydratedRef.current = true;
  }, [mapId]);

  useEffect(() => {
    if (!hydratedRef.current || readOnlyRef.current) return;
    const timer = window.setTimeout(() => savePaintShapes(mapId, shapes), SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [mapId, shapes]);

  // ---- history helpers ---------------------------------------------------

  const commit = useCallback((next: PaintShape[]) => {
    setHistory((current) => commitPaintHistory(current, next.slice(0, PAINT_MAX_SHAPES)));
  }, []);

  /** Commits a gesture that mutated `present` live (erase, move) against its snapshot. */
  const commitFromSnapshot = useCallback((snapshot: PaintShape[]) => {
    setHistory((current) =>
      current.present === snapshot ? current : commitPaintHistory({ ...current, present: snapshot }, current.present),
    );
  }, []);

  const exportPlan = useCallback(() => {
    const now = Date.now();
    return {
      json: exportPaintDocument(mapId, shapesRef.current),
      filename: paintExportFilename(mapId, now),
    };
  }, [mapId]);

  const importPlan = useCallback((raw: string): PaintImportResult => {
    const result = importPaintDocument(raw);
    if (!result.ok) return result;

    // Replace rather than merge: importing is "show me their plan". The old one
    // is one undo away.
    setDraft(null);
    setSelectedId(null);
    setTextEditor(null);
    setHistory((current) => commitPaintHistory(current, result.shapes));
    return result;
  }, []);

  const undo = useCallback(() => setHistory(undoPaintHistory), []);
  const redo = useCallback(() => setHistory(redoPaintHistory), []);
  const clearAll = useCallback(() => {
    setDraft(null);
    setSelectedId(null);
    setTextEditor(null);
    setHistory((current) => commitPaintHistory(current, []));
  }, []);

  // ---- coordinate helpers ------------------------------------------------

  /**
   * Corner handles are chrome, not content: they keep a constant on-screen size
   * so they stay grabbable at any zoom. This is the only place the paint layer
   * looks at displayScale.
   */
  const handleReachMapPx = useCallback(() => {
    const scale = viewportCoordsRef.current?.displayScale ?? 1;
    return scale > 0 ? PAINT_HANDLE_SCREEN_PX / scale : PAINT_HANDLE_SCREEN_PX;
  }, [viewportCoordsRef]);

  const toMapPoint = useCallback(
    (event: ReactPointerEvent<Element>): PaintPoint | null => {
      const viewport = viewportCoordsRef.current;
      if (!viewport) return null;
      return screenPointToMap(event.clientX, event.clientY, viewport);
    },
    [viewportCoordsRef],
  );

  // ---- text editing ------------------------------------------------------

  const setTextValue = useCallback((next: string) => {
    setTextEditor((current) => (current ? { ...current, value: next.slice(0, PAINT_MAX_TEXT_LENGTH) } : current));
  }, []);

  const cancelText = useCallback(() => setTextEditor(null), []);

  const setStampFlipX = useCallback((next: boolean) => {
    setStampFlipXState(next);

    const targetId = selectedIdRef.current;
    if (!targetId) return;
    setHistory((current) => {
      const target = current.present.find((shape) => shape.id === targetId);
      if (target?.type !== "stamp") return current;
      return commitPaintHistory(
        current,
        current.present.map((shape) =>
          shape.id === targetId ? { ...(shape as PaintStampShape), flipX: next } : shape,
        ),
      );
    });
  }, []);

  const setTextStyle = useCallback((patch: Partial<PaintTextStyle>) => {
    setTextStyleState((current) => ({ ...current, ...patch }));

    // Restyle whatever label the user is looking at, so the controls read as
    // editing that label rather than only arming the next one.
    const editing = textEditorRef.current;
    if (editing) {
      setTextEditor({ ...editing, shape: { ...editing.shape, ...patch } });
    }

    const targetId = editing?.isNew ? null : (editing?.shape.id ?? selectedIdRef.current);
    if (!targetId) return;
    setHistory((current) => {
      const target = current.present.find((shape) => shape.id === targetId);
      if (target?.type !== "text") return current;
      return commitPaintHistory(
        current,
        current.present.map((shape) => (shape.id === targetId ? { ...(shape as PaintTextShape), ...patch } : shape)),
      );
    });
  }, []);

  const commitText = useCallback(() => {
    const editor = textEditorRef.current;
    setTextEditor(null);
    if (!editor) return;

    const text = editor.value.trim();

    // Leave the label selected so the style controls act on it straight away,
    // and so it can be moved, resized or rotated without hunting for it again.
    setSelectedId(text ? editor.shape.id : null);

    setHistory((current) => {
      if (editor.isNew) {
        if (!text) return current;
        return commitPaintHistory(current, [...current.present, { ...editor.shape, text }]);
      }
      if (text === editor.shape.text) return current;
      const next = text
        ? current.present.map((shape) => (shape.id === editor.shape.id ? { ...editor.shape, text } : shape))
        : current.present.filter((shape) => shape.id !== editor.shape.id);
      return commitPaintHistory(current, next);
    });
  }, []);

  // ---- gestures ----------------------------------------------------------

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<Element>) => {
      // Anything but the left button (middle-click pan in particular) must fall
      // through to useMapViewport's listeners untouched.
      if (!enabled || event.button !== 0) return;
      const point = toMapPoint(event);
      if (!point) return;

      if (textEditor) commitText();

      const sizes = paintSizesMapPx();
      const tolerance = paintMapPx(PAINT_ERASER_SCREEN_PX);

      event.preventDefault();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // no active pointer to capture; the gesture still works without it
      }

      switch (tool) {
        case "brush":
          setDraft({
            id: createPaintShapeId("brush"),
            type: "brush",
            color,
            width,
            createdAt: Date.now(),
            points: [point],
          });
          gestureRef.current = { kind: "brush", pointerId: event.pointerId };
          break;

        case "arrow":
          setDraft({
            id: createPaintShapeId("arrow"),
            type: "arrow",
            color,
            width,
            createdAt: Date.now(),
            from: point,
            to: point,
          });
          gestureRef.current = { kind: "arrow", pointerId: event.pointerId };
          break;

        case "stamp":
          commit([
            ...shapes,
            {
              id: createPaintShapeId("stamp"),
              type: "stamp",
              color,
              createdAt: Date.now(),
              icon: stampIcon,
              at: point,
              flipX: stampFlipX,
            },
          ]);
          break;

        case "text": {
          const hit = pickTopPaintShapeAt(shapes, point, tolerance, sizes);
          if (hit?.type === "text") {
            setTextEditor({ shape: hit, value: hit.text, isNew: false });
          } else {
            setTextEditor({
              shape: {
                id: createPaintShapeId("text"),
                type: "text",
                color,
                width,
                createdAt: Date.now(),
                at: point,
                text: "",
                ...textStyle,
              },
              value: "",
              isNew: true,
            });
          }
          break;
        }

        case "eraser": {
          const snapshot = shapes;
          const hit = pickTopPaintShapeAt(shapes, point, tolerance, sizes);
          if (hit)
            setHistory((current) => ({
              ...current,
              present: current.present.filter((shape) => shape.id !== hit.id),
            }));
          gestureRef.current = { kind: "erase", pointerId: event.pointerId, snapshot };
          break;
        }

        case "move": {
          // Corners win over the shape body, so grabbing a handle resizes
          // instead of dragging the whole thing away.
          const selected = shapes.find((shape) => shape.id === selectedId);
          if (selected) {
            const selectedBounds = paintShapeBounds(selected, sizes);
            const reach = handleReachMapPx();

            // The rotation knob sits above the box's top edge, in the shape's
            // own frame, so it travels with the shape as it rotates.
            const knobLocal = paintRotationKnob(selectedBounds, reach);
            const localPoint = toShapeLocalPoint(selected, point, sizes);
            if (Math.abs(localPoint.x - knobLocal.x) <= reach && Math.abs(localPoint.y - knobLocal.y) <= reach) {
              const centre = boundsCentre(selectedBounds);
              gestureRef.current = {
                kind: "rotate",
                pointerId: event.pointerId,
                snapshot: shapes,
                shapeId: selected.id,
                centre,
                startRotation: paintShapeRotation(selected),
                startAngle: pointerAngle(centre, point),
              };
              break;
            }

            const handle = pickPaintHandle(selectedBounds, localPoint, reach);
            if (handle) {
              const startDistance = Math.hypot(handle.grabbed.x - handle.anchor.x, handle.grabbed.y - handle.anchor.y);
              if (startDistance > 0) {
                gestureRef.current = {
                  kind: "resize",
                  pointerId: event.pointerId,
                  snapshot: shapes,
                  original: selected,
                  anchor: handle.anchor,
                  startDistance,
                };
                break;
              }
            }
          }

          const hit = pickTopPaintShapeAt(shapes, point, tolerance, sizes);

          // Clicking an already-selected label opens it for editing, the same
          // click-again-to-rename gesture used for files.
          if (hit?.type === "text" && hit.id === selectedId) {
            setTextEditor({ shape: hit, value: hit.text, isNew: false });
            return;
          }

          setSelectedId(hit?.id ?? null);
          if (!hit) return;
          gestureRef.current = {
            kind: "move",
            pointerId: event.pointerId,
            snapshot: shapes,
            shapeId: hit.id,
            last: point,
          };
          break;
        }
      }
    },
    [
      color,
      commit,
      commitText,
      enabled,
      handleReachMapPx,
      selectedId,
      shapes,
      stampFlipX,
      stampIcon,
      textEditor,
      textStyle,
      toMapPoint,
      tool,
      width,
    ],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<Element>) => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      const point = toMapPoint(event);
      if (!point) return;

      switch (gesture.kind) {
        case "brush": {
          const minDist = paintMapPx(PAINT_BRUSH_MIN_POINT_SCREEN_PX);
          setDraft((current) => {
            if (!current || current.type !== "brush") return current;
            if (current.points.length >= PAINT_MAX_BRUSH_POINTS) return current;
            const points = appendBrushPoint(current.points, point, minDist);
            return points === current.points ? current : { ...current, points };
          });
          break;
        }

        case "arrow":
          setDraft((current) => (current && current.type === "arrow" ? { ...current, to: point } : current));
          break;

        case "erase": {
          const tolerance = paintMapPx(PAINT_ERASER_SCREEN_PX);
          const sizes = paintSizesMapPx();
          setHistory((current) => {
            const hit = pickTopPaintShapeAt(current.present, point, tolerance, sizes);
            if (!hit) return current;
            return {
              ...current,
              present: current.present.filter((shape) => shape.id !== hit.id),
            };
          });
          break;
        }

        case "rotate": {
          const delta = pointerAngle(gesture.centre, point) - gesture.startAngle;
          const raw = gesture.startRotation + delta;
          const degrees = event.shiftKey
            ? Math.round(raw / PAINT_ROTATION_SNAP_DEGREES) * PAINT_ROTATION_SNAP_DEGREES
            : raw;
          setHistory((current) => ({
            ...current,
            present: current.present.map((shape) =>
              shape.id === gesture.shapeId ? rotatePaintShape(shape, degrees) : shape,
            ),
          }));
          break;
        }

        case "resize": {
          const distance = Math.hypot(point.x - gesture.anchor.x, point.y - gesture.anchor.y);
          const factor = distance / gesture.startDistance;
          const resized = scalePaintShape(gesture.original, gesture.anchor, factor, paintSizesMapPx());
          setHistory((current) => ({
            ...current,
            present: current.present.map((shape) => (shape.id === resized.id ? resized : shape)),
          }));
          break;
        }

        case "move": {
          const dx = point.x - gesture.last.x;
          const dy = point.y - gesture.last.y;
          gesture.last = point;
          setHistory((current) => ({
            ...current,
            present: current.present.map((shape) =>
              shape.id === gesture.shapeId ? translatePaintShape(shape, dx, dy) : shape,
            ),
          }));
          break;
        }
      }
    },
    [toMapPoint],
  );

  const endGesture = useCallback(
    (event: ReactPointerEvent<Element>, cancelled: boolean) => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      gestureRef.current = null;

      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // capture may already be gone (element unmounted, pointer cancelled)
      }

      switch (gesture.kind) {
        case "brush":
        case "arrow": {
          const pending = draftRef.current;
          setDraft(null);
          if (cancelled || !pending) break;
          if (pending.type === "arrow") {
            const length = Math.hypot(pending.to.x - pending.from.x, pending.to.y - pending.from.y);
            // A click without a drag is not an arrow.
            if (length < 1) break;
          }
          setHistory((current) =>
            commitPaintHistory(current, [...current.present, pending].slice(0, PAINT_MAX_SHAPES)),
          );
          break;
        }

        case "erase":
        case "move":
        case "resize":
        case "rotate":
          if (cancelled) {
            setHistory((current) => ({ ...current, present: gesture.snapshot }));
          } else {
            commitFromSnapshot(gesture.snapshot);
          }
          break;
      }
    },
    [commitFromSnapshot],
  );

  const onPointerUp = useCallback((event: ReactPointerEvent<Element>) => endGesture(event, false), [endGesture]);

  const onPointerCancel = useCallback((event: ReactPointerEvent<Element>) => endGesture(event, true), [endGesture]);

  // ---- keybindings -------------------------------------------------------

  useEffect(() => {
    if (!enabled) return;

    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        // Let the text editor keep its own undo stack.
        return;
      }

      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === "y") {
        event.preventDefault();
        redo();
        return;
      }
      if (event.key === "Escape") {
        setDraft(null);
        setTextEditor(null);
        setSelectedId(null);
        gestureRef.current = null;
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedId) {
        event.preventDefault();
        setHistory((current) =>
          commitPaintHistory(
            current,
            current.present.filter((shape) => shape.id !== selectedId),
          ),
        );
        setSelectedId(null);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, redo, selectedId, undo]);

  // Leaving paint mode should not strand a half-finished stroke or an open editor.
  useEffect(() => {
    if (enabled) return;
    gestureRef.current = null;
    setDraft(null);
    setSelectedId(null);
    setTextEditor(null);
  }, [enabled]);

  const handlers = useMemo(
    () => ({ onPointerDown, onPointerMove, onPointerUp, onPointerCancel }),
    [onPointerCancel, onPointerDown, onPointerMove, onPointerUp],
  );

  return {
    enabled,
    setEnabled,
    visible,
    setVisible,
    tool,
    setTool,
    color,
    setColor,
    width,
    setWidth,
    stampIcon,
    setStampIcon,
    stampFlipX,
    setStampFlipX,
    textStyle,
    setTextStyle,
    selectedShape: shapes.find((shape) => shape.id === selectedId) ?? null,
    shapes,
    draft,
    selectedId,
    textEditor,
    setTextValue,
    commitText,
    cancelText,
    exportPlan,
    importPlan,
    canUndo: canUndoPaint(history),
    canRedo: canRedoPaint(history),
    undo,
    redo,
    clearAll,
    handlers,
  };
}
