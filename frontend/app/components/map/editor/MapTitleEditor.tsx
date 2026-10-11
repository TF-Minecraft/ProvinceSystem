"use client";

import { useCallback, useEffect, useRef } from "react";

import type { MapId } from "@/app/components/map/types";
import { mapDisplayName } from "@/app/components/map/types";
import { useEditorLoadProgress } from "@/app/hooks/useEditorLoadProgress";
import { useEditorProvinceIndex } from "@/app/hooks/useEditorProvinceIndex";
import { useEditorExport } from "@/app/hooks/useEditorExport";
import { useEditorDraft } from "@/app/hooks/useEditorDraft";
import { useTitleTierEditor } from "@/app/hooks/useTitleTierEditor";
import { canSelectProvince, buildProvinceToCountyId } from "@/app/lib/map/editor/countyAssignment";
import { isChildTierEditor } from "@/app/lib/map/editor/editorTierConfig";
import type { EditorTier } from "@/lib/map/api";

import EditorLoadProgress from "./EditorLoadProgress";
import EditorSaveBar from "./EditorSaveBar";
import MapEditorCanvas from "./MapEditorCanvas";
import TitleSidebar from "./TitleSidebar";

const TIER_TABS: { id: EditorTier; label: string }[] = [
  { id: "county", label: "County" },
  { id: "duchy", label: "Duchy" },
  { id: "kingdom", label: "Kingdom" },
  { id: "empire", label: "Empire" },
];

type MapTitleEditorProps = {
  mapId: MapId;
  initialTier: EditorTier;
  sessionToken: string;
};

export default function MapTitleEditor({ mapId, initialTier, sessionToken }: MapTitleEditorProps) {
  const editor = useEditorDraft({
    mapId,
    initialTier,
    sessionToken,
  });

  const countyMode = editor.tier === "county";
  const childTierMode = isChildTierEditor(editor.tier);
  const needsProvinceIndex = countyMode || childTierMode;

  const loadProgress = useEditorLoadProgress({
    needsProvinceIndex,
    childTierMode,
  });

  const onCatalogLoaded = useCallback(() => {
    loadProgress.markComplete("provinceCatalog");
    loadProgress.markActive("provinceGrid");
  }, [loadProgress.markComplete, loadProgress.markActive]);

  const onIndexLoaded = useCallback(() => {
    loadProgress.markComplete("provinceGrid");
  }, [loadProgress.markComplete]);

  const onMapImageLoaded = useCallback(() => {
    loadProgress.markComplete("mapImage");
  }, [loadProgress.markComplete]);

  const {
    index,
    loading: provinceIndexLoading,
    error: provinceIndexError,
  } = useEditorProvinceIndex(mapId, sessionToken, needsProvinceIndex, {
    onCatalogLoaded,
    onIndexLoaded,
  });

  const titleTierEditor = useTitleTierEditor({
    mapId,
    sessionToken,
    editor,
  });

  const editorExport = useEditorExport({
    mapId,
    sessionToken,
    getTierDraftsForExport: editor.getTierDraftsForExport,
    anyTierDirty: editor.anyTierDirty,
  });

  const prevTierRef = useRef(editor.tier);

  useEffect(() => {
    if (!editor.anyTierDirty) return;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [editor.anyTierDirty]);

  useEffect(() => {
    if (prevTierRef.current !== editor.tier) {
      loadProgress.resetStages(["titles", "childPick"]);
      prevTierRef.current = editor.tier;
    }
  }, [editor.tier, loadProgress.resetStages]);

  useEffect(() => {
    if (editor.loading) {
      loadProgress.markActive("titles");
      return;
    }
    if (!editor.error) {
      loadProgress.markComplete("titles");
    }
  }, [editor.loading, editor.error, loadProgress.markActive, loadProgress.markComplete]);

  useEffect(() => {
    if (!needsProvinceIndex) return;
    loadProgress.markActive("provinceCatalog");
  }, [mapId, needsProvinceIndex, loadProgress.markActive]);

  useEffect(() => {
    if (!childTierMode) return;

    const childPickLoading =
      titleTierEditor.childLayerLoading || titleTierEditor.childPickLoading || titleTierEditor.titleLayersLoading;

    if (childPickLoading) {
      loadProgress.markActive("childPick");
    } else {
      loadProgress.markComplete("childPick");
    }
  }, [
    childTierMode,
    titleTierEditor.childLayerLoading,
    titleTierEditor.childPickLoading,
    titleTierEditor.titleLayersLoading,
    loadProgress.markActive,
    loadProgress.markComplete,
  ]);

  useEffect(() => {
    loadProgress.markActive("mapImage");
  }, [mapId, loadProgress.markActive]);

  const handleCountyProvinceClick = useCallback(
    (provinceId: number) => {
      if (!countyMode || !editor.selectedId) return;

      const assignment = buildProvinceToCountyId(editor.draft);
      const selectedId = editor.selectedId;
      const inSelected = editor.draft[selectedId]?.provinces?.includes(provinceId);

      if (!canSelectProvince(provinceId, selectedId, assignment) && !inSelected) {
        return;
      }

      const usedRgbs = Object.entries(editor.draft)
        .filter(([id]) => id !== selectedId)
        .map(([, entry]) => entry.rgb);

      editor.toggleCountyProvince(selectedId, provinceId, {
        provinceRgb: index?.provinceToRgb[provinceId],
        usedRgbs,
      });
    },
    [countyMode, editor, index],
  );

  const showLoadOverlay = !loadProgress.ready && !editor.error && !(needsProvinceIndex && provinceIndexError);

  return (
    <div className="relative min-h-[calc(100dvh-var(--tfmc-header-h))] overflow-x-hidden text-[var(--tfmc-cream)]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_0%,color-mix(in_srgb,var(--tfmc-moss)_45%,transparent),transparent_65%),radial-gradient(ellipse_100%_80%_at_50%_100%,color-mix(in_srgb,var(--tfmc-forest)_85%,#000),transparent),linear-gradient(165deg,var(--tfmc-forest-deep)_0%,var(--tfmc-forest)_50%,#152820_100%)]"
      />
      <div className="relative z-10 mx-auto flex min-w-0 max-w-[90rem] flex-col gap-4 px-4 py-6 sm:px-6 md:py-8">
        <header>
          <p className="text-sm font-medium uppercase tracking-widest text-[var(--tfmc-mist)]">Staff tools</p>
          <h1 className="font-[family-name:var(--font-fraunces)] text-3xl font-medium tracking-tight text-[var(--tfmc-cream)] sm:text-4xl">
            Map editor
          </h1>
          <p className="mt-1 text-sm text-[var(--tfmc-stone)]">Editing: {mapDisplayName(mapId)}</p>
        </header>

        <div className="flex flex-wrap gap-2">
          {TIER_TABS.map((tab) => {
            const active = editor.tier === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => editor.setTier(tab.id)}
                className={`rounded-sm border px-3 py-2 text-sm font-medium transition ${
                  active
                    ? "border-[var(--tfmc-accent)] bg-[color-mix(in_srgb,var(--tfmc-accent)_20%,transparent)] text-[var(--tfmc-cream)]"
                    : "border-[color-mix(in_srgb,var(--tfmc-cream)_20%,transparent)] text-[var(--tfmc-stone)] hover:text-[var(--tfmc-cream)]"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
          {editor.anyTierDirty ? (
            <span className="self-center text-xs text-[var(--tfmc-mist)]">Unsaved changes</span>
          ) : null}
        </div>

        <EditorSaveBar
          mapId={mapId}
          exportState={editorExport.exportState}
          exportError={editorExport.exportError}
          canExport={editorExport.canExport}
          onExport={editorExport.exportZip}
        />

        {editor.error ? (
          <p className="rounded-sm border border-[#e8a0a0]/40 bg-[#e8a0a0]/10 px-3 py-2 text-sm text-[#e8a0a0]">
            {editor.error}
          </p>
        ) : null}

        {titleTierEditor.prerequisiteBanner ? (
          <p className="rounded-sm border border-[var(--tfmc-accent)]/40 bg-[color-mix(in_srgb,var(--tfmc-accent)_12%,transparent)] px-3 py-2 text-sm text-[var(--tfmc-cream)]">
            {titleTierEditor.prerequisiteBanner}
          </p>
        ) : null}

        {childTierMode && titleTierEditor.childLayerError ? (
          <p className="rounded-sm border border-[#e8a0a0]/40 bg-[#e8a0a0]/10 px-3 py-2 text-sm text-[#e8a0a0]">
            {titleTierEditor.childLayerError}
          </p>
        ) : null}

        <div className="relative flex min-w-0 flex-col gap-6 lg:flex-row lg:items-start">
          {showLoadOverlay ? (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_55%,transparent)] p-6">
              <EditorLoadProgress percent={loadProgress.percent} label={loadProgress.label} />
            </div>
          ) : null}

          <div className="w-full shrink-0 lg:w-80">
            <TitleSidebar
              tier={editor.tier}
              draft={editor.draft}
              selectedId={editor.selectedId}
              validationErrors={editorExport.validationErrors}
              onSelect={editor.selectTitle}
              onUpdate={editor.updateEntry}
              onAdd={editor.addTitle}
              onRemove={editor.removeTitle}
            />
          </div>
          <div className="min-h-[28rem] min-w-0 flex-1">
            <MapEditorCanvas
              mapId={mapId}
              sessionToken={sessionToken}
              tier={editor.tier}
              draft={editor.draft}
              childTierConfig={titleTierEditor.config}
              childDraft={titleTierEditor.childDraft}
              titleLayers={titleTierEditor.titleLayers}
              selectedId={editor.selectedId}
              onProvinceClick={handleCountyProvinceClick}
              onChildClick={titleTierEditor.handleChildPickClick}
              provinceIndex={index}
              provinceIndexLoading={provinceIndexLoading}
              provinceIndexError={provinceIndexError}
              childPick={titleTierEditor.childPick}
              childPickLoading={
                titleTierEditor.childLayerLoading ||
                titleTierEditor.childPickLoading ||
                titleTierEditor.titleLayersLoading
              }
              childPickError={titleTierEditor.childPickError}
              pickProvidedByParent={needsProvinceIndex}
              onMapImageLoaded={onMapImageLoaded}
              suppressLoadingOverlay={showLoadOverlay}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
