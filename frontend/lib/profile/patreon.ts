/** A player's Patreon link, as the Account page shows it. */
export type PatreonStatus = {
  linked: boolean;
  method?: string | null;
  patreon_name?: string | null;
  tier_key?: string | null;
  tier_name?: string | null;
  patron_status?: string | null;
  is_gifted?: boolean;
  grace_until?: string | null;
  has_discord?: boolean;
  has_minecraft?: boolean;
};
