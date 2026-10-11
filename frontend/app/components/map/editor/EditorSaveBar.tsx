"use client";

import type { MapId } from "@/app/components/map/types";
import { liveMapHref } from "@/app/lib/map/chronicleDayRoute";

import type { ExportState } from "@/app/hooks/useEditorExport";

const buttonClass =
  "rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_25%,transparent)] bg-[var(--tfmc-moss)] px-3 py-2 text-sm text-[var(--tfmc-cream)] transition hover:brightness-110 hover:border-[var(--tfmc-accent)] active:scale-[0.98] disabled:opacity-60";

const linkClass =
  "rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_25%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_40%,transparent)] px-3 py-2 text-sm text-[var(--tfmc-cream)] no-underline transition hover:brightness-110 hover:border-[var(--tfmc-accent)]";

function mapViewerPath(mapId: MapId): string {
  return liveMapHref(mapId);
}

type EditorSaveBarProps = {
  mapId: MapId;
  exportState: ExportState;
  exportError: string | null;
  canExport: boolean;
  onExport: () => void;
};

export default function EditorSaveBar({
  mapId,
  exportState,
  exportError,
  canExport,
  onExport,
}: EditorSaveBarProps) {
  const viewerPath = mapViewerPath(mapId);

  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-moss)_25%,var(--tfmc-forest-deep))] p-3 shadow-lg"
    >
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={buttonClass}
          disabled={!canExport}
          onClick={() => void onExport()}
        >
          {exportState === "exporting" ? "Preparing ZIP..." : "Download ZIP"}
        </button>
        <a
          href={viewerPath}
          target="_blank"
          rel="noopener noreferrer"
          className={linkClass}
        >
          Open map
        </a>
      </div>

      {exportError ? (
        <p className="text-sm text-[#e8a0a0]" role="alert">{exportError}</p>
      ) : null}
    </div>
  );
}
