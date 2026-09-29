import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  fetchLedgerIndex,
  fetchLedgerSeries,
  uniqueFactionKeys,
  type LedgerRegistryFaction,
  type LedgerSeries,
} from "../../lib/map/ledgerData";
import {
  buildLedgerFactionOptions,
  defaultLedgerFactionOption,
  factionsInRange,
  spliceLedgerFaction,
  type LedgerFactionOption,
  type MergedLedgerFaction,
} from "../../lib/map/ledgerSeries";
import { isAbortError } from "@/lib/map/api";
import type { MapId } from "../map/types";

/**
 * Loads the ledger registry and series for the studio's chart panel.
 *
 * Pure data-fetching: everything this returns is handed to `ledgerSeries.ts`'s
 * geometry functions by the panel, and nothing here shapes a chart. Each of
 * the panel's three cards (wealth/prestige/income) owns its own nation
 * selection independent of the other two — see `LedgerCardId` — so this hook
 * fetches the *union* of whatever the three cards have selected in one
 * `/series?factions=` request rather than three parallel ones, and refetches
 * only when that union actually changes.
 */

export type LedgerCardId = "wealth" | "prestige" | "income";

export const LEDGER_CARD_IDS: LedgerCardId[] = ["wealth", "prestige", "income"];

export type LedgerChartsResult =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  /** The map has no ledger data at all yet — a fresh season, or unupgraded SF. */
  | { status: "empty" }
  /** The registry has no factions at all for the built range. */
  | { status: "no-options" }
  | {
      status: "ready";
      /** One option per exact registry name for the built range, deleted
       * nations included — a name backed by more than one `(id, founded_at)`
       * lifetime (deleted-and-refounded) is already merged into a single
       * option here (see `buildLedgerFactionOptions`). Shared by all three
       * cards' dropdowns. */
      options: LedgerFactionOption[];
      /** The current selection per card — a `LedgerFactionOption.name`, not a
       * `faction_key`, since a selection can now span multiple keys. */
      selections: Record<LedgerCardId, string>;
      onSelect: (card: LedgerCardId, name: string) => void;
      /** The union fetch's own state — kept separate from the panel-level
       * `status` above so the dropdowns never disappear while a selection
       * change is in flight. */
      series: LedgerSeries | null;
      seriesLoading: boolean;
      seriesError: string | null;
    };

export type UseLedgerSeriesArgs = {
  mapId: MapId;
  sessionToken?: string | null;
  /** Gates the fetch — the panel is play-stage only. */
  active: boolean;
  firstDay: string | null;
  lastDay: string | null;
  /** The studio's `activeFocusNationId` — used only to seed each card's
   * default selection the first time the registry loads. */
  focusNationId: string | null;
};

/** A merged option's data spliced out of a series response, or `null` when
 * none of its underlying keys are (yet) in it — e.g. the selection just
 * changed and the union fetch for its keys hasn't landed. Delegates the
 * actual splicing to `spliceLedgerFaction` (`ledgerSeries.ts`); this is just
 * the by-name lookup into `options`. */
export function factionForKey(
  series: LedgerSeries | null,
  options: LedgerFactionOption[],
  name: string | null
): MergedLedgerFaction | null {
  if (!series || !name) return null;
  const option = options.find((entry) => entry.name === name);
  if (!option) return null;
  return spliceLedgerFaction(option, series);
}

export function useLedgerSeries({
  mapId,
  sessionToken,
  active,
  firstDay,
  lastDay,
  focusNationId,
}: UseLedgerSeriesArgs): LedgerChartsResult {
  const [base, setBase] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "empty" }
    | { status: "no-options" }
    | { status: "ready"; factions: LedgerRegistryFaction[] }
  >({ status: "idle" });
  const [selections, setSelections] = useState<Partial<Record<LedgerCardId, string>>>({});
  const [series, setSeries] = useState<LedgerSeries | null>(null);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [seriesError, setSeriesError] = useState<string | null>(null);

  const indexAbortRef = useRef<AbortController | null>(null);
  const seriesAbortRef = useRef<AbortController | null>(null);

  // Load the registry once per (map, range). Selections reset — a new range
  // can drop the previously selected lifetime entirely (`no-match` no longer
  // exists as a status since a selection always comes from the current
  // registry's own options).
  useEffect(() => {
    indexAbortRef.current?.abort();
    setSelections({});
    setSeries(null);
    setSeriesError(null);

    if (!active || !firstDay || !lastDay) {
      setBase({ status: "idle" });
      return;
    }

    const controller = new AbortController();
    indexAbortRef.current = controller;
    let cancelled = false;
    setBase({ status: "loading" });

    const load = async () => {
      try {
        const index = await fetchLedgerIndex(mapId, sessionToken, controller.signal);
        if (cancelled) return;
        if (index.days.length === 0) {
          setBase({ status: "empty" });
          return;
        }
        const factions = factionsInRange(index.factions, firstDay, lastDay);
        if (factions.length === 0) {
          setBase({ status: "no-options" });
          return;
        }
        setBase({ status: "ready", factions });
      } catch (err) {
        if (cancelled || isAbortError(err)) return;
        setBase({
          status: "error",
          message: err instanceof Error ? err.message : "Failed to load the ledger.",
        });
      }
    };

    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [mapId, sessionToken, active, firstDay, lastDay]);

  // Seed each card's default the first time (and only the first time) the
  // registry loads for this range — a card the user has already touched keeps
  // its own choice.
  useEffect(() => {
    if (base.status !== "ready" || !firstDay || !lastDay) return;
    const fallback = defaultLedgerFactionOption(base.factions, focusNationId, firstDay, lastDay);
    if (!fallback) return;
    setSelections((current) => {
      let changed = false;
      const next = { ...current };
      for (const card of LEDGER_CARD_IDS) {
        if (!next[card]) {
          next[card] = fallback;
          changed = true;
        }
      }
      return changed ? next : current;
    });
    // Only re-seed when the registry itself (re)loads, not on every keystroke
    // of an independent per-card selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, firstDay, lastDay, focusNationId]);

  const options = useMemo(
    () => (base.status === "ready" ? buildLedgerFactionOptions(base.factions) : []),
    [base]
  );

  // A card's selection is a name, which can back more than one `faction_key`
  // (the merged deleted-and-refounded case) — the union fetch still needs
  // every one of those keys, not just the first, so each selected name is
  // expanded to its option's full `keys` before de-duplicating.
  const unionKeys = useMemo(() => {
    const expanded: Array<string | null | undefined> = [];
    for (const card of LEDGER_CARD_IDS) {
      const name = selections[card];
      const option = name ? options.find((entry) => entry.name === name) : undefined;
      if (option) expanded.push(...option.keys);
    }
    return uniqueFactionKeys(expanded);
  }, [selections, options]);
  const unionSignature = unionKeys.join(",");

  useEffect(() => {
    seriesAbortRef.current?.abort();

    if (base.status !== "ready" || !firstDay || !lastDay || unionKeys.length === 0) {
      setSeries(null);
      setSeriesLoading(false);
      return;
    }

    const controller = new AbortController();
    seriesAbortRef.current = controller;
    let cancelled = false;
    setSeriesLoading(true);
    setSeriesError(null);

    const load = async () => {
      try {
        const result = await fetchLedgerSeries(
          mapId,
          { start: firstDay, end: lastDay, factions: unionKeys, fields: "full" },
          sessionToken,
          controller.signal
        );
        if (cancelled) return;
        setSeries(result);
      } catch (err) {
        if (cancelled || isAbortError(err)) return;
        setSeriesError(err instanceof Error ? err.message : "Failed to load the ledger.");
      } finally {
        if (!cancelled) setSeriesLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
    // `unionSignature` is the real dependency — `unionKeys` is a fresh array
    // every render even when its contents haven't changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapId, sessionToken, base, firstDay, lastDay, unionSignature]);

  const onSelect = useCallback((card: LedgerCardId, key: string) => {
    setSelections((current) => ({ ...current, [card]: key }));
  }, []);

  if (base.status !== "ready") return base;

  const readySelections = {} as Record<LedgerCardId, string>;
  for (const card of LEDGER_CARD_IDS) {
    readySelections[card] = selections[card] ?? options[0]?.name ?? "";
  }

  return {
    status: "ready",
    options,
    selections: readySelections,
    onSelect,
    series,
    seriesLoading,
    seriesError,
  };
}
