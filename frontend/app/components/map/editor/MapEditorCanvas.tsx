"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import type { MapId } from "@/app/components/map/types";
import MapAuthImage from "@/app/components/map/MapAuthImage";
import MapViewport from "@/app/components/map/MapViewport";
import { useMapViewport } from "@/app/hooks/useMapViewport";
import type { MapPickViewport } from "@/app/hooks/useMapCoords";
import { useEditorPick } from "@/app/hooks/useEditorPick";
import { useEditorProvinceIndex } from "@/app/hooks/useEditorProvinceIndex";
import {
  buildProvincePixelIndex,
  type ProvinceIndex,
} from "@/app/lib/map/editor/buildProvinceIndex";
import type { ProvinceRegionIndex } from "@/app/lib/map/editor/paintTitleLayers";
import type { TitlePickIndex } from "@/app/lib/map/editor/buildTitlePickIndex";
import { buildChildToParentId } from "@/app/lib/map/editor/childTitleAssignment";
import { buildProvinceToCountyId } from "@/app/lib/map/editor/countyAssignment";
import type { ChildTierEditorConfig } from "@/app/lib/map/editor/editorTierConfig";
import {
  EDITOR_ACTIVE_OPACITY,
  EDITOR_SELECTION_OPACITY,
} from "@/app/lib/map/editor/editorConstants";
import {
  diffChildTierPaintSnapshot,
  diffCountyPaintSnapshot,
  extractChildTierPaintSnapshot,
  extractCountyPaintSnapshot,
  isChildTierPaintDiffEmpty,
  isCountyPaintDiffEmpty,
  type ChildTierPaintSnapshot,
  type CountyPaintSnapshot,
} from "@/app/lib/map/editor/editorPaintSnapshot";
import {
  paintActiveLayerFull,
  paintChildSelectionLayerFull,
  paintParentActiveLayerFull,
  paintSelectionLayerFull,
  updateChildSelectionSubset,
  updateCountyActiveSubset,
  updateCountySelectionSubset,
  updateParentActiveSubset,
} from "@/app/lib/map/editor/paintTitleLayers";
import type { EditorTier } from "@/lib/map/api";
import type { TitleDraft } from "@/app/hooks/useEditorDraft";
import type { TitleLayers } from "@/app/lib/titleProvinces";

const panelClass =
  "rounded-lg border border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-moss)_35%,var(--tfmc-forest-deep))] shadow-lg";

function applyNaturalMapSize(
  img: HTMLImageElement,
  setMapSize: Dispatch<SetStateAction<{ w: number; h: number }>>
) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (w <= 0 || h <= 0) return;

  setMapSize((current) =>
    current.w === w && current.h === h ? current : { w, h }
  );
}

function mapInteractionCursor(
  isPanning: boolean,
  isHoveringClickable: boolean
): string {
  if (isPanning) return "cursor-grabbing";
  if (isHoveringClickable) return "cursor-pointer";
  return "cursor-grab";
}

function resizeCanvasIfNeeded(
  canvas: HTMLCanvasElement,
  width: number,
  height: number
): void {
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
}

type PaintContextKey = {
  mapId: MapId;
  tier: EditorTier;
  width: number;
  height: number;
};

type MapEditorCanvasProps = {
  mapId: MapId;
  sessionToken: string;
  tier: EditorTier;
  draft: TitleDraft;
  childTierConfig: ChildTierEditorConfig | null;
  childDraft: TitleDraft;
  titleLayers: TitleLayers;
  selectedId: string | null;
  onProvinceClick: (provinceId: number) => void;
  onChildClick: (childId: string) => void;
  provinceIndex?: ProvinceIndex | null;
  provinceIndexLoading?: boolean;
  provinceIndexError?: string | null;
  childPick?: TitlePickIndex | null;
  childPickLoading?: boolean;
  childPickError?: string | null;
  pickProvidedByParent?: boolean;
  onMapImageLoaded?: () => void;
  suppressLoadingOverlay?: boolean;
};

export default function MapEditorCanvas({
  mapId,
  sessionToken,
  tier,
  draft,
  childTierConfig,
  childDraft,
  titleLayers,
  selectedId,
  onProvinceClick,
  onChildClick,
  provinceIndex: externalIndex = null,
  provinceIndexLoading = false,
  provinceIndexError = null,
  childPick = null,
  childPickLoading = false,
  childPickError = null,
  pickProvidedByParent = false,
  onMapImageLoaded,
  suppressLoadingOverlay = false,
}: MapEditorCanvasProps) {
  const countyMode = tier === "county";
  const childTierMode = childTierConfig !== null;
  const editorPickMode = countyMode || childTierMode;

  const [mapSize, setMapSize] = useState({ w: 0, h: 0 });

  const viewportCoordsRef = useRef<MapPickViewport | null>(null);
  const selectionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pickCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const appliedNaturalSizeRef = useRef<{ w: number; h: number } | null>(null);
  const selectionImageDataRef = useRef<ImageData | null>(null);
  const activeImageDataRef = useRef<ImageData | null>(null);
  const prevPaintSnapshotRef = useRef<
    CountyPaintSnapshot | ChildTierPaintSnapshot | null
  >(null);
  const paintContextRef = useRef<PaintContextKey | null>(null);
  const rafPaintRef = useRef(0);
  const pendingSnapshotRef = useRef<
    CountyPaintSnapshot | ChildTierPaintSnapshot | null
  >(null);

  const viewport = useMapViewport({ mapSize });
  const internalPick = useEditorProvinceIndex(
    mapId,
    sessionToken,
    editorPickMode && !pickProvidedByParent
  );
  const index = externalIndex ?? internalPick.index;
  const loading =
    provinceIndexLoading ||
    internalPick.loading ||
    (childTierMode && childPickLoading);
  const error =
    provinceIndexError ??
    internalPick.error ??
    (childTierMode ? childPickError : null);

  // The flat pixel index walks all 40.96M pixels and buckets them into
  // per-province arrays - a large transient allocation. When the index came
  // from the run-length artifact the run spans serve the same queries, so we
  // skip building the flat pixel buckets.
  const pixelIndex = useMemo(
    () => (index && !index.runs ? buildProvincePixelIndex(index.provinceMap) : null),
    [index]
  );

  const regionIndex: ProvinceRegionIndex | null = index?.runs ?? pixelIndex;

  const provinceAssignment = useMemo(
    () => (countyMode ? buildProvinceToCountyId(draft) : new Map()),
    [countyMode, draft]
  );

  const childAssignment = useMemo(
    () => (childTierMode ? buildChildToParentId(draft) : new Map()),
    [childTierMode, draft]
  );

  const childDraftForPaint = childDraft;

  if (viewportCoordsRef) {
    viewportCoordsRef.current = {
      displayScale: viewport.displayScale,
      translateX: viewport.translateX,
      translateY: viewport.translateY,
      viewportElement: viewport.viewportRef.current,
      mapSize,
    };
  }

  const pick = useEditorPick({
    mapId,
    enabled:
      editorPickMode &&
      !loading &&
      (countyMode ? index !== null : childPick !== null),
    tier,
    childTierConfig,
    index,
    childPick,
    selectedId,
    provinceAssignment,
    childAssignment,
    draft,
    viewportCoordsRef,
    pickCanvasRef,
    onProvinceClick,
    onChildClick,
  });

  useEffect(() => {
    appliedNaturalSizeRef.current = null;
    setMapSize({ w: 0, h: 0 });
  }, [mapId]);

  useEffect(() => {
    viewport.resetViewport({ animated: true });
  }, [mapId, tier, viewport.resetViewport]);

  useEffect(() => {
    return () => {
      if (rafPaintRef.current) {
        cancelAnimationFrame(rafPaintRef.current);
        rafPaintRef.current = 0;
      }
    };
  }, []);

  useEffect(() => {
    if (!editorPickMode || !index || !regionIndex) return;

    // Run spans when available, otherwise the flat province map.
    const geometry = index.runs ?? index.provinceMap;

    const selectionCanvas = selectionCanvasRef.current;
    const activeCanvas = activeCanvasRef.current;
    const pickCanvas = pickCanvasRef.current;
    if (!selectionCanvas || !activeCanvas) return;

    resizeCanvasIfNeeded(selectionCanvas, index.width, index.height);
    resizeCanvasIfNeeded(activeCanvas, index.width, index.height);
    if (pickCanvas) {
      resizeCanvasIfNeeded(pickCanvas, index.width, index.height);
    }

    const selectionCtx = selectionCanvas.getContext("2d");
    const activeCtx = activeCanvas.getContext("2d");
    if (!selectionCtx || !activeCtx) return;

    const needsFullPaint =
      paintContextRef.current?.mapId !== mapId ||
      paintContextRef.current?.tier !== tier ||
      paintContextRef.current?.width !== index.width ||
      paintContextRef.current?.height !== index.height;

    const snapshot = countyMode
      ? extractCountyPaintSnapshot(draft, selectedId)
      : extractChildTierPaintSnapshot(
          draft,
          childDraftForPaint,
          selectedId
        );

    const runFullPaint = () => {
      selectionImageDataRef.current = selectionCtx.createImageData(
        index.width,
        index.height
      );
      activeImageDataRef.current = activeCtx.createImageData(
        index.width,
        index.height
      );

      const selectionImageData = selectionImageDataRef.current;
      const activeImageData = activeImageDataRef.current;

      if (countyMode) {
        const countySnapshot = snapshot as CountyPaintSnapshot;
        paintSelectionLayerFull(
          selectionImageData,
          geometry,
          index.provinceToRgb,
          provinceAssignment,
          countySnapshot.colors
        );
        paintActiveLayerFull(
          activeImageData,
          geometry,
          countySnapshot.selectedProvinces,
          countySnapshot.selectedRgb,
          new Set()
        );
      }

      if (childTierMode && childTierConfig) {
        const childSnapshot = snapshot as ChildTierPaintSnapshot;
        paintChildSelectionLayerFull(
          selectionImageData,
          geometry,
          childDraftForPaint,
          childTierConfig.resolveChildProvinces,
          titleLayers
        );
        paintParentActiveLayerFull(
          activeImageData,
          geometry,
          childSnapshot.selectedMembers,
          childSnapshot.selectedRgb,
          childTierConfig.resolveChildProvinces,
          titleLayers
        );
      }

      selectionCtx.putImageData(selectionImageData, 0, 0);
      activeCtx.putImageData(activeImageData, 0, 0);
      prevPaintSnapshotRef.current = snapshot;
      paintContextRef.current = {
        mapId,
        tier,
        width: index.width,
        height: index.height,
      };
    };

    const applyCountyIncremental = (
      countySnapshot: CountyPaintSnapshot,
      diff: NonNullable<ReturnType<typeof diffCountyPaintSnapshot>>
    ) => {
      const selectionImageData = selectionImageDataRef.current;
      const activeImageData = activeImageDataRef.current;
      if (!selectionImageData || !activeImageData) return;

      const selectionProvinceIds = new Set(diff.changedProvinceIds);
      for (const countyId of diff.changedCountyIds) {
        const provinces = countySnapshot.provincesByCounty[countyId] ?? [];
        for (const pid of provinces) selectionProvinceIds.add(pid);
      }

      if (selectionProvinceIds.size > 0) {
        updateCountySelectionSubset(
          selectionImageData,
          regionIndex,
          [...selectionProvinceIds],
          index.provinceToRgb,
          provinceAssignment,
          countySnapshot.colors
        );
      }

      if (diff.activeLayerChanged) {
        const prevProvinces = diff.prevSelectedProvinces ?? [];
        const nextProvinces = countySnapshot.selectedProvinces ?? [];
        const toClear = prevProvinces.filter(
          (pid) => !nextProvinces.includes(pid)
        );
        updateCountyActiveSubset(
          activeImageData,
          regionIndex,
          nextProvinces,
          countySnapshot.selectedRgb,
          toClear
        );
      }
    };

    const applyChildTierIncremental = (
      childSnapshot: ChildTierPaintSnapshot,
      diff: NonNullable<ReturnType<typeof diffChildTierPaintSnapshot>>
    ) => {
      const selectionImageData = selectionImageDataRef.current;
      const activeImageData = activeImageDataRef.current;
      if (!selectionImageData || !activeImageData || !childTierConfig) return;

      const selectionChildIds = new Set(diff.changedChildIds);
      for (const parentId of diff.changedParentIds) {
        const members = childSnapshot.parentMembers[parentId] ?? [];
        for (const childId of members) selectionChildIds.add(childId);
      }

      if (selectionChildIds.size > 0) {
        updateChildSelectionSubset(
          selectionImageData,
          regionIndex,
          [...selectionChildIds],
          childSnapshot.childColors,
          childTierConfig.resolveChildProvinces,
          titleLayers
        );
      }

      if (diff.activeLayerChanged) {
        const prevMembers = diff.prevSelectedMembers ?? [];
        const nextMembers = childSnapshot.selectedMembers ?? [];
        const toClear = prevMembers.filter((id) => !nextMembers.includes(id));
        updateParentActiveSubset(
          activeImageData,
          regionIndex,
          nextMembers,
          childSnapshot.selectedRgb,
          childTierConfig.resolveChildProvinces,
          titleLayers,
          toClear
        );
      }
    };

    const applyIncremental = (
      nextSnapshot: CountyPaintSnapshot | ChildTierPaintSnapshot
    ) => {
      const prev = prevPaintSnapshotRef.current;
      if (!prev) return;

      if (countyMode) {
        const diff = diffCountyPaintSnapshot(
          prev as CountyPaintSnapshot,
          nextSnapshot as CountyPaintSnapshot
        );
        if (!diff || isCountyPaintDiffEmpty(diff)) return;
        applyCountyIncremental(nextSnapshot as CountyPaintSnapshot, diff);
      } else if (childTierMode) {
        const diff = diffChildTierPaintSnapshot(
          prev as ChildTierPaintSnapshot,
          nextSnapshot as ChildTierPaintSnapshot
        );
        if (!diff || isChildTierPaintDiffEmpty(diff)) return;
        applyChildTierIncremental(nextSnapshot as ChildTierPaintSnapshot, diff);
      }

      selectionCtx.putImageData(selectionImageDataRef.current!, 0, 0);
      activeCtx.putImageData(activeImageDataRef.current!, 0, 0);
      prevPaintSnapshotRef.current = nextSnapshot;
    };

    if (needsFullPaint || !selectionImageDataRef.current) {
      if (rafPaintRef.current) {
        cancelAnimationFrame(rafPaintRef.current);
        rafPaintRef.current = 0;
        pendingSnapshotRef.current = null;
      }
      runFullPaint();
      return;
    }

    const prev = prevPaintSnapshotRef.current;
    if (countyMode) {
      const diff = diffCountyPaintSnapshot(
        prev as CountyPaintSnapshot | null,
        snapshot as CountyPaintSnapshot
      );
      if (diff && isCountyPaintDiffEmpty(diff)) {
        prevPaintSnapshotRef.current = snapshot;
        return;
      }
    } else {
      const diff = diffChildTierPaintSnapshot(
        prev as ChildTierPaintSnapshot | null,
        snapshot as ChildTierPaintSnapshot
      );
      if (diff && isChildTierPaintDiffEmpty(diff)) {
        prevPaintSnapshotRef.current = snapshot;
        return;
      }
    }

    pendingSnapshotRef.current = snapshot;
    if (rafPaintRef.current) return;

    rafPaintRef.current = requestAnimationFrame(() => {
      rafPaintRef.current = 0;
      const nextSnapshot = pendingSnapshotRef.current;
      pendingSnapshotRef.current = null;
      if (!nextSnapshot) return;
      applyIncremental(nextSnapshot);
    });
  }, [
    editorPickMode,
    countyMode,
    childTierMode,
    childTierConfig,
    index,
    regionIndex,
    mapId,
    tier,
    draft,
    childDraftForPaint,
    titleLayers,
    selectedId,
    provinceAssignment,
  ]);

  const syncNaturalMapSize = (img: HTMLImageElement) => {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (w <= 0 || h <= 0) return;

    const applied = appliedNaturalSizeRef.current;
    if (applied?.w === w && applied?.h === h) return;

    appliedNaturalSizeRef.current = { w, h };
    applyNaturalMapSize(img, setMapSize);
    onMapImageLoaded?.();
  };

  const handleBaseMapLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    syncNaturalMapSize(e.currentTarget);
  };

  const interactionCursor = mapInteractionCursor(
    viewport.isPanning,
    pick.isHoveringClickable
  );

  const showCountyEmptyState =
    countyMode && !selectedId && !loading && !error;
  const showChildTierEmptyState =
    childTierMode && !selectedId && !loading && !error;

  const childEmptyMessage = childTierConfig?.emptyStateMessage ?? "";

  return (
    <div className={`relative w-full min-w-0 max-w-full overflow-hidden ${panelClass}`}>
      {pick.cursorTooltip?.text ? (
        <div
          className="pointer-events-none fixed z-50 rounded-md bg-[var(--tfmc-forest-deep)] px-3 py-1.5 shadow-lg"
          style={{
            left: pick.cursorTooltip.x + 12,
            top: pick.cursorTooltip.y + 12,
          }}
        >
          <p className="text-sm text-[var(--tfmc-cream)]">
            {pick.cursorTooltip.text}
          </p>
        </div>
      ) : null}

      {loading && !suppressLoadingOverlay ? (
        <div className="flex min-h-[28rem] items-center justify-center p-8">
          <p className="text-sm text-[var(--tfmc-mist)]">Loading map pick data...</p>
        </div>
      ) : error ? (
        <div className="flex min-h-[28rem] items-center justify-center p-8">
          <p className="text-sm text-[#e8a0a0]">{error}</p>
        </div>
      ) : (
        <div className="w-full min-w-0">
          <MapViewport
            mapSize={mapSize}
            viewportRef={viewport.viewportRef}
            transformStyle={viewport.transformStyle}
            transformTransition={viewport.transformTransition}
            cursorClassName={interactionCursor}
            isPanning={viewport.isPanning}
          >
          <MapAuthImage
            mapId={mapId}
            path={`/${mapId}/map`}
            sessionToken={sessionToken}
            alt="Map"
            className="pointer-events-none block h-full w-full"
            imgRef={(node) => {
              if (node?.complete) {
                syncNaturalMapSize(node);
              }
            }}
            onLoad={handleBaseMapLoad}
          />
          {editorPickMode && index ? (
            <>
              <canvas
                ref={selectionCanvasRef}
                className="pointer-events-none absolute inset-0 h-full w-full"
                style={{ opacity: EDITOR_SELECTION_OPACITY }}
              />
              <canvas
                ref={activeCanvasRef}
                className="pointer-events-none absolute inset-0 h-full w-full"
                style={{ opacity: EDITOR_ACTIVE_OPACITY }}
              />
            </>
          ) : null}
          {showCountyEmptyState ? (
            <div
              className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_25%,transparent)]"
            >
              <p className="rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_15%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_80%,transparent)] px-4 py-2 text-sm text-[var(--tfmc-stone)]">
                Select a county or create new
              </p>
            </div>
          ) : null}
          {showChildTierEmptyState ? (
            <div
              className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_25%,transparent)]"
            >
              <p className="rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_15%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_80%,transparent)] px-4 py-2 text-sm text-[var(--tfmc-stone)]">
                {childEmptyMessage}
              </p>
            </div>
          ) : null}
          {!editorPickMode ? (
            <div
              className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_35%,transparent)]"
            >
              <p className="rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_15%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_80%,transparent)] px-4 py-2 text-sm text-[var(--tfmc-stone)]">
                Title pick available on county, duchy, kingdom, and empire tabs
              </p>
            </div>
          ) : null}
          <canvas
            ref={pickCanvasRef}
            className={`pointer-events-auto absolute inset-0 z-20 h-full w-full opacity-0 ${interactionCursor}`}
            onMouseMove={pick.onMouseMove}
            onMouseLeave={pick.onMouseLeave}
            onClick={pick.onClick}
          />
        </MapViewport>
        </div>
      )}
    </div>
  );
}
