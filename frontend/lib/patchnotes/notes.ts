/** Player-facing patch note lines. Review fields never belong on this type. */

export type PublicBullet = {
  id: string;
  section: string;
  body: string;
  topic?: string;
  highlight?: boolean;
};

export type WeekNotes = {
  week: string;
  label: string;
  bullets: PublicBullet[];
};

export const SECTION_ORDER = ["new", "fixed", "adjusted", "technical"] as const;

export type SectionName = (typeof SECTION_ORDER)[number];

export const SECTION_LABELS: Record<SectionName, string> = {
  new: "New",
  fixed: "Fixed",
  adjusted: "Adjusted",
  technical: "Technical",
};

const WEEK_RE = /^(\d{4})-W(\d{2})$/;

export function isWeekKey(value: string): boolean {
  const match = WEEK_RE.exec(value);
  if (!match) return false;
  const week = Number(match[2]);
  return week >= 1 && week <= 53;
}

/** Monday of an ISO week, in UTC. */
export function isoWeekMonday(year: number, week: number): Date {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const isoWeekday = jan4.getUTCDay() || 7;
  const weekOneMonday = Date.UTC(year, 0, 4 - isoWeekday + 1);
  return new Date(weekOneMonday + (week - 1) * 7 * 24 * 60 * 60 * 1000);
}

export function weekLabel(week: string): string {
  const match = WEEK_RE.exec(week);
  if (!match) return week;
  const monday = isoWeekMonday(Number(match[1]), Number(match[2]));
  const formatted = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(monday);
  return `Week of ${formatted}`;
}

export function isSectionName(value: string): value is SectionName {
  return (SECTION_ORDER as readonly string[]).includes(value);
}

export function groupBullets(bullets: readonly PublicBullet[]): Record<SectionName, PublicBullet[]> {
  const groups: Record<SectionName, PublicBullet[]> = {
    new: [],
    fixed: [],
    adjusted: [],
    technical: [],
  };
  for (const bullet of bullets) {
    if (isSectionName(bullet.section)) {
      groups[bullet.section].push(bullet);
    }
  }
  return groups;
}

export const TOPIC_ORDER = [
  "classes",
  "combat",
  "magic",
  "crafting",
  "professions",
  "animals",
  "world",
  "town",
  "dungeons",
  "chat",
] as const;

export type TopicName = (typeof TOPIC_ORDER)[number];

export const TOPIC_LABELS: Record<TopicName, string> = {
  classes: "Classes",
  combat: "Combat and gear",
  magic: "Magic",
  crafting: "Crafting",
  professions: "Professions",
  animals: "Animals",
  world: "World and nodes",
  town: "Town",
  dungeons: "Dungeons",
  chat: "Chat and rules",
};

export const HIGHLIGHT_LIMIT = 6;

const TOPIC_PATTERNS: readonly { id: TopicName; pattern: RegExp }[] = [
  { id: "dungeons", pattern: /\bdungeons?\b/i },
  { id: "chat", pattern: /\b(chat|yell|rules?)\b/i },
  { id: "town", pattern: /\b(donations?|denars?|insurance|warehouse|granary|stable)\b/i },
  { id: "animals", pattern: /\b(breeding|animals?|genetic|genetics|friendship)\b/i },
  { id: "professions", pattern: /\bprofessions?\b/i },
  { id: "magic", pattern: /\b(runes?|magic|spells?|rituals?)\b/i },
  { id: "classes", pattern: /\b(classes?|mage|archer|musketeer|wildlands)\b/i },
  { id: "crafting", pattern: /\b(craft(?:ing|able)?|recipes?|stations?|grindstone|ingredients?|repair kits?|food)\b/i },
  { id: "combat", pattern: /\b(weapons?|armou?r|gear|damage|knives|knife)\b/i },
  { id: "world", pattern: /\b(nodes?|crops?|biomes?|mining|drops?)\b/i },
];

export function isTopicName(value: string): value is TopicName {
  return (TOPIC_ORDER as readonly string[]).includes(value);
}

export function topicFor(bullet: PublicBullet): TopicName | "other" {
  if (bullet.topic && isTopicName(bullet.topic)) return bullet.topic;
  for (const topic of TOPIC_PATTERNS) {
    if (topic.pattern.test(bullet.body)) return topic.id;
  }
  return "other";
}

export type NoteTopic = {
  id: string;
  label: string;
  bullets: PublicBullet[];
};

export type ArrangedNote = {
  highlights: PublicBullet[];
  topics: NoteTopic[];
  fixes: PublicBullet[];
  technical: PublicBullet[];
};

function summaryLines(bullets: readonly PublicBullet[]): PublicBullet[] {
  const visible = bullets.filter((bullet) => bullet.section !== "technical");
  const flagged = visible.filter((bullet) => bullet.highlight === true);
  if (flagged.length > 0) return flagged.slice(0, HIGHLIGHT_LIMIT);
  const changes = visible.filter((bullet) => bullet.section === "new" || bullet.section === "adjusted");
  if (changes.length > 0) return changes.slice(0, HIGHLIGHT_LIMIT);
  return visible.filter((bullet) => bullet.section === "fixed").slice(0, HIGHLIGHT_LIMIT);
}

/** Highlights, then one group per topic, then bug fixes. Technical stays separate. */
export function arrangeNote(bullets: readonly PublicBullet[]): ArrangedNote {
  const fixes = bullets.filter((bullet) => bullet.section === "fixed");
  const technical = bullets.filter((bullet) => bullet.section === "technical");
  const changes = bullets.filter((bullet) => bullet.section === "new" || bullet.section === "adjusted");
  const buckets = new Map<string, PublicBullet[]>();
  for (const bullet of changes) {
    const topic = topicFor(bullet);
    const list = buckets.get(topic) ?? [];
    list.push(bullet);
    buckets.set(topic, list);
  }
  const topics: NoteTopic[] = [];
  for (const id of TOPIC_ORDER) {
    const items = buckets.get(id);
    if (items && items.length > 0) topics.push({ id, label: TOPIC_LABELS[id], bullets: items });
  }
  const other = buckets.get("other");
  if (other && other.length > 0) topics.push({ id: "other", label: "Other", bullets: other });
  return { highlights: summaryLines(bullets), topics, fixes, technical };
}
