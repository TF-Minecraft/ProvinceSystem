import type { SettlementMarker } from "@/app/components/map/types";
import { cleanRegionName } from "@/app/lib/mapLabels";

/**
 * What the map's realm panel shows about a nation, and nothing more.
 *
 * `/data/nation` carries far more than a public map should put in front of a
 * reader: guild ledgers and balances, member lists, military and
 * installation queues, election state. They are reachable through the API,
 * but that is no reason to give them prominence. This is the allowlist: every
 * field the panel renders is read here, by name, and anything not named here
 * never reaches the page.
 */
export type RealmProfile = {
  id: string;
  name: string;
  rgb: string | null;
  banner: string | null;
  /** "Obscure", "Influential", "Powerful", "Glorious", or null if unranked. */
  rank: string | null;
  rulerTitle: string | null;
  /**
   * The ruler's roleplay character name, as SimpleFactions last saw it in
   * RPCharacters. Never the Minecraft username: the map names people by their
   * character, and a realm whose leader has not been seen online since the
   * export learned this shows no ruler name rather than an account name.
   */
  leader: string | null;
  government: string | null;
  culture: string | null;
  religion: string | null;
  /** Province id of the capital; SimpleFactions writes -1 for none. */
  capitalProvince: number | null;
  /** Unix seconds. */
  foundedAt: number | null;
  /** Provinces held directly. */
  provinces: number;
  /** Provinces including subjects'. */
  realmSize: number;
  overlordId: string | null;
  subjects: string[];
  relations: RealmRelation[];
};

export type RelationAttitude = "friendly" | "neutral" | "unfriendly" | "hostile";

export type RealmRelation = {
  /** The other realm's region id. */
  id: string;
  /** Relation kind exactly as SimpleFactions names it, e.g. "palatinate". */
  kind: string | null;
  attitude: RelationAttitude | string | null;
  score: number | null;
};

type RawRealm = Record<string, unknown>;

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = cleanRegionName(value);
  return cleaned ? cleaned : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/** `"powerful_faction"` → `"Powerful"`. */
export function realmRankLabel(rank: unknown): string | null {
  if (typeof rank !== "string" || !rank.trim()) return null;
  const word = rank.trim().replace(/_faction$/i, "").replace(/_/g, " ");
  return word ? word[0].toUpperCase() + word.slice(1).toLowerCase() : null;
}

/** `"trade_agreement"` → `"Trade agreement"`; `"none"` → null. */
export function relationKindLabel(kind: string | null): string | null {
  if (!kind || kind === "none") return null;
  const words = kind.replace(/_/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : null;
}

/**
 * Parses one `relations` entry, `Name(kind.attitude.score)`, e.g.
 * `Thalendor(none.unfriendly.-20)`. The realm id is everything before the
 * *last* opening bracket, so an id that itself contains brackets survives.
 * Anything malformed is dropped rather than shown half-read.
 */
export function parseRealmRelation(raw: string): RealmRelation | null {
  const open = raw.lastIndexOf("(");
  if (open <= 0 || !raw.endsWith(")")) return null;
  const id = raw.slice(0, open).trim();
  const [kind, attitude, ...scoreParts] = raw.slice(open + 1, -1).split(".");
  if (!id || kind === undefined) return null;
  const score = Number(scoreParts.join("."));
  return {
    id,
    kind: kind || null,
    attitude: attitude || null,
    score: scoreParts.length && Number.isFinite(score) ? score : null,
  };
}

/**
 * `leader character`, but only while it still belongs to the current leader
 * (`leader character of`). SimpleFactions already drops a stale name on save;
 * checking again here covers an export written between a leadership change
 * and the next save.
 */
export function leaderCharacterName(raw: Record<string, unknown>): string | null {
  const name = text(raw["leader character"]);
  if (!name) return null;
  const of = raw["leader character of"];
  const leader = raw.leader;
  if (typeof of === "string" && typeof leader === "string") {
    if (of.toLowerCase() !== leader.toLowerCase()) return null;
  }
  return name;
}

export function buildRealmProfile(id: string, raw: RawRealm): RealmProfile {
  const capital = finiteNumber(raw.capital);
  const foundedAt = finiteNumber(raw["founded at"]);
  const provinces = Array.isArray(raw.provinces) ? raw.provinces.length : 0;
  const size = finiteNumber(raw.size);
  const subjectSize = finiteNumber(raw.subject_size) ?? 0;
  const overlord = typeof raw.overlord === "string" && raw.overlord ? raw.overlord : null;

  return {
    id,
    name: text(raw.name) ?? id,
    rgb: typeof raw.rgb === "string" ? raw.rgb : null,
    banner: typeof raw.banner === "string" && raw.banner ? raw.banner : null,
    rank: realmRankLabel(raw.rank),
    rulerTitle: text(raw["ruler title"]),
    leader: leaderCharacterName(raw),
    government: text(raw.government),
    culture: text(raw.culture),
    religion: text(raw.religion),
    capitalProvince: capital !== null && capital >= 0 ? capital : null,
    foundedAt: foundedAt !== null && foundedAt > 0 ? foundedAt : null,
    provinces,
    realmSize: size ?? provinces + subjectSize,
    overlordId: overlord,
    subjects: stringList(raw.subjects),
    relations: stringList(raw.relations)
      .map(parseRealmRelation)
      .filter((relation): relation is RealmRelation => relation !== null),
  };
}

/**
 * The capital's settlement, if SimpleFactions has named one. A faction capital
 * owned by this realm wins; failing that, any settlement in the capital
 * province.
 */
export function realmCapitalSettlement(
  profile: Pick<RealmProfile, "id" | "capitalProvince">,
  settlements: SettlementMarker[]
): SettlementMarker | null {
  if (profile.capitalProvince === null) return null;
  const inCapital = settlements.filter(
    (settlement) => settlement.province_id === profile.capitalProvince
  );
  return (
    inCapital.find(
      (settlement) =>
        settlement.kind === "faction_capital" && settlement.faction_id === profile.id
    ) ??
    inCapital[0] ??
    null
  );
}

/** `1791002672` → `"3 Oct 2026"`, in UTC so server and client agree. */
export function formatFoundedDate(seconds: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(seconds * 1000));
}

const ATTITUDE_ORDER: Record<string, number> = {
  hostile: 0,
  unfriendly: 1,
  friendly: 2,
  neutral: 3,
};

/**
 * Relations worth reading first: formal ties (alliance, overlord, subject,
 * trade) before plain attitudes, then hostility before friendship, then by
 * strength of feeling.
 */
export function sortRealmRelations(relations: RealmRelation[]): RealmRelation[] {
  return [...relations].sort((a, b) => {
    const formalA = relationKindLabel(a.kind) ? 0 : 1;
    const formalB = relationKindLabel(b.kind) ? 0 : 1;
    if (formalA !== formalB) return formalA - formalB;
    const attitudeA = ATTITUDE_ORDER[a.attitude ?? ""] ?? 4;
    const attitudeB = ATTITUDE_ORDER[b.attitude ?? ""] ?? 4;
    if (attitudeA !== attitudeB) return attitudeA - attitudeB;
    return Math.abs(b.score ?? 0) - Math.abs(a.score ?? 0);
  });
}
