import type { CatalogIdRow, CharacterListItem, CreationCatalog } from "./api";

function capitalizeId(raw: string | null | undefined): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function catalogName(rows: CatalogIdRow[] | undefined, id: string | null | undefined): string {
  const want = String(id || "").trim();
  if (!want || !rows?.length) return "";
  const row = rows.find((r) => r.id === want);
  const name = row?.name && String(row.name).trim();
  return name || "";
}

/** Prefer synced display name, then catalog name by id, then capitalized id. */
export function displayRace(
  item: Pick<CharacterListItem, "race" | "race_name">,
  catalog?: Pick<CreationCatalog, "races"> | null,
): string {
  const synced = String(item.race_name || "").trim();
  if (synced) return synced;
  const fromCatalog = catalogName(catalog?.races, item.race);
  if (fromCatalog) return fromCatalog;
  return capitalizeId(item.race);
}

/** Trait selection group heading (personality, evil, backstory stages). */
export function traitSelectionGroupLabel(key: string): string {
  const k = key.trim().toLowerCase();
  if (k === "permanent_injury") return "Backstory Injuries";
  if (k === "prosthetic") return "Backstory Prosthetic";
  return k ? k.charAt(0).toUpperCase() + k.slice(1) : "Other";
}

/** Prefer synced display name, then catalog name by id, then capitalized id. */
export function displayClass(
  item: Pick<CharacterListItem, "class" | "class_name">,
  catalog?: Pick<CreationCatalog, "classes"> | null,
): string {
  const synced = String(item.class_name || "").trim();
  if (synced) return synced;
  const fromCatalog = catalogName(catalog?.classes, item.class);
  if (fromCatalog) return fromCatalog;
  return capitalizeId(item.class);
}
