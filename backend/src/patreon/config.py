from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

import yaml


@dataclass(frozen=True)
class Tier:
    key: str
    rank: int
    patreon_id: str
    patreon_title: str
    display_name: str


def load_tiers() -> tuple[Tier, ...]:
    rows = yaml.safe_load(Path(__file__).with_name("tiers.yaml").read_text())["tiers"]
    tiers = tuple(sorted((Tier(**r) for r in rows), key=lambda t: t.rank))
    for attr in ("key", "rank", "patreon_id", "patreon_title"):
        if len({getattr(t, attr) for t in tiers}) != len(tiers):
            raise ValueError("duplicate_patreon_tier_mapping")
    return tiers


@dataclass(frozen=True)
class Config:
    enabled: bool = False
    apply: bool = False
    api_base: str = "https://www.patreon.com"
    campaign_id: str | None = None
    sync_interval: int = 600
    grace_days: int = 7
    cooldown_days: int = 30
    removal_fraction: float = .25
    suppress_dms: bool = False
    tiers: tuple[Tier, ...] = field(default_factory=load_tiers)

    def rank(self, key: str | None) -> int:
        return next((t.rank for t in self.tiers if t.key == key), 0)

    def name(self, key: str | None) -> str | None:
        return next((t.display_name for t in self.tiers if t.key == key), None)

    @classmethod
    def from_env(cls) -> Config:
        c = cls(
            enabled=os.getenv("PATREON_ENABLED", "0").strip() == "1",
            apply=os.getenv("PATREON_APPLY", "0").strip() == "1",
            api_base=os.getenv("PATREON_API_BASE", "https://www.patreon.com").rstrip("/"),
            campaign_id=os.getenv("PATREON_CAMPAIGN_ID") or None,
            sync_interval=int(os.getenv("PATREON_SYNC_INTERVAL_SECONDS", "600")),
            grace_days=int(os.getenv("PATREON_DECLINED_GRACE_DAYS", "7")),
            cooldown_days=int(os.getenv("PATREON_RELINK_COOLDOWN_DAYS", "30")),
            removal_fraction=float(os.getenv("PATREON_MASS_REMOVAL_FRACTION", ".25")),
            suppress_dms=os.getenv("PATREON_SUPPRESS_DMS", "0").strip() == "1",
        )
        if c.sync_interval < 1 or c.grace_days < 0 or c.cooldown_days < 0 or not 0 <= c.removal_fraction <= 1:
            raise ValueError("invalid_patreon_config")
        return c
