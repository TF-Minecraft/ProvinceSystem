/**
 * The parts the Account page drew last time, kept in a cookie so the loading outline
 * (drawn on the server too) matches the page that follows.
 */
export type AccountShape = {
  signedIn: boolean;
  /** Parts of the line under the name (activity, or the Discord handle); phones put each on its own line. */
  subline: 0 | 1 | 2;
  /** Rank or supporter chips under the name. */
  chips: boolean;
  /** The Profile count tiles. */
  tiles: boolean;
  /** Any tile carries a "waiting" note, which makes the row taller. */
  notes: boolean;
  /** Linked-account rows: Discord and Minecraft, plus Patreon when it is on. */
  rows: 2 | 3;
  /** The linked-accounts card's height in pixels, since its rows wrap differently by width and content. */
  cardHeight?: number;
};

export const ACCOUNT_SHAPE_COOKIE = "tfmc_account_shape";

export const DEFAULT_ACCOUNT_SHAPE: AccountShape = {
  signedIn: true,
  subline: 2,
  chips: true,
  tiles: true,
  notes: false,
  rows: 3,
};

const bit = (value: boolean) => (value ? "1" : "0");

/**
 * One digit per field in a fixed order, then the card height when known, such as `121103-361.5`:
 * signed in, subline parts, chips, tiles, notes, rows.
 */
export function encodeAccountShape(shape: AccountShape): string {
  const fields = `${bit(shape.signedIn)}${shape.subline}${bit(shape.chips)}${bit(shape.tiles)}${bit(shape.notes)}${shape.rows}`;
  return shape.cardHeight ? `${fields}-${Math.round(shape.cardHeight * 10) / 10}` : fields;
}

export function decodeAccountShape(value: string | null | undefined): AccountShape {
  const match = /^([01][012][01]{3}[23])(?:-(\d{1,4}(?:\.\d)?))?$/.exec(value || "");
  if (!match) return DEFAULT_ACCOUNT_SHAPE;
  const [signedIn, subline, chips, tiles, notes, rows] = [...match[1]].map(Number);
  const cardHeight = match[2] ? Number(match[2]) : 0;
  return {
    signedIn: signedIn === 1,
    subline: subline as AccountShape["subline"],
    chips: chips === 1,
    tiles: tiles === 1,
    notes: notes === 1,
    rows: rows as AccountShape["rows"],
    ...(cardHeight ? { cardHeight } : {}),
  };
}

export function rememberAccountShape(shape: AccountShape): void {
  if (typeof document === "undefined") return;
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${ACCOUNT_SHAPE_COOKIE}=${encodeAccountShape(shape)}; Path=/account; Max-Age=31536000; SameSite=Lax${secure}`;
}
