import type { CreationCatalog } from "./api";

/** Background choices that tell where the character comes from; the others read as traits. */
export const ORIGIN_KEYS = ["homeland", "cataclysm", "reclamation", "motivation"];

export type BackgroundTrait = {
  id: string;
  key: string;
  name: string;
  description: string;
};

function lines(value: string | string[] | null | undefined): string[] {
  const list = Array.isArray(value) ? value : String(value ?? "").split("\n");
  return list.map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
}

/**
 * A trait's lore as one sentence or two. Lore may carry a race's version after a "<Race>:" line
 * (the Oseni side of the Cataclysm); that race reads its own version, everyone else the first.
 */
function describe(lore: string[], races: string[], race: string): string {
  const prefix = (l: string) => (l.includes(":") ? l.slice(0, l.indexOf(":")).trim().toLowerCase() : "");
  const at = lore.findIndex((l) => races.includes(prefix(l)));
  if (at < 1) return lore.join(" ");
  if (prefix(lore[at]) !== race) return lore.slice(0, at).join(" ");
  return [lore[at].slice(lore[at].indexOf(":") + 1).trim(), ...lore.slice(at + 1)].join(" ");
}

/**
 * The traits behind a synced background, which arrives as their in-game lore lines joined together.
 * Lines no catalogue trait accounts for stay in `rest`, rejoined into sentences.
 */
export function backgroundTraits(
  background: string,
  catalog?: Pick<CreationCatalog, "traits" | "races"> | null,
  race?: string | null,
): { traits: BackgroundTrait[]; rest: string } {
  // Blank lines stay as paragraph breaks.
  const text = background.split("\n").map((l) => l.replace(/\s+/g, " ").trim());
  const races = (catalog?.races ?? [])
    .flatMap((r) =>
      [r.id, r.name].map((v) =>
        String(v ?? "")
          .trim()
          .toLowerCase(),
      ),
    )
    .filter(Boolean);
  const ownRace = String(race ?? "")
    .trim()
    .toLowerCase();
  const candidates = (catalog?.traits ?? [])
    .map((t) => ({ trait: t, lore: lines(t.description) }))
    .filter((c) => c.lore.length)
    .sort((a, b) => b.lore.length - a.lore.length);
  const traits: BackgroundTrait[] = [];
  const runs: string[][] = [[]];
  const breakRun = () => {
    if (runs[runs.length - 1].length) runs.push([]);
  };
  for (let i = 0; i < text.length;) {
    if (!text[i]) {
      breakRun();
      i++;
      continue;
    }
    const hit = candidates.find((c) => c.lore.every((l, j) => text[i + j] === l));
    if (!hit) {
      runs[runs.length - 1].push(text[i++]);
      continue;
    }
    const { trait, lore } = hit;
    traits.push({
      id: trait.id,
      key: String(trait.key ?? "")
        .trim()
        .toLowerCase(),
      name: String(trait.name || trait.id).trim(),
      description: describe(lore, races, ownRace),
    });
    breakRun();
    i += lore.length;
  }
  return {
    traits,
    rest: runs
      .map((r) => r.join(" "))
      .filter(Boolean)
      .join("\n\n"),
  };
}
