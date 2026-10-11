import { buildNationColorLut, type NationColorLut, type NationOwnership } from "./chroniclePaint";

/**
 * Trade-league territory for one stored day, from the captured `trade.json`.
 *
 * The file is structurally a nation file — `{ name, rgb, tier, size,
 * provinces, subjects, overlord, banner }` keyed by league — which is why there
 * is no parser here: `buildNationColorLut` already reads exactly that shape,
 * with the same clamping and the same "unparseable rgb paints nothing" rule.
 * Duplicating it for leagues would be a second place for the province-id
 * ceiling to drift.
 *
 * Only the alpha differs, and that is the entire point of this module.
 */

/**
 * How opaque league territory is over the fill beneath it.
 *
 * A league is not an alternative owner of a province; it is a second claim on
 * ground a nation already holds, and both facts have to be on screen at once.
 * Painted opaque, the league would replace the nation's colour wherever the two
 * overlap — the nation fill would appear to lose land on the day a league was
 * founded, which is a lie about the map. At this alpha the nation's colour
 * still reads through the league's, and on ground no nation holds the league
 * shows against bare parchment.
 */
export const CHRONICLE_TRADE_LEAGUE_ALPHA = 140;

/**
 * League id -> packed colour, ready to stack over the nation fill.
 *
 * Null in, empty LUT out: a day with no stored `trade` file is a day with no
 * leagues, which the fill stack then skips entirely.
 */
export function buildTradeLeagueColorLut(leagues: NationOwnership | null): NationColorLut {
  if (!leagues) return new Uint32Array(0);
  const lut = buildNationColorLut(leagues);
  // `buildNationColorLut` packs every painted province opaque. Rewriting the
  // alpha byte in place beats threading an alpha parameter through the shared
  // builder, which the nation fill and the border pass also call.
  for (let id = 0; id < lut.length; id++) {
    const packed = lut[id]!;
    if (packed === 0) continue;
    lut[id] = ((packed & 0xffffff00) | CHRONICLE_TRADE_LEAGUE_ALPHA) >>> 0;
  }
  return lut;
}
