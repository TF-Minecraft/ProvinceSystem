import { describe, expect, it } from "vitest";

import {
  buildRealmProfile,
  formatFoundedDate,
  parseRealmRelation,
  realmCapitalSettlement,
  realmRankLabel,
  relationKindLabel,
  sortRealmRelations,
} from "./realmProfile";

describe("parseRealmRelation", () => {
  it("reads kind, attitude and a negative score", () => {
    expect(parseRealmRelation("Thalendor(none.unfriendly.-20)")).toEqual({
      id: "Thalendor",
      kind: "none",
      attitude: "unfriendly",
      score: -20,
    });
  });

  it("keeps brackets inside the realm id", () => {
    expect(parseRealmRelation("The (Old) Guard(ally.friendly.80)")).toEqual({
      id: "The (Old) Guard",
      kind: "ally",
      attitude: "friendly",
      score: 80,
    });
  });

  it("drops malformed entries", () => {
    expect(parseRealmRelation("Thalendor")).toBeNull();
    expect(parseRealmRelation("(ally.friendly.80)")).toBeNull();
    expect(parseRealmRelation("Thalendor(ally.friendly.80")).toBeNull();
  });

  it("leaves a missing score as null", () => {
    expect(parseRealmRelation("12(palatinate.friendly)")?.score).toBeNull();
  });
});

describe("labels", () => {
  it("names ranks without the faction suffix", () => {
    expect(realmRankLabel("powerful_faction")).toBe("Powerful");
    expect(realmRankLabel("obscure_faction")).toBe("Obscure");
    expect(realmRankLabel("")).toBeNull();
    expect(realmRankLabel(undefined)).toBeNull();
  });

  it("keeps SimpleFactions' relation kinds rather than inventing categories", () => {
    expect(relationKindLabel("trade_agreement")).toBe("Trade agreement");
    expect(relationKindLabel("palatinate")).toBe("Palatinate");
    expect(relationKindLabel("mercantile")).toBe("Mercantile");
    expect(relationKindLabel("none")).toBeNull();
    expect(relationKindLabel(null)).toBeNull();
  });

  it("formats the founding date in UTC", () => {
    expect(formatFoundedDate(0)).toBe("1 Jan 1970");
  });
});

describe("buildRealmProfile", () => {
  const raw = {
    id: "Rat_Hill",
    name: "§x§a§3§a§1§8§4Rat Hill",
    rgb: "90,200,120",
    leader: "GingerBAR",
    "ruler title": "Leader",
    government: "Community",
    culture: "Multicultural",
    religion: "The Eye",
    rank: "influential_faction",
    capital: 212,
    "founded at": 1791002672,
    banner: "90_200_120",
    provinces: [1, 2, 3],
    size: 5,
    subject_size: 2,
    subjects: ["Dyonine", "The_New_Waters_Port"],
    relations: ["Sunsora(none.friendly.50)", "broken"],
    guilds: [{ balance: 1234, members: ["someone"] }],
    "military queue": ["x"],
  };

  it("reads the allowlisted facts", () => {
    const profile = buildRealmProfile("Rat_Hill", raw);

    expect(profile).toMatchObject({
      id: "Rat_Hill",
      name: "Rat Hill",
      rank: "Influential",
      rulerTitle: "Leader",
      leader: "GingerBAR",
      government: "Community",
      culture: "Multicultural",
      religion: "The Eye",
      capitalProvince: 212,
      foundedAt: 1791002672,
      provinces: 3,
      realmSize: 5,
      overlordId: null,
      subjects: ["Dyonine", "The_New_Waters_Port"],
    });
    expect(profile.relations).toHaveLength(1);
  });

  it("never carries ledger, member or queue data", () => {
    const profile = buildRealmProfile("Rat_Hill", raw);
    const serialised = JSON.stringify(profile);

    expect(serialised).not.toContain("balance");
    expect(serialised).not.toContain("someone");
    expect(serialised).not.toContain("1234");
    expect(Object.keys(profile)).not.toContain("guilds");
  });

  it("treats -1 as no capital and tolerates missing fields", () => {
    const profile = buildRealmProfile("Masao", { capital: -1, overlord: "Sunsora" });

    expect(profile.capitalProvince).toBeNull();
    expect(profile.foundedAt).toBeNull();
    expect(profile.name).toBe("Masao");
    expect(profile.overlordId).toBe("Sunsora");
    expect(profile.realmSize).toBe(0);
  });
});

describe("realmCapitalSettlement", () => {
  const settlements = [
    { id: "a", name: "Market Town", province_id: 212, kind: "settlement" as const },
    {
      id: "b",
      name: "Cru' Sadin",
      province_id: 212,
      kind: "faction_capital" as const,
      faction_id: "Rat_Hill",
    },
  ];

  it("prefers the realm's own faction capital", () => {
    expect(
      realmCapitalSettlement({ id: "Rat_Hill", capitalProvince: 212 }, settlements)?.name
    ).toBe("Cru' Sadin");
  });

  it("falls back to any settlement in the capital province", () => {
    expect(
      realmCapitalSettlement({ id: "Other", capitalProvince: 212 }, settlements)?.name
    ).toBe("Market Town");
  });

  it("has nothing for a realm without a capital", () => {
    expect(
      realmCapitalSettlement({ id: "Rat_Hill", capitalProvince: null }, settlements)
    ).toBeNull();
  });
});

describe("sortRealmRelations", () => {
  it("puts formal ties first, then hostility, then strength", () => {
    const sorted = sortRealmRelations([
      { id: "a", kind: "none", attitude: "friendly", score: 50 },
      { id: "b", kind: "none", attitude: "hostile", score: -6 },
      { id: "c", kind: "ally", attitude: "friendly", score: 80 },
      { id: "d", kind: "none", attitude: "friendly", score: 70 },
    ]);

    expect(sorted.map((relation) => relation.id)).toEqual(["c", "b", "d", "a"]);
  });
});
