"use client";

import { useCallback, useState } from "react";

import type { MapId } from "@/app/components/map/types";
import type { TitleDraft } from "@/app/hooks/useEditorDraft";
import { downloadBlob } from "@/app/lib/downloadBlob";
import { buildEditorTitlesZip, editorTitlesZipFilename } from "@/app/lib/map/editor/buildEditorTitlesZip";
import { EDITOR_TITLE_TIERS } from "@/app/lib/map/editor/editorTiers";
import { validateAllTiersForExport } from "@/app/lib/map/editor/validateAllTiersForExport";
import { fetchMapJson, type EditorTier } from "@/lib/map/api";

export type ExportState = "idle" | "exporting" | "error";

type TierDraftMapNullable = Record<EditorTier, TitleDraft | null>;

async function resolveAllTierDrafts(
  mapId: MapId,
  sessionToken: string,
  cached: TierDraftMapNullable,
): Promise<Record<EditorTier, TitleDraft>> {
  const resolved = {} as Record<EditorTier, TitleDraft>;

  await Promise.all(
    EDITOR_TITLE_TIERS.map(async (tier) => {
      if (cached[tier] !== null) {
        resolved[tier] = cached[tier]!;
        return;
      }
      resolved[tier] = await fetchMapJson<TitleDraft>(`/${mapId}/data/${tier}`, { sessionToken });
    }),
  );

  return resolved;
}

export function useEditorExport({
  mapId,
  sessionToken,
  getTierDraftsForExport,
  anyTierDirty,
}: {
  mapId: MapId;
  sessionToken: string;
  getTierDraftsForExport: () => TierDraftMapNullable;
  anyTierDirty: boolean;
}): {
  exportState: ExportState;
  exportError: string | null;
  validationErrors: string[];
  canExport: boolean;
  exportZip: () => Promise<void>;
} {
  const [exportState, setExportState] = useState<ExportState>("idle");
  const [exportError, setExportError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const canExport = anyTierDirty && exportState !== "exporting";

  const exportZip = useCallback(async () => {
    setExportError(null);
    setValidationErrors([]);

    setExportState("exporting");

    try {
      const drafts = await resolveAllTierDrafts(mapId, sessionToken, getTierDraftsForExport());

      const validation = validateAllTiersForExport(drafts);
      if (!validation.ok) {
        setValidationErrors(validation.errors);
        setExportError(validation.errors.join(" "));
        setExportState("error");
        return;
      }

      const zipBytes = buildEditorTitlesZip(drafts);
      const blob = new Blob([zipBytes.slice()], { type: "application/zip" });
      downloadBlob(blob, editorTitlesZipFilename(mapId));
      setExportState("idle");
      setExportError(null);
      setValidationErrors([]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to prepare title ZIP";
      setExportError(message);
      setExportState("error");
    }
  }, [mapId, sessionToken, getTierDraftsForExport]);

  return {
    exportState,
    exportError,
    validationErrors,
    canExport,
    exportZip,
  };
}
