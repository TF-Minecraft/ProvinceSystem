import { adminRequest } from "../admin/api";
import type { CaseParticipant, PrecedentCase } from "./api";

export type CasePerson = {
  player_uuid: string | null;
  discord_user_id: string | null;
  minecraft_name: string | null;
  discord_username: string | null;
  name: string;
  legacy_names_complete: boolean;
};

export type PersonCaseRecord = Omit<PrecedentCase, "logged_by"> & {
  case_id: string | null;
  kind: "case" | "warning" | "warn" | "ban" | "unban";
  logged_by: string | null;
  matched_by: "account" | "name";
};

export type PersonCasePage = {
  person: CasePerson;
  entries: PersonCaseRecord[];
  total: number;
  limit: number;
  offset: number;
};

export type CaseSubject = { playerUuid: string; discordId?: never } | { discordId: string; playerUuid?: never };

export function getPersonCases(subject: CaseSubject, offset = 0): Promise<PersonCasePage> {
  const path = subject.playerUuid
    ? `/admin/players/${encodeURIComponent(subject.playerUuid)}/cases`
    : `/admin/discord/${encodeURIComponent(subject.discordId!)}/cases`;
  return adminRequest(`${path}?limit=25&offset=${offset}`);
}

export function caseParticipant(person: CasePerson): CaseParticipant {
  return {
    name: person.name,
    discord_user_id: person.discord_user_id,
    player_uuid: person.player_uuid,
    discord_username: person.discord_username,
  };
}
