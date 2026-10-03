import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  clampTranslate,
  clampUserScale,
  computeCenteredTransform,
  computeDisplayScale,
  computeFitScale,
  screenToMap,
  transformForMapRect,
  viewportTransformStyle,
  zoomAtPoint,
  zoomToScaleAtPoint,
  type FitMode,
  type MapRect,
  type Size,
  type ViewportPoint,
  type ViewportTransform,
} from "../lib/mapViewportMath";
import {
  MAP_ZOOM_STEP,
  exceedsDragThreshold,
  isTypingTarget,
  keyboardMapAction,
  pinchSample,
  pinchUserScale,
  type PinchSample,
} from "../lib/mapGestures";

export type UseMapViewportOptions = {
  mapSize: Size;
  enabled?: boolean;
  fitMode?: FitMode;
  /**
   * Left-drag, one-finger drag and two-finger pinch move the map, Google Maps
   * style. Off by default because the title editor's canvas uses left-drag for
   * its own selection; the live map turns it off while paint mode owns the
   * left button.
   */
  dragPan?: boolean;
  /** Arrow keys pan and +/- zoom while the pointer is not in a text field. */
  keyboard?: boolean;
};

export type MapFocusInset = {
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
};

export type UseMapViewportResult = {
  viewportRef: RefObject<HTMLDivElement | null>;
  userScale: number;
  translateX: number;
  translateY: number;
  displayScale: number;
  fitScale: number;
  isPanning: boolean;
  transformStyle: string;
  transformTransition?: string;
  cursorClassName: string;
  resetViewport: (options?: ViewportResetOptions) => void;
  /** Zoom by `factor` around the viewport centre, animated. */
  zoomBy: (factor: number) => void;
  /** Animate to frame a map-space rectangle, clear of `inset` screen furniture. */
  focusMapRect: (rect: MapRect, inset?: MapFocusInset) => void;
  /**
   * True once for the click that ends a drag. The browser still fires `click`
   * after a press that panned the map; the canvas asks this first so a pan
   * never also selects whatever was under the pointer when it ended.
   */
  consumeDragClick: () => boolean;
  screenToMapFromClient: (
    clientX: number,
    clientY: number
  ) => { x: number; y: number } | null;
};

export type ViewportResetOptions = {
  animated?: boolean;
};

const VIEWPORT_RESET_TRANSITION_MS = 200;
const VIEWPORT_RESET_TRANSITION = `transform ${VIEWPORT_RESET_TRANSITION_MS}ms ease-out`;
const VIEWPORT_FOCUS_TRANSITION_MS = 450;
const VIEWPORT_FOCUS_TRANSITION = `transform ${VIEWPORT_FOCUS_TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;

const INITIAL_TRANSFORM: ViewportTransform = {
  userScale: 1,
  translateX: 0,
  translateY: 0,
};

type PanGesture = {
  kind: "pan";
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startTranslateX: number;
  startTranslateY: number;
  /** Past the drag threshold; until then the press may still be a click. */
  moved: boolean;
};

type PinchGesture = {
  kind: "pinch";
  start: PinchSample;
  startTransform: ViewportTransform;
};

type Gesture = PanGesture | PinchGesture;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function readViewportSize(element: HTMLElement): Size {
  const rect = element.getBoundingClientRect();
  return { w: rect.width, h: rect.height };
}

export function useMapViewport({
  mapSize,
  enabled = true,
  fitMode = "cover",
  dragPan = false,
  keyboard = false,
}: UseMapViewportOptions): UseMapViewportResult {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewportSize, setViewportSize] = useState<Size>({ w: 0, h: 0 });
  const [transform, setTransform] = useState<ViewportTransform>(INITIAL_TRANSFORM);
  const [isPanning, setIsPanning] = useState(false);
  const [transition, setTransition] = useState<string | undefined>(undefined);

  const transformRef = useRef(transform);
  transformRef.current = transform;
  const viewportSizeRef = useRef(viewportSize);
  viewportSizeRef.current = viewportSize;
  const mapSizeRef = useRef(mapSize);
  mapSizeRef.current = mapSize;
  const fitModeRef = useRef(fitMode);
  fitModeRef.current = fitMode;
  const dragPanRef = useRef(dragPan);
  dragPanRef.current = dragPan;

  const gestureRef = useRef<Gesture | null>(null);
  /** Active touch/pen/mouse pointers in viewport pixels, for pinch. */
  const pointersRef = useRef(new Map<number, ViewportPoint>());
  const dragClickRef = useRef(false);
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTransition = useCallback(() => {
    if (transitionTimerRef.current !== null) {
      clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }
    setTransition(undefined);
  }, []);

  /** Apply `next` with a CSS transition that is dropped once it has run. */
  const animateTo = useCallback(
    (next: ViewportTransform, css: string, ms: number) => {
      clearTransition();
      setTransform(next);
      if (prefersReducedMotion()) return;
      setTransition(css);
      transitionTimerRef.current = setTimeout(() => {
        transitionTimerRef.current = null;
        setTransition(undefined);
      }, ms);
    },
    [clearTransition]
  );

  const fitScale = useMemo(
    () => computeFitScale(viewportSize, mapSize, fitMode),
    [viewportSize, mapSize, fitMode]
  );
  const displayScale = useMemo(
    () => computeDisplayScale(fitScale, transform.userScale),
    [fitScale, transform.userScale]
  );

  const applyClampedTransform = useCallback((next: ViewportTransform): ViewportTransform => {
    const viewport = viewportSizeRef.current;
    const map = mapSizeRef.current;
    const nextFitScale = computeFitScale(viewport, map, fitModeRef.current);
    const clampedUserScale = clampUserScale(next.userScale);
    const nextDisplayScale = computeDisplayScale(nextFitScale, clampedUserScale);
    const clamped = clampTranslate(
      viewport,
      map,
      nextDisplayScale,
      next.translateX,
      next.translateY
    );
    return {
      userScale: clampedUserScale,
      translateX: clamped.x,
      translateY: clamped.y,
    };
  }, []);

  const endGesture = useCallback(() => {
    gestureRef.current = null;
    pointersRef.current.clear();
    setIsPanning(false);
  }, []);

  const resetViewport = useCallback((options?: ViewportResetOptions) => {
    // Same centered position the view opens with, not the raw (0,0) sentinel
    // — that would land on cover-fit's cropped axis pinned to its edge.
    const centred = computeCenteredTransform(
      viewportSizeRef.current,
      mapSizeRef.current,
      INITIAL_TRANSFORM.userScale,
      fitModeRef.current
    );
    endGesture();
    if (options?.animated ?? true) {
      animateTo(centred, VIEWPORT_RESET_TRANSITION, VIEWPORT_RESET_TRANSITION_MS);
    } else {
      clearTransition();
      setTransform(centred);
    }
  }, [animateTo, clearTransition, endGesture]);

  const zoomBy = useCallback(
    (factor: number) => {
      const viewport = viewportSizeRef.current;
      if (viewport.w <= 0 || viewport.h <= 0) return;
      const current = transformRef.current;
      animateTo(
        zoomToScaleAtPoint(
          viewport,
          mapSizeRef.current,
          current,
          { x: viewport.w / 2, y: viewport.h / 2 },
          current.userScale * factor,
          fitModeRef.current
        ),
        VIEWPORT_RESET_TRANSITION,
        VIEWPORT_RESET_TRANSITION_MS
      );
    },
    [animateTo]
  );

  const focusMapRect = useCallback(
    (rect: MapRect, inset?: MapFocusInset) => {
      const viewport = viewportSizeRef.current;
      if (viewport.w <= 0 || viewport.h <= 0) return;
      animateTo(
        transformForMapRect(viewport, mapSizeRef.current, rect, fitModeRef.current, {
          fill: 0.55,
          // A one-province realm should not fill the screen with four pixels.
          maxUserScale: 5,
          inset,
        }),
        VIEWPORT_FOCUS_TRANSITION,
        VIEWPORT_FOCUS_TRANSITION_MS
      );
    },
    [animateTo]
  );

  const consumeDragClick = useCallback(() => {
    const dragged = dragClickRef.current;
    dragClickRef.current = false;
    return dragged;
  }, []);

  useLayoutEffect(() => {
    if (!enabled) return;
    const element = viewportRef.current;
    if (!element) return;
    const syncViewportSize = (next: Size) => {
      setViewportSize((current) =>
        current.w === next.w && current.h === next.h ? current : next
      );
    };
    syncViewportSize(readViewportSize(element));
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      syncViewportSize({ w: width, h: height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled]);

  useEffect(() => {
    if (!enabled || viewportSize.w <= 0 || viewportSize.h <= 0) return;
    setTransform((current) => {
      // Only the untouched initial transform gets centered — once the user
      // has panned or zoomed, a later resize (window resize, sidebar
      // toggling) must reclamp their position, not recenter over it.
      const isUntouched =
        current.userScale === INITIAL_TRANSFORM.userScale &&
        current.translateX === INITIAL_TRANSFORM.translateX &&
        current.translateY === INITIAL_TRANSFORM.translateY;
      if (isUntouched) {
        return computeCenteredTransform(
          viewportSizeRef.current,
          mapSizeRef.current,
          INITIAL_TRANSFORM.userScale,
          fitModeRef.current
        );
      }
      return applyClampedTransform(current);
    });
  }, [applyClampedTransform, enabled, mapSize, viewportSize]);

  const previousFitModeRef = useRef(fitMode);
  useEffect(() => {
    // Toggling fit mode is a deliberate "show it the other way" action, not a
    // resize — it always snaps to the new mode's centered view, even if the
    // user had already panned around. The effect above only recenters an
    // untouched transform; it would otherwise reclamp a user's pan into the
    // new fit scale, landing somewhere arbitrary rather than the clean
    // centered view the toggle promises.
    if (previousFitModeRef.current === fitMode) return;
    previousFitModeRef.current = fitMode;
    if (!enabled) return;
    setTransform(
      computeCenteredTransform(
        viewportSizeRef.current,
        mapSizeRef.current,
        INITIAL_TRANSFORM.userScale,
        fitMode
      )
    );
  }, [enabled, fitMode]);

  // Paint mode switching on mid-drag hands the left button to the paint layer
  // at once rather than letting the pan finish under the brush.
  useEffect(() => {
    if (dragPan) return;
    const gesture = gestureRef.current;
    if (gesture && (gesture.kind === "pinch" || gesture.pointerId !== -1)) {
      endGesture();
    }
  }, [dragPan, endGesture]);

  useEffect(() => {
    if (!enabled) return;
    const element = viewportRef.current;
    if (!element) return;

    const toViewportPoint = (event: { clientX: number; clientY: number }) => {
      const rect = element.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    const startPan = (event: PointerEvent, pointerId: number, moved: boolean) => {
      const current = transformRef.current;
      gestureRef.current = {
        kind: "pan",
        pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startTranslateX: current.translateX,
        startTranslateY: current.translateY,
        moved,
      };
      if (moved) setIsPanning(true);
    };

    const startPinch = () => {
      const [a, b] = [...pointersRef.current.values()];
      if (!a || !b) return;
      gestureRef.current = {
        kind: "pinch",
        start: pinchSample(a, b),
        startTransform: transformRef.current,
      };
      setIsPanning(true);
    };

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      clearTransition();
      const cursor = toViewportPoint(event);
      setTransform((current) =>
        applyClampedTransform(
          zoomAtPoint(
            viewportSizeRef.current,
            mapSizeRef.current,
            current,
            cursor,
            event.deltaY,
            fitModeRef.current
          )
        )
      );
    };

    const handlePointerDown = (event: PointerEvent) => {
      dragClickRef.current = false;
      const isMouse = event.pointerType === "mouse";

      // Middle-drag pans everywhere, paint mode and editor included. It is a
      // pan from the first pixel: a middle press is never a click.
      if (isMouse && event.button === 1) {
        event.preventDefault();
        clearTransition();
        // -1 marks the middle-button pan so turning paint on does not end it.
        startPan(event, -1, true);
        return;
      }

      if (!dragPanRef.current) return;
      if (isMouse && event.button !== 0) return;

      clearTransition();
      pointersRef.current.set(event.pointerId, toViewportPoint(event));
      if (!isMouse && pointersRef.current.size >= 2) {
        startPinch();
        return;
      }
      startPan(event, event.pointerId, false);
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (pointersRef.current.has(event.pointerId)) {
        pointersRef.current.set(event.pointerId, toViewportPoint(event));
      }
      const gesture = gestureRef.current;
      if (!gesture) return;

      if (gesture.kind === "pinch") {
        const [a, b] = [...pointersRef.current.values()];
        if (!a || !b) return;
        event.preventDefault();
        const sample = pinchSample(a, b);
        const viewport = viewportSizeRef.current;
        const map = mapSizeRef.current;
        // Zoom about where the fingers started, then follow the midpoint so
        // two fingers can pan and zoom in one movement.
        const zoomed = zoomToScaleAtPoint(
          viewport,
          map,
          gesture.startTransform,
          gesture.start.midpoint,
          pinchUserScale(gesture.startTransform.userScale, gesture.start, sample),
          fitModeRef.current
        );
        setTransform(
          applyClampedTransform({
            userScale: zoomed.userScale,
            translateX: zoomed.translateX + sample.midpoint.x - gesture.start.midpoint.x,
            translateY: zoomed.translateY + sample.midpoint.y - gesture.start.midpoint.y,
          })
        );
        return;
      }

      if (gesture.pointerId !== -1 && gesture.pointerId !== event.pointerId) return;
      const deltaX = event.clientX - gesture.startClientX;
      const deltaY = event.clientY - gesture.startClientY;
      if (!gesture.moved) {
        if (!exceedsDragThreshold(deltaX, deltaY)) return;
        gesture.moved = true;
        setIsPanning(true);
      }
      event.preventDefault();
      setTransform(
        applyClampedTransform({
          userScale: transformRef.current.userScale,
          translateX: gesture.startTranslateX + deltaX,
          translateY: gesture.startTranslateY + deltaY,
        })
      );
    };

    const handlePointerUp = (event: PointerEvent) => {
      const gesture = gestureRef.current;
      pointersRef.current.delete(event.pointerId);
      if (!gesture) return;

      if (gesture.kind === "pinch") {
        // Lifting one finger of a pinch carries on as a one-finger pan from
        // where the remaining finger is, rather than jumping.
        const remaining = [...pointersRef.current.entries()][0];
        if (remaining && event.type === "pointerup") {
          const [pointerId, point] = remaining;
          const rect = element.getBoundingClientRect();
          const current = transformRef.current;
          gestureRef.current = {
            kind: "pan",
            pointerId,
            startClientX: point.x + rect.left,
            startClientY: point.y + rect.top,
            startTranslateX: current.translateX,
            startTranslateY: current.translateY,
            moved: true,
          };
        } else {
          endGesture();
        }
        // The tap that ends a pinch must not select.
        dragClickRef.current = true;
        return;
      }

      if (gesture.pointerId === -1) {
        if (event.pointerType === "mouse" && event.button !== 1) return;
      } else if (gesture.pointerId !== event.pointerId) {
        return;
      }
      if (gesture.moved) dragClickRef.current = true;
      endGesture();
    };

    const endOnBlur = () => {
      if (gestureRef.current) endGesture();
    };

    const handleContextMenu = (event: MouseEvent) => {
      if (!gestureRef.current && event.button !== 1) return;
      event.preventDefault();
    };

    const handleAuxClick = (event: MouseEvent) => {
      if (event.button !== 1) return;
      event.preventDefault();
    };

    const handleDoubleClick = (event: MouseEvent) => {
      if (!dragPanRef.current) return;
      const viewport = viewportSizeRef.current;
      const current = transformRef.current;
      animateTo(
        zoomToScaleAtPoint(
          viewport,
          mapSizeRef.current,
          current,
          toViewportPoint(event),
          current.userScale * MAP_ZOOM_STEP,
          fitModeRef.current
        ),
        VIEWPORT_RESET_TRANSITION,
        VIEWPORT_RESET_TRANSITION_MS
      );
    };

    element.addEventListener("wheel", handleWheel, { passive: false });
    element.addEventListener("pointerdown", handlePointerDown);
    element.addEventListener("contextmenu", handleContextMenu);
    element.addEventListener("auxclick", handleAuxClick);
    element.addEventListener("dblclick", handleDoubleClick);
    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    window.addEventListener("blur", endOnBlur);
    return () => {
      element.removeEventListener("wheel", handleWheel);
      element.removeEventListener("pointerdown", handlePointerDown);
      element.removeEventListener("contextmenu", handleContextMenu);
      element.removeEventListener("auxclick", handleAuxClick);
      element.removeEventListener("dblclick", handleDoubleClick);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      window.removeEventListener("blur", endOnBlur);
    };
  }, [animateTo, applyClampedTransform, clearTransition, enabled, endGesture]);

  useEffect(() => {
    if (!enabled || !keyboard) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }
      if (isTypingTarget(event.target)) return;
      const action = keyboardMapAction(event.key);
      if (!action) return;
      event.preventDefault();
      if (action.kind === "zoom") {
        zoomBy(action.factor);
        return;
      }
      const current = transformRef.current;
      animateTo(
        applyClampedTransform({
          userScale: current.userScale,
          translateX: current.translateX + action.dx,
          translateY: current.translateY + action.dy,
        }),
        VIEWPORT_RESET_TRANSITION,
        VIEWPORT_RESET_TRANSITION_MS
      );
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [animateTo, applyClampedTransform, enabled, keyboard, zoomBy]);

  useEffect(() => {
    return () => {
      if (transitionTimerRef.current !== null) {
        clearTimeout(transitionTimerRef.current);
      }
    };
  }, []);

  const screenToMapFromClient = useCallback(
    (clientX: number, clientY: number) => {
      const element = viewportRef.current;
      const viewport = viewportSizeRef.current;
      const map = mapSizeRef.current;
      const current = transformRef.current;
      const currentFitScale = computeFitScale(viewport, map, fitModeRef.current);
      const currentDisplayScale = computeDisplayScale(
        currentFitScale,
        current.userScale
      );
      if (!element || viewport.w <= 0 || viewport.h <= 0) return null;
      const rect = element.getBoundingClientRect();
      const viewportX = clientX - rect.left;
      const viewportY = clientY - rect.top;
      if (
        viewportX < 0 ||
        viewportY < 0 ||
        viewportX > viewport.w ||
        viewportY > viewport.h
      ) {
        return null;
      }
      const point = screenToMap(viewportX, viewportY, currentDisplayScale, {
        x: current.translateX,
        y: current.translateY,
      });
      if (point.x < 0 || point.y < 0 || point.x > map.w || point.y > map.h) {
        return null;
      }
      return point;
    },
    []
  );

  const transformStyle = viewportTransformStyle(
    displayScale,
    transform.translateX,
    transform.translateY
  );
  const cursorClassName = isPanning ? "cursor-grabbing" : "cursor-grab";
  const transformTransition = isPanning ? undefined : transition;

  return {
    viewportRef,
    userScale: transform.userScale,
    translateX: transform.translateX,
    translateY: transform.translateY,
    displayScale,
    fitScale,
    isPanning,
    transformStyle,
    transformTransition,
    cursorClassName,
    resetViewport,
    zoomBy,
    focusMapRect,
    consumeDragClick,
    screenToMapFromClient,
  };
}
