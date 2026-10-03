import { describe, expect, it } from "vitest";

import {
  buildGuildProfile,
  findGuild,
  guildSeat,
  guildsInProvince,
  guildTypeLabel,
  realmGuilds,
} from "./guildProfile";

const thalendor = {
  name: "Thalendor",
  guilds: [
    { id: "Thalendor", name: "Thalendor", type: "realm", leader: "GeoffLive", capital: 159, members: ["a", "b"] },
    {
      id: "Oyfthyr",
      name: "§x§a§3§a§1§8§4Oyfthyr",
      type: "guild",
      leader: "someplayer",
      "leader character": "Oyf the Elder",
      "leader character of": "someplayer",
      rgb: "10,20,30",
      capital: 163,
      members: ["someplayer", "another", "third"],
      balance: 1041.62,
      loans: [{ amount: 50 }],
      branches: [
        { id: "guild_halls", level: 6 },
        { id: "storehouses", level: 11 },
        { bad: true },
      ],
    },
    { id: "Small", name: "Small", type: "guild", leader: "x", capital: 161, members: ["x"] },
  ],
};

const regionData = { Thalendor: thalendor as never };

describe("buildGuildProfile", () => {
  it("reads the public facts and nothing else", () => {
    const guild = buildGuildProfile("Thalendor", thalendor.guilds[1]);
    expect(guild).toMatchObject({
      key: "Thalendor/Oyfthyr",
      name: "Oyfthyr",
      typeLabel: "Guild",
      leader: "Oyf the Elder",
      members: 3,
      homeProvince: 163,
      branches: [
        { id: "guild_halls", label: "Guild halls", level: 6 },
        { id: "storehouses", label: "Storehouses", level: 11 },
      ],
    });
    const serialised = JSON.stringify(guild);
    expect(serialised).not.toContain("1041");
    expect(serialised).not.toContain("another");
    expect(serialised).not.toContain("someplayer");
  });

  it("never names the leader by account", () => {
    expect(buildGuildProfile("Thalendor", thalendor.guilds[2])?.leader).toBeNull();
  });
});

describe("realm guilds", () => {
  it("lists the guilds, not the realm's own, largest first", () => {
    expect(realmGuilds("Thalendor", thalendor).map((guild) => guild.id)).toEqual([
      "Oyfthyr",
      "Small",
    ]);
  });

  it("finds a guild by key and by province", () => {
    expect(findGuild(regionData, "Thalendor/Oyfthyr")?.name).toBe("Oyfthyr");
    expect(findGuild(regionData, "Nope/Oyfthyr")).toBeNull();
    expect(guildsInProvince(regionData, 161).map((guild) => guild.id)).toEqual(["Small"]);
  });

  it("finds the settlement a guild is based in", () => {
    const guild = findGuild(regionData, "Thalendor/Oyfthyr")!;
    expect(
      guildSeat(guild, [
        { id: "Elsewhere", name: "Elsewhere", province_id: 1 },
        { id: "Oyfthyr", name: "Oyfthyr", province_id: 163, faction_id: "Thalendor" },
      ])?.id
    ).toBe("Oyfthyr");
    expect(guildSeat({ ...guild, homeProvince: null }, [])).toBeNull();
  });

  it("labels guild types", () => {
    expect(guildTypeLabel("realm")).toBe("Realm guild");
    expect(guildTypeLabel("trade_league")).toBe("Trade league");
  });
});
