"""Creation rules a web create must pass, matching RPCharacters' CreationRules.

RPCharacters re-checks every create before applying it; checking here first lets
the wizard report the problem instead of the plugin rejecting the create later.
"""

from __future__ import annotations

import unicodedata
from typing import Any, Iterable

NAME_PUNCTUATION = frozenset(" .'-")


def is_character_name(name: str) -> bool:
    """A letter in any alphabet, then letters, marks, spaces, apostrophes, hyphens or full stops."""
    if not name or not unicodedata.category(name[0]).startswith("L"):
        return False
    return all(
        ch in NAME_PUNCTUATION or unicodedata.category(ch)[0] in "LM" for ch in name[1:]
    )


def dependency_met(
    dependency: Any,
    trait_ids: Iterable[str],
    race_id: str,
    *,
    ignore_id: str | None = None,
) -> bool:
    """RPCharacters Dependency.check: trait modes over picked ids, or the race."""
    if not isinstance(dependency, dict):
        return True
    wanted = [str(d).strip().lower() for d in dependency.get("depends_on") or []]
    kind = str(dependency.get("type") or "").strip().lower()
    if kind == "race":
        return race_id.strip().lower() in wanted
    if kind != "trait":
        return False
    have = {str(t).strip().lower() for t in trait_ids} - {(ignore_id or "").lower()}
    mode = str(dependency.get("mode") or "").strip().lower()
    if mode == "all":
        return all(w in have for w in wanted)
    if mode == "one-or-more":
        return any(w in have for w in wanted)
    return False


def passes_account_age_gate(stage: dict[str, Any], account_age_seconds: int) -> bool:
    """Stage.passesAccountAgeGate: inclusive minimum, exclusive maximum."""
    low = stage.get("require_account_age_hours_min")
    high = stage.get("require_account_age_hours_max")
    if low is not None and account_age_seconds < int(low) * 3600:
        return False
    if high is not None and account_age_seconds >= int(high) * 3600:
        return False
    return True


def _key(trait: dict[str, Any]) -> str:
    return str(trait.get("key") or "").strip().lower()


def _exclusives(trait: dict[str, Any]) -> set[str]:
    return {str(e).strip().lower() for e in trait.get("mutually_exclusive") or []}


def traits_error(
    catalog: dict[str, Any],
    picked_ids: list[str],
    attribute_ids: list[str],
    race_id: str,
    account_age_seconds: int,
) -> str | None:
    """Trait picks as the in-game selection screens allow them, or the first problem.

    ``picked_ids`` are the player's trait picks (prosthetic-replaced injuries already
    removed); ``attribute_ids`` are the rank traits built from the attribute sheet.
    """
    traits = {
        str(t.get("id") or "").strip().lower(): t
        for t in catalog.get("traits") or []
        if isinstance(t, dict) and t.get("id")
    }
    picked = [traits[t.strip().lower()] for t in picked_ids]
    everything = [*picked, *(traits[t.strip().lower()] for t in attribute_ids)]
    all_ids = [str(t["id"]).strip().lower() for t in everything]

    stage_keys: set[str] = set()
    for stage in catalog.get("stages") or []:
        if not isinstance(stage, dict) or str(stage.get("platform") or "both").lower() == "game":
            continue
        if str(stage.get("type") or "").lower() != "selection":
            continue
        if str(stage.get("target") or "").lower() != "trait":
            continue
        key = str(stage.get("key") or "").strip().lower()
        stage_keys.add(key)
        in_stage = [t for t in picked if _key(t) == key]
        opens = dependency_met(stage.get("dependency"), all_ids, race_id) and passes_account_age_gate(
            stage, account_age_seconds
        )
        if not opens:
            if in_stage:
                return f"{in_stage[0]['id']} is not available to this character"
            continue
        if str(stage.get("filter") or "").lower() == "permanent-only":
            for t in in_stage:
                if t.get("has_duration"):
                    return f"{t['id']} cannot be picked at creation"
        low = int(stage.get("min_select") or 0)
        high = int(stage.get("max_select") or 99)
        if not low <= len(in_stage) <= high:
            return f"pick {low} to {high} {key} traits"
        budget = stage.get("points")
        spent = sum(int(t.get("cost") or 0) for t in in_stage)
        if budget is not None and int(budget) > 0 and spent > int(budget):
            return f"your {key} traits cost more than {int(budget)} points"

    for t in picked:
        if _key(t) not in stage_keys:
            return f"{t['id']} cannot be picked at creation"

    for t in everything:
        tid = str(t["id"]).strip().lower()
        for other in everything:
            oid = str(other["id"]).strip().lower()
            if oid != tid and (oid in _exclusives(t) or tid in _exclusives(other)):
                return f"{t['id']} cannot be combined with {other['id']}"
        dependency = t.get("dependency")
        if dependency and not dependency_met(dependency, all_ids, race_id, ignore_id=tid):
            joiner = " and " if str(dependency.get("mode") or "").lower() == "all" else " or "
            return f"{t['id']} needs {joiner.join(dependency.get('depends_on') or [])}"
        hours = t.get("required_account_playtime_hours")
        if hours and account_age_seconds < int(hours) * 3600:
            return f"{t['id']} needs an account at least {int(hours)} hours old"
    return None
