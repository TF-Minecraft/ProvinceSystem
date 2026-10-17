"""Discord case logs and precedent lookup for ProvinceSystem."""

from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Any, Optional
from uuid import UUID

import aiohttp
import discord
import yaml
from redbot.core import app_commands, commands
from redbot.core.bot import Red

logger = logging.getLogger("red.precedent")

_DEFAULT_STAFF_ROLE = 1045375274528821318
_DEFAULT_HELPER_ROLE = 1129040846373781514
_CONFIG_PATH = Path(__file__).resolve().parent / "config.yml"
_MATCH_DISPLAY_CAP = 3


def _api_detail(text: str, data: Optional[Any]) -> str:
    if isinstance(data, dict) and data.get("detail") is not None:
        detail = data["detail"]
        return detail if isinstance(detail, str) else str(detail)
    return (text or "Unknown error")[:300]


def _read_yaml_config() -> dict[str, Any]:
    if not _CONFIG_PATH.is_file():
        logger.warning("Precedent config.yml not found at %s", _CONFIG_PATH)
        return {}
    try:
        with _CONFIG_PATH.open(encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
    except Exception:
        logger.exception("Failed to read precedent config.yml")
        return {}
    if not isinstance(data, dict):
        logger.warning("precedent config.yml root must be a mapping")
        return {}
    return data


def _env_or_yaml_str(env_key: str, yaml_val: Any, default: str = "") -> str:
    env = (os.getenv(env_key) or "").strip()
    if env:
        return env
    if yaml_val is None:
        return default
    return str(yaml_val).strip()


def _env_or_yaml_int(env_key: str, yaml_val: Any, default: int) -> int:
    env = (os.getenv(env_key) or "").strip()
    if env:
        try:
            return int(env)
        except ValueError:
            logger.warning("Invalid int for env %s=%r; using yaml/default", env_key, env)
    if yaml_val is None or yaml_val == "":
        return default
    try:
        return int(yaml_val)
    except (TypeError, ValueError):
        return default


class CaseLogModal(discord.ui.Modal, title="Log a precedent case"):
    players = discord.ui.TextInput(
        label="Players involved",
        required=True,
        max_length=200,
        placeholder="PlayerOne, PlayerTwo",
    )
    summary = discord.ui.TextInput(
        label="Summary / evidence",
        style=discord.TextStyle.paragraph,
        required=True,
        max_length=1000,
        placeholder="What happened, with links to evidence if any",
    )
    rule = discord.ui.TextInput(
        label="Rule broken",
        required=True,
        max_length=200,
    )
    ruling = discord.ui.TextInput(
        label="Ruling",
        style=discord.TextStyle.paragraph,
        required=True,
        max_length=500,
        placeholder="What was decided and why",
    )
    punishment = discord.ui.TextInput(
        label="Punishment",
        required=True,
        max_length=200,
        placeholder="e.g. 3-day ban, warning, none",
    )

    def __init__(self, cog: "Precedent", user: Optional[discord.User] = None):
        super().__init__()
        self.cog = cog
        self.selected_user = user
        if user is not None:
            self.remove_item(self.players)
            self.title = f"Case: {user.display_name}"[:45]
            # Leave room for the verified identifiers in the stored ruling.
            self.ruling.max_length = 300

    async def on_submit(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        if not self.cog.member_is_staff(interaction):
            await interaction.followup.send("You need the Staff role to log a case.", ephemeral=True)
            return
        ruling = str(self.ruling.value).strip()
        if self.selected_user is not None:
            try:
                identity = await self.cog.linked_identity(self.selected_user)
            except ValueError as error:
                await interaction.followup.send(str(error), ephemeral=True)
                return
            name = identity.get("minecraft_name") or identity["player_uuid"]
            players = [name]
            ruling += f"\n\nLinked account: {name}\nMinecraft UUID: {identity['player_uuid']}\nDiscord ID: {self.selected_user.id}"
        else:
            players = [p.strip() for p in str(self.players.value).split(",") if p.strip()]
        status, text, data = await self.cog.api_post(
            "/precedent/staff/log",
            {
                "logged_by": getattr(interaction.user, "display_name", str(interaction.user)),
                "players": players,
                "summary": str(self.summary.value).strip(),
                "rule": str(self.rule.value).strip(),
                "ruling": ruling,
                "punishment": str(self.punishment.value).strip(),
            },
        )
        if status != 200:
            await interaction.followup.send(
                f"Could not log case: {_api_detail(text, data)}",
                ephemeral=True,
            )
            return
        case_id = data.get("id") if isinstance(data, dict) else None
        await interaction.followup.send(
            f"Case logged{f' (`{case_id}`)' if case_id else ''}.",
            ephemeral=True,
        )


class Precedent(commands.Cog):
    """Staff precedent lookup: /case-log records a case, /precedent searches similar ones."""

    def __init__(self, bot: Red):
        self.bot = bot
        self.apply_settings(self.load_settings())

    def load_settings(self) -> dict[str, Any]:
        raw = _read_yaml_config()
        api_base = _env_or_yaml_str("API_BASE_URL", raw.get("api_base_url")).rstrip("/")
        staff_key = _env_or_yaml_str("STAFF_KEY", raw.get("staff_key"))
        staff_role = _env_or_yaml_int(
            "STAFF_ROLE_ID", raw.get("staff_role_id"), _DEFAULT_STAFF_ROLE
        )
        helper_role = _env_or_yaml_int(
            "HELPER_ROLE_ID", raw.get("helper_role_id"), _DEFAULT_HELPER_ROLE
        )
        return {
            "api_base_url": api_base,
            "staff_key": staff_key,
            "staff_role_id": staff_role,
            "helper_role_id": helper_role,
        }

    def apply_settings(self, settings: dict[str, Any]) -> None:
        self.api_base_url = settings["api_base_url"]
        self.staff_key = settings["staff_key"]
        self.staff_role_id = int(settings["staff_role_id"])
        self.helper_role_id = int(settings["helper_role_id"])

    async def cog_load(self):
        self.apply_settings(self.load_settings())
        logger.info(
            "Precedent cog loaded (api=%s)", self.api_base_url or "(unset)"
        )

    def member_is_staff(self, interaction: discord.Interaction) -> bool:
        if not interaction.guild:
            return False
        role = interaction.guild.get_role(self.staff_role_id)
        return role is not None and role in interaction.user.roles

    def member_is_staff_or_helper(self, interaction: discord.Interaction) -> bool:
        if not interaction.guild:
            return False
        staff_role = interaction.guild.get_role(self.staff_role_id)
        helper_role = interaction.guild.get_role(self.helper_role_id)
        return (staff_role is not None and staff_role in interaction.user.roles) or (
            helper_role is not None and helper_role in interaction.user.roles
        )

    def staff_headers(self) -> dict[str, str]:
        return {"X-Staff-Key": self.staff_key}

    def _require_api_config(self) -> Optional[str]:
        if not self.api_base_url:
            return (
                "api_base_url is not set. Edit precedent/config.yml "
                "(see config.example.yml)."
            )
        if not self.staff_key:
            return (
                "staff_key is not set. Edit precedent/config.yml "
                "(see config.example.yml)."
            )
        return None

    async def api_post(
        self, path: str, payload: Optional[dict] = None
    ) -> tuple[int, str, Optional[Any]]:
        """POST JSON to `{API_BASE_URL}{path}`. Returns status, text, parsed JSON (or None)."""
        if not self.api_base_url:
            raise RuntimeError("api_base_url is not set in config.yml")
        url = f"{self.api_base_url}{path}"
        headers = {**self.staff_headers(), "Content-Type": "application/json"}
        async with aiohttp.ClientSession() as session:
            async with session.post(url, headers=headers, json=payload or {}) as resp:
                text = await resp.text()
                data: Optional[Any] = None
                try:
                    data = json.loads(text) if text else None
                except json.JSONDecodeError:
                    data = None
                return resp.status, text, data

    async def linked_identity(self, user: discord.User) -> dict:
        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=8)) as session:
                async with session.get(
                    f"{self.api_base_url}/skins/discord/identity/{user.id}", headers=self.staff_headers()
                ) as response:
                    data = await response.json()
                    if response.status != 200 or not isinstance(data, dict) or data.get("discord_user_id") != str(user.id):
                        raise ValueError("Account lookup is unavailable. Try again shortly.")
        except (aiohttp.ClientError, asyncio.TimeoutError, ValueError):
            raise ValueError("Account lookup is unavailable. Try again shortly.") from None
        if data.get("linked") is False:
            raise ValueError("This Discord account has no Minecraft link. Link at https://tfminecraft.net/profile or use /linkdiscord in-game. Use /case-log without user to record unlinked players manually.")
        try:
            player_uuid = str(UUID(data["player_uuid"]))
        except (KeyError, ValueError, TypeError, AttributeError):
            raise ValueError("Account lookup returned an invalid identity. Ask staff to check the API.") from None
        if data.get("linked") is not True:
            raise ValueError("Account lookup returned an invalid identity. Ask staff to check the API.")
        return {**data, "player_uuid": player_uuid}

    # Empirical calibration from real precedent_cases embeddings: cosine distance
    # rarely exceeds ~0.65 even for unrelated cases (general-purpose text
    # embeddings compress everything into a narrow band). A flat (1-distance)
    # mapping left every real match stuck in the 30-60% range regardless of
    # how strong it actually was. This clamps and curves so a solid topical
    # match reads clearly high instead of looking like a coin flip.
    #
    # The clamp matches the backend's relevance cutoff (db.py
    # _MAX_RELEVANT_DISTANCE) exactly - anything the API returns already has
    # distance < 0.60, so this maps that whole achievable window onto the
    # full 0-100% range: a match right at the cutoff edge reads near 0%
    # (red), an exact match reads 100% (green).
    _DIST_CLAMP = 0.60
    _CURVE_EXP = 0.3

    @staticmethod
    def _similarity_pct(distance: Any) -> Optional[int]:
        if not isinstance(distance, (int, float)):
            return None
        d = max(0.0, min(Precedent._DIST_CLAMP, distance))
        frac = 1 - d / Precedent._DIST_CLAMP
        pct = 100 * (frac ** Precedent._CURVE_EXP)
        return max(0, min(100, round(pct)))

    @staticmethod
    def _gradient_color(pct: int) -> discord.Color:
        """Linear red (0%) to green (100%) gradient."""
        red_rgb = (224, 60, 60)
        green_rgb = (60, 190, 90)
        t = max(0, min(100, pct)) / 100
        r = round(red_rgb[0] + (green_rgb[0] - red_rgb[0]) * t)
        g = round(red_rgb[1] + (green_rgb[1] - red_rgb[1]) * t)
        b = round(red_rgb[2] + (green_rgb[2] - red_rgb[2]) * t)
        return discord.Color.from_rgb(r, g, b)

    def build_precedent_embed(self, query: str, data: dict) -> discord.Embed:
        matches = data.get("matches") or []
        synthesis = str(data.get("synthesis") or "").strip()

        best_pct = self._similarity_pct(matches[0].get("distance")) if matches else None
        embed = discord.Embed(
            title="Precedent search",
            description=query[:2000],
            color=self._gradient_color(best_pct) if best_pct is not None else discord.Color.greyple(),
            timestamp=discord.utils.utcnow(),
        )
        if synthesis:
            embed.add_field(name="Synthesis", value=synthesis[:1024], inline=False)
        if not matches:
            embed.add_field(name="Similar cases", value="None found.", inline=False)
        for i, m in enumerate(matches[:_MATCH_DISPLAY_CAP]):
            players = ", ".join(m.get("players") or []) or "None"
            pct = self._similarity_pct(m.get("distance"))
            pct_line = f"Similarity: {pct}%\n" if pct is not None else ""
            value = (
                f"{pct_line}"
                f"Players: {players}\n"
                f"Rule: {m.get('rule') or 'None'}\n"
                f"Ruling: {m.get('ruling') or 'None'}\n"
                f"Punishment: {m.get('punishment') or 'None'}"
            )
            embed.add_field(
                name=f"Case {i + 1}: {m.get('summary', '')[:100] or 'None'}",
                value=value[:1024],
                inline=False,
            )
        embed.set_footer(
            text=(
                "Advisory only, staff make the final ruling. "
                "Similarity scale: 0% (red, unrelated) to 100% (green, identical)."
            )
        )
        return embed

    async def _send_command_error(
        self, interaction: discord.Interaction, error: app_commands.AppCommandError
    ):
        logger.error("precedent command error: %s", error, exc_info=True)
        msg = "An unexpected error occurred."
        if isinstance(error, app_commands.CheckFailure):
            msg = "You need the Staff or Helper role to use this command!"
        elif isinstance(error, app_commands.CommandInvokeError):
            msg = f"An error occurred: {error.original}"
        if interaction.response.is_done():
            await interaction.followup.send(msg, ephemeral=True)
        else:
            await interaction.response.send_message(msg, ephemeral=True)

    @app_commands.command(
        name="case-log",
        description="Log a moderation case for future precedent search (Staff only).",
    )
    @app_commands.describe(user="Select a Discord user to resolve their Minecraft account automatically")
    @app_commands.check(lambda i: i.client.get_cog("Precedent").member_is_staff(i))
    @app_commands.guild_only()
    async def case_log(self, interaction: discord.Interaction, user: Optional[discord.User] = None):
        cfg_err = self._require_api_config()
        if cfg_err:
            await interaction.response.send_message(cfg_err, ephemeral=True)
            return
        await interaction.response.send_modal(CaseLogModal(self, user))

    @app_commands.command(
        name="precedent",
        description="Search past cases for precedent similar to the given case.",
    )
    @app_commands.describe(case_info="Describe the new case (players, rule, context)")
    @app_commands.check(lambda i: i.client.get_cog("Precedent").member_is_staff_or_helper(i))
    @app_commands.guild_only()
    async def precedent_cmd(self, interaction: discord.Interaction, case_info: str):
        await interaction.response.defer()

        cfg_err = self._require_api_config()
        if cfg_err:
            await interaction.followup.send(cfg_err, ephemeral=True)
            return

        query = (case_info or "").strip()
        if not query:
            await interaction.followup.send("case_info is required.", ephemeral=True)
            return

        status, text, data = await self.api_post(
            "/precedent/staff/search", {"query": query}
        )
        if status != 200:
            await interaction.followup.send(
                f"Precedent search failed: {_api_detail(text, data)}",
                ephemeral=True,
            )
            return
        if not isinstance(data, dict):
            await interaction.followup.send("Precedent search: bad response.", ephemeral=True)
            return

        await interaction.followup.send(embed=self.build_precedent_embed(query, data))

    @app_commands.command(
        name="precedent-ping",
        description="Check ProvinceSystem API connectivity for precedent lookup.",
    )
    @app_commands.check(lambda i: i.client.get_cog("Precedent").member_is_staff_or_helper(i))
    @app_commands.guild_only()
    async def precedent_ping(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)

        cfg_err = self._require_api_config()
        if cfg_err:
            await interaction.followup.send(cfg_err, ephemeral=True)
            return

        status, text, data = await self.api_post(
            "/precedent/staff/search", {"query": "connectivity check"}
        )
        if status == 401:
            await interaction.followup.send(
                "HTTP 401, invalid or missing STAFF_KEY.", ephemeral=True
            )
            return
        if status != 200:
            await interaction.followup.send(
                f"API error HTTP {status}: {_api_detail(text, data)}",
                ephemeral=True,
            )
            return
        await interaction.followup.send(
            f"OK, HTTP 200 from `{self.api_base_url}/precedent/staff/search`.",
            ephemeral=True,
        )

    @case_log.error
    async def case_log_error(
        self, interaction: discord.Interaction, error: app_commands.AppCommandError
    ):
        await self._send_command_error(interaction, error)

    @precedent_cmd.error
    async def precedent_cmd_error(
        self, interaction: discord.Interaction, error: app_commands.AppCommandError
    ):
        await self._send_command_error(interaction, error)

    @precedent_ping.error
    async def precedent_ping_error(
        self, interaction: discord.Interaction, error: app_commands.AppCommandError
    ):
        await self._send_command_error(interaction, error)
