import type { WikiCommandSet, WikiSection } from "./types";

// ---------- Simple Factions ----------

export type FactionTier = { tier: string; prestige: string; formCost: string };

/** `tiers.yml`: untitled land is capped at 5 provinces; form a County to go past it. */
export const factionTiers: FactionTier[] = [
  { tier: "Province (untitled)", prestige: "10", formCost: "N/A" },
  { tier: "County", prestige: "100", formCost: "5" },
  { tier: "Duchy", prestige: "400", formCost: "4" },
  { tier: "Kingdom", prestige: "1,000", formCost: "4" },
  { tier: "Empire", prestige: "2,500", formCost: "3" },
];

export type FactionRank = { rank: string; prestige: string; ofHighest: string };

/** `ranks.yml`: prestige rank affects your de-jure requirement when annexing. */
export const factionRanks: FactionRank[] = [
  { rank: "Obscure Faction", prestige: "0", ofHighest: "0%" },
  { rank: "Influential Faction", prestige: "200", ofHighest: "40%" },
  { rank: "Powerful Faction", prestige: "500", ofHighest: "55%" },
  { rank: "Glorious Faction", prestige: "600", ofHighest: "75%" },
  { rank: "Legendary Faction", prestige: "3,000", ofHighest: "85%" },
];

export type InstallationInfo = {
  type: string;
  radius: number;
  upkeepPerDay: number;
  buildTime: string;
  slots: string;
};

/** Level-1 figures from `installations.yml`. Later train-station levels are noted on the page. */
export const installations: InstallationInfo[] = [
  { type: "Fort", radius: 80, upkeepPerDay: 30, buildTime: "5 days", slots: "8 static emplacement + 2 land vehicle" },
  { type: "Port", radius: 80, upkeepPerDay: 15, buildTime: "3 days", slots: "8 ship" },
  { type: "Airport", radius: 80, upkeepPerDay: 20, buildTime: "3 days", slots: "10 aircraft" },
  { type: "Train station", radius: 80, upkeepPerDay: 5, buildTime: "3 days", slots: "2 static emplacement" },
];

/**
 * SimpleFactions' `plugin.yml` declares no permissions at all: every command
 * is reachable by any player at the Bukkit level. Gating (leader/guild-leader
 * rank, democracy rules, etc.) happens entirely in code, noted per row below.
 */
export const factionsCommands: WikiCommandSet = {
  system: "Simple Factions",
  href: "/wiki/factions",
  commands: [
    { command: "/faction", description: "Opens the faction hub GUI." },
    { command: "/faction menu", description: "Opens the faction view." },
    { command: "/faction list", description: "Lists every faction on the server." },
    { command: "/faction create <name>", description: "Founds a new faction. You become its leader.", notes: "You must not already be in a faction." },
    { command: "/faction delete", description: "Disbands your faction.", notes: "Faction leader only. Blocked if bankrupt, has active loans, or a positive balance." },
    { command: "/faction invite <player>", description: "Invites a player to join.", notes: "Faction leader only. Blocked once you hit the 64-member cap." },
    { command: "/faction join <name>", description: "Joins a faction that invited you." },
    { command: "/faction leave", description: "Leaves your faction.", notes: "The leader must /faction delete instead; guild members use /guild leave." },
    { command: "/faction kick <player>", description: "Removes a member.", notes: "Faction leader only. Cannot kick the leader or a guild member." },
    { command: "/faction accept", description: "Accepts a pending diplomacy or transfer request.", notes: "Requires a pending request. Diplomacy and war prompts go to the faction leader; guild elevate, movement join, wanted-leader, and vehicle consent go to whoever received the prompt." },
    { command: "/faction setleader <player>", description: "Hands leadership to another member.", notes: "Faction leader only. Blocked under a democracy government." },
    { command: "/faction rename <name>", description: "Renames the faction.", notes: "Faction leader only." },
    { command: "/faction setcapital <name>", description: "Founds or moves the capital in your current province.", notes: "Faction leader only." },
    { command: "/faction claim", description: "Claims the province you're standing in.", notes: "Faction leader only. Needs a capital first; blocked during a civil war and past the 5-province untitled cap." },
    { command: "/faction unclaim", description: "Releases the province you're standing in.", notes: "Faction leader only. Cannot unclaim the capital." },
    { command: "/faction construct <fort|port|airport|train_station> <name>", description: "Builds an installation in the current province.", notes: "Faction leader only. Province must be owned and non-water; one build at a time. The build starts immediately. There is no confirmation screen." },
    { command: "/faction deconstruct <id>", description: "Demolishes an installation.", notes: "Faction leader only." },
    { command: "/faction installation", description: "Opens the installations view.", notes: "Any faction member." },
    { command: "/faction vehicle transfer <installation id>", aliases: ["/faction transfervehicle <id>"], description: "Berths one of your vehicles at that installation.", notes: "Faction leader only; the vehicle's owner must be online and consent." },
    { command: "/faction vehicle maintenance pay", aliases: ["/faction maintenance"], description: "Arms a right-click to pay one day of vehicle upkeep from your pouch.", notes: "Faction leader only. An unpaid vehicle cannot be repaired." },
    { command: "/faction findvehicles <installation id>", description: "Lists berthed vehicles with coordinates.", notes: "Any faction member." },
    { command: "/faction setbanner", description: "Sets the faction banner from the banner you're holding.", notes: "Faction leader only." },
    { command: "/faction setcolour <R,G,B>", description: "Sets the faction's colour on the web map.", notes: "Faction leader only. 0-255 per channel." },
    { command: "/faction setrulertitle <title>", description: "Sets your ruler's title (e.g. \"King\").", notes: "Faction leader only." },
    { command: "/faction setrulingsystem <system>", description: "Sets the ruling-system label.", notes: "Faction leader only." },
    { command: "/faction setculture <culture>", description: "Sets the culture label.", notes: "Faction leader only." },
    { command: "/faction setreligion <religion>", description: "Sets the religion label.", notes: "Faction leader only." },
    { command: "/faction setbank", description: "Sets or moves the faction's bank chunk.", notes: "Faction leader only." },
    { command: "/faction deposit <amount>", description: "Deposits denars from your pouch into the faction bank.", notes: "Any member, while standing in the bank chunk." },
    { command: "/faction withdraw <amount>", description: "Withdraws denars from the faction bank into your pouch.", notes: "Faction leader only, while standing in the bank chunk." },
    { command: "/guild", aliases: ["/guild menu"], description: "Opens the guild hub GUI." },
    { command: "/guild list", description: "Lists guilds." },
    { command: "/guild create <name>", description: "Creates a sub-guild inside your faction.", notes: "Must be in a faction, not already in a guild, and not the faction leader." },
    { command: "/guild delete", description: "Disbands your guild.", notes: "Guild leader only; not the base guild. Blocked if bankrupt, has a positive balance, or active loans." },
    { command: "/guild invite <player>", description: "Invites a player to the guild.", notes: "Guild leader only. Base guild uses /faction invite instead; outsiders blocked under Closed Borders." },
    { command: "/guild join <name>", description: "Joins a guild that invited you.", notes: "You cannot already be a guild leader." },
    { command: "/guild leave", description: "Leaves your guild.", notes: "The leader must /guild delete instead." },
    { command: "/guild setleader <player>", description: "Hands the guild to another member.", notes: "Guild leader only." },
    { command: "/guild rename <name>", description: "Renames the guild.", notes: "Guild leader only." },
    { command: "/guild setcapital", description: "Sets the guild's trade capital to your current province.", notes: "Guild leader only." },
    { command: "/guild setbanner", description: "Sets the guild banner from the banner you're holding.", notes: "Guild leader only; not the base guild." },
    { command: "/guild setbank", description: "Sets or moves the guild's bank chunk.", notes: "Guild or faction leader." },
    { command: "/guild deposit <amount>", description: "Deposits denars into the guild bank.", notes: "Any guild member, while in the guild bank chunk." },
    { command: "/guild withdraw <amount>", description: "Withdraws denars from the guild bank.", notes: "Guild leader only, while in the guild bank chunk." },
    { command: "/ledger", description: "Opens your personal daily cashflow: wages, dividends, and taxes." },
    { command: "/war list", description: "Lists active wars.", notes: "The only non-admin /war branch." },
    { command: "/battle list", description: "Lists scheduled battles." },
    { command: "/battle join <battleId>", description: "Joins a battle you're eligible for." },
    { command: "/raid join", description: "Joins a campaign raid during its 60-second muster window." },
    { command: "/warband create <name>", description: "Creates a warband (squad) for battles." },
    { command: "/warband delete", description: "Disbands your warband.", notes: "Warband leader only." },
    { command: "/warband invite <player>", description: "Invites a player to the warband.", notes: "Warband leader only." },
    { command: "/warband kick <player>", description: "Removes a member.", notes: "Warband leader only." },
    { command: "/warband setleader <player>", description: "Transfers warband leadership.", notes: "Warband leader only." },
    { command: "/warband toggleopen", description: "Toggles open joining vs. invite-only.", notes: "Warband leader only." },
    { command: "/warband list", description: "Lists warbands." },
    { command: "/warband leave", description: "Leaves your warband." },
    { command: "/warband retreat", description: "Retreats the warband from a live battle.", notes: "Warband leader only, and only after the first 1,200 seconds (20 minutes)." },
    { command: "/company found <name>", description: "Buys a mercenary company charter.", notes: "You must be in a guild." },
    { command: "/company invite <player>", description: "Offers a company slot.", notes: "Company leader only." },
    { command: "/company accept", aliases: ["/company decline"], description: "Signs on to, or turns down, a company offer.", notes: "You must have a pending offer." },
    { command: "/company kick <player>", description: "Dismisses a mercenary.", notes: "Company leader only." },
    { command: "/company expand", description: "Queues another company slot.", notes: "Company leader only; not while an unfilled slot already exists." },
    { command: "/company draft", description: "Writes a contract book you fill in and sign.", notes: "Company leader only." },
    { command: "/company offer <faction>", description: "Sends the reviewed contract to a faction.", notes: "Company leader only; you must be holding the reviewed book." },
    { command: "/company contracts", description: "Opens the contract ledger.", notes: "Any company member." },
    { command: "/mercenaries", description: "Opens the mercenary market GUI." },
    { command: "/mercenaries list", description: "Lists mercenary companies in chat, best reputation first." },
    { command: "/mercenaries hire <company>", description: "Checks whether you may sign a company here.", notes: "Faction leader in practice." },
  ],
  excludedStaffCommands: [
    "/faction dummify", "/faction dummyLeader", "/faction forcedelete", "/faction forcejoin",
    "/faction forceleader", "/faction forcewithdraw", "/faction forceconstruct", "/faction forceregiment",
    "/faction addprestigemodifier", "/faction addwealthmodifier", "/faction refresh", "/faction delbank",
    "/faction startelection", "/faction endelection", "/faction getglobalwealth", "/faction queueallnations",
    "/faction fullregen", "/faction reloadtitles", "/faction reloadconfigs", "/faction destroytitle",
    "/faction granttitle", "/faction usurp", "/faction transfersubject", "/faction setrelation",
    "/faction settreaty", "/faction setpower", "/faction setlaw", "/faction setstance", "/faction provincecap",
    "/battle create|edit|delete|addside|addpoint|setlives|setspawn|setjail|...",
    "/war admin (entire tree)", "/movement admin (entire tree)", "/company admin give|take",
  ],
};

export const factionsSection: WikiSection = {
  nav: {
    href: "/wiki/factions",
    label: "Factions",
    category: "social",
    blurb: "Found a faction, claim provinces, run a government, and fight scheduled wars over land.",
  },
  commands: factionsCommands,
};
