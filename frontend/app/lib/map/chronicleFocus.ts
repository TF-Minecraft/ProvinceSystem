import type { RegionRecord } from "../../components/map/types";
import { cleanRegionName, type NationLabelSpec } from "../mapLabels";
import { chronicleRealmContains } from "./chronicleOwnership";

/**
 * Narrowing a chronicle frame to one realm.
 *
 * A world map at 720 px with two hundred realms is confetti: the eye cannot
 * follow one border through a timelapse of all of them. Focus answers "watch
 * this one realm" without a second render path — every consumer keeps drawing
 * exactly what it drew before, from inputs this module has already narrowed.
 *
 * Nothing here fetches or decides what to fetch. Focus is a view over whatever
 * the enabled layers already pulled, so switching it can never turn into a
 * request or a rebuild.
 *
 * Pure, and separate from the components, because the day files are unvalidated
 * network JSON and there is no error boundary under `app/`: a realm whose
 * `provinces` came back as an object must narrow to nothing, not throw during
 * render.
 */

/** The picker's "no focus" value, and the studio's default. */
export const CHRONICLE_FOCUS_NONE = "";

export type ChronicleFocusOption = {
  id: string;
  /** Display name, already stripped of Minecraft colour codes. */
  name: string;
};

/**
 * Reads a day-file entry by id without going through the prototype chain.
 *
 * Realm ids are player-set object keys from `JSON.parse`, so a file can carry
 * a literal `__proto__` or `constructor` key; a bare `record[id]` on an id that
 * is neither would otherwise answer with `Object.prototype`'s member and hand
 * back a "realm" made of `Function`.
 */
function entryOf(record: RegionRecord | null, id: string) {
  if (!record || !Object.prototype.hasOwnProperty.call(record, id)) return null;
  const entry = record[id];
  return entry && typeof entry === "object" ? entry : null;
}

/**
 * The realms a day's nation file offers to focus on, sorted by display name.
 *
 * Sorted by name and tie-broken on the id, so the list is stable across two
 * realms that display the same name — a picker whose options reorder between
 * renders loses the user's selection under the cursor.
 */
export function chronicleFocusOptions(
  nationFile: RegionRecord | null
): ChronicleFocusOption[] {
  if (!nationFile) return [];
  const options: ChronicleFocusOption[] = [];
  for (const id of Object.keys(nationFile)) {
    const entry = entryOf(nationFile, id);
    if (!entry) continue;
    const raw = typeof entry.name === "string" ? entry.name : id;
    options.push({ id, name: cleanRegionName(raw) || id });
  }
  return options.sort(
    (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
  );
}

/**
 * The province ids the focused realm holds on this day, or null when there is
 * nothing to narrow against.
 *
 * Three distinct answers, and the difference between the last two is the whole
 * behaviour of a focus on a day the realm is absent from:
 *
 * - No focus set: null. Callers leave their input alone.
 * - Focus set, but this day pulled no nation file at all: null too. Ownership
 *   is simply unknown here, and greying the entire map over a fact nobody
 *   established would be a lie about the day rather than a view of it.
 * - Focus set and the day's file has no such realm — founded later, destroyed
 *   earlier: the empty set. Every province greys, no label survives, no pin
 *   survives, and the day reads as "this realm was not here", which is a true
 *   frame of the timelapse rather than a gap in it.
 *
 * Occupied land counts as held, for the focused realm itself. A realm's
 * conquests are the part of its story a timelapse is watched for, and dropping
 * them would grey out the ground it just took on the very day it took it.
 * Vassals' home provinces count too: the fill paints them as part of the
 * suzerain, and leaving them out of the focus set would grey that land on the
 * day it is being watched.
 */
export function chronicleFocusProvinceIds(
  nationFile: RegionRecord | null,
  focusNationId: string | null
): ReadonlySet<number> | null {
  if (!focusNationId || !nationFile) return null;
  const ids = new Set<number>();
  if (!Object.prototype.hasOwnProperty.call(nationFile, focusNationId)) {
    return ids;
  }
  for (const id of Object.keys(nationFile)) {
    if (!chronicleRealmContains(nationFile, focusNationId, id)) continue;
    const entry = entryOf(nationFile, id);
    const lists =
      id === focusNationId
        ? [entry?.provinces, entry?.occupied_held]
        : [entry?.provinces];
    for (const list of lists) {
      if (!Array.isArray(list)) continue;
      for (const provinceId of list) {
        if (Number.isInteger(provinceId) && provinceId > 0) {
          ids.add(provinceId as number);
        }
      }
    }
  }
  return ids;
}

/**
 * Realm names narrowed to the focused realm. `NationLabelSpec` carries the
 * `nationId` the label was computed for, so this is an exact filter rather than
 * a match on the rendered text — two realms can legitimately display the same
 * name once the colour codes are stripped.
 *
 * Returns the array itself when nothing is focused, so an unfocused frame holds
 * the identical object it always did and the label layer's memoisation is not
 * defeated by a fresh copy every render.
 */
export function focusChronicleLabels(
  labels: NationLabelSpec[],
  focusNationId: string | null
): NationLabelSpec[] {
  if (!focusNationId) return labels;
  return labels.filter((label) => label.nationId === focusNationId);
}

/**
 * Whether a pin survives the focus, given whatever owner id its payload
 * carried.
 *
 * A pin with no `faction_id` is dropped under a focus rather than kept: an
 * unowned town is not the focused realm's, and keeping every ownerless pin
 * would leave the "one realm" view speckled with marks belonging to nobody in
 * it. With no focus set every pin passes, which is the existing behaviour
 * unchanged.
 */
export function focusOwnsMarker(
  factionId: string | null | undefined,
  focusNationId: string | null
): boolean {
  if (!focusNationId) return true;
  return factionId === focusNationId;
}
