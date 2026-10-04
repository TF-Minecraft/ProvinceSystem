import { useEffect, useState } from "react";

import type {
  FortMarker,
  InstallationMarker,
  MapId,
  SettlementMarker,
  WarExport,
} from "../components/map/types";
import { filterPlacedInstallations } from "../lib/installationMarkers";
import { filterPlacedSettlements } from "../lib/settlementMarkers";
import { fetchMapMarkersForDay } from "@/app/lib/map/dataSource";
import { isChronicleDayFileMissing } from "@/app/lib/map/chronicleData";

/**
 * Hard ceiling on how many of each marker kind reach the DOM.
 *
 * `MapCanvas` renders **two** `MapMarkerLayer`s and `shouldShowMapMarker` only
 * sets opacity — it does not omit the node — so every marker is a live DOM
 * subtree, twice. A stored `map_markers.json` is an immutable file this app
 * did not produce, and one with a huge array freezes the tab with no way back.
 *
 * 5000 is comfortably above anything real: `main` has 806 provinces, and even
 * a settlement, an installation and a fort in every one of them is under 1000
 * of each kind. Anything past this is a corrupt or hostile file, not a map.
 */
export const MAX_MAP_MARKERS_PER_KIND = 5000;

/**
 * Truncates and warns exactly once per load when the cap bites, so a map that
 * silently lost markers is never possible.
 */
function capMarkers<T>(
  items: T[],
  kind: string,
  warned: { fired: boolean }
): T[] {
  if (items.length <= MAX_MAP_MARKERS_PER_KIND) return items;
  if (!warned.fired) {
    warned.fired = true;
    console.warn(
      `[useMapMarkers] ${kind}: ${items.length} markers exceeds the ` +
        `${MAX_MAP_MARKERS_PER_KIND} cap; the map is showing a truncated set.`
    );
  }
  return items.slice(0, MAX_MAP_MARKERS_PER_KIND);
}

type MapMarkersState = {
  settlements: SettlementMarker[];
  installations: InstallationMarker[];
  forts: FortMarker[];
  wars: WarExport[];
  loading: boolean;
  error: string | null;
};

export function useMapMarkers(
  mapId: MapId,
  sessionToken?: string | null,
  enabled = true,
  /**
   * A chronicle day, or `null` for the live map. `map_markers` is captured, so
   * every day has a markers variant. Taken as a parameter, not read from
   * context, so the data flow is visible at the call site.
   */
  day: string | null = null
): MapMarkersState {
  const [state, setState] = useState<MapMarkersState>({
    settlements: [],
    installations: [],
    forts: [],
    wars: [],
    loading: enabled,
    error: null,
  });

  useEffect(() => {
    if (!enabled) {
      setState({
        settlements: [],
        installations: [],
        forts: [],
        wars: [],
        loading: false,
        error: null,
      });
      return;
    }

    let cancelled = false;

    const load = async () => {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const data = await fetchMapMarkersForDay({ mapId, day, sessionToken });
        if (cancelled) return;
        const warned = { fired: false };
        setState({
          // `?? []` was already here; the `Array.isArray` guards are new and
          // matter for the day path, where the payload is a stored file rather
          // than a response this app's own serializer just produced. There is
          // no error boundary under `app/`, so a non-array reaching
          // `filterPlacedSettlements` blanks the whole page, not one layer.
          settlements: capMarkers(
            filterPlacedSettlements(
              Array.isArray(data.settlements) ? data.settlements : []
            ),
            "settlements",
            warned
          ),
          installations: capMarkers(
            filterPlacedInstallations(
              Array.isArray(data.installations) ? data.installations : []
            ),
            "installations",
            warned
          ),
          forts: capMarkers(
            Array.isArray(data.forts) ? data.forts : [],
            "forts",
            warned
          ),
          wars: capMarkers(
            Array.isArray(data.wars) ? data.wars : [],
            "wars",
            warned
          ),
          loading: false,
          error: null,
        });
      } catch (err) {
        if (cancelled) return;
        if (isChronicleDayFileMissing(err)) {
          // A day that stored no markers is a normal state, not a failure:
          // empty layers with `error: null`, and nothing logged.
          setState({
            settlements: [],
            installations: [],
            forts: [],
            wars: [],
            loading: false,
            error: null,
          });
          return;
        }
        const message =
          err instanceof Error ? err.message : "Failed to load map markers";
        console.error("[useMapMarkers]", message, err);
        setState({
          settlements: [],
          installations: [],
          forts: [],
          wars: [],
          loading: false,
          error: message,
        });
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [mapId, sessionToken, enabled, day]);

  return state;
}
