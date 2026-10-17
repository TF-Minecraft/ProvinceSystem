"""
MinecraftBan — ban/warn DMs + TFMCWeb moderation outbox (Red V3).

AMP / Red deploy:
  1. Copy `minecraftban/` into `cogs/CogManager/cogs/`.
  2. Copy `config.example.yml` → `config.yml` and fill api_base_url, staff_key,
     banned_role_id. Optional env vars override yaml if set.
  3. `[p]pipinstall PyYAML` once if needed, then `[p]load` / `[p]reload minecraftban`.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from pathlib import Path
from typing import Any, Optional

import aiohttp
import discord
import yaml
from redbot.core import Config, app_commands, commands
from redbot.core.bot import Red

logger = logging.getLogger("red.minecraftban")

_DEFAULT_LOG_CHANNEL = 1125882735454601227
_DEFAULT_STAFF_ROLE = 1045375274528821318
_DEFAULT_HELPER_ROLE = 1129040846373781514
_DEFAULT_POLL_SECONDS = 3
_MIN_POLL_SECONDS = 1
_MAX_POLL_SECONDS = 60
_CONFIG_PATH = Path(__file__).resolve().parent / "config.yml"


def _clamp_poll(value: int) -> int:
    return max(_MIN_POLL_SECONDS, min(_MAX_POLL_SECONDS, value))


def _read_yaml_config() -> dict[str, Any]:
    if not _CONFIG_PATH.is_file():
        logger.warning("MinecraftBan config.yml not found at %s", _CONFIG_PATH)
        return {}
    try:
        with _CONFIG_PATH.open(encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
    except Exception:
        logger.exception("Failed to read minecraftban config.yml")
        return {}
    if not isinstance(data, dict):
        logger.warning("minecraftban config.yml root must be a mapping")
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


class MinecraftBan(commands.Cog):
    """Notify users of Minecraft bans/warnings/notices via DM; auto-mirror from TFMCWeb outbox."""

    def __init__(self, bot: Red):
        self.bot = bot
        self.config = Config.get_conf(
            self, identifier=1234567890, force_registration=True
        )
        self._poll_task: Optional[asyncio.Task] = None
        self.apply_settings(self.load_settings())

    def load_settings(self) -> dict[str, Any]:
        """Read config.yml then apply non-empty env overrides."""
        raw = _read_yaml_config()
        poll = _env_or_yaml_int(
            "MODERATION_POLL_INTERVAL_SECONDS",
            raw.get("poll_interval_seconds"),
            _DEFAULT_POLL_SECONDS,
        )
        return {
            "api_base_url": _env_or_yaml_str(
                "API_BASE_URL", raw.get("api_base_url")
            ).rstrip("/"),
            "staff_key": _env_or_yaml_str("STAFF_KEY", raw.get("staff_key")),
            "log_channel_id": _env_or_yaml_int(
                "LOG_CHANNEL_ID", raw.get("log_channel_id"), _DEFAULT_LOG_CHANNEL
            ),
            "staff_role_id": _env_or_yaml_int(
                "STAFF_ROLE_ID", raw.get("staff_role_id"), _DEFAULT_STAFF_ROLE
            ),
            "helper_role_id": _env_or_yaml_int(
                "HELPER_ROLE_ID", raw.get("helper_role_id"), _DEFAULT_HELPER_ROLE
            ),
            "banned_role_id": _env_or_yaml_int(
                "BANNED_ROLE_ID", raw.get("banned_role_id"), 0
            ),
            "poll_interval": _clamp_poll(poll),
        }

    def apply_settings(self, settings: dict[str, Any]) -> None:
        self.api_base_url = settings["api_base_url"]
        self.staff_key = settings["staff_key"]
        self.log_channel_id = int(settings["log_channel_id"])
        self.staff_role_id = int(settings["staff_role_id"])
        self.helper_role_id = int(settings["helper_role_id"])
        self.banned_role_id = int(settings["banned_role_id"] or 0)
        self.poll_interval = int(settings["poll_interval"])

    def member_is_staff_or_helper(self, interaction: discord.Interaction) -> bool:
        if not interaction.guild:
            return False
        staff_role = interaction.guild.get_role(self.staff_role_id)
        helper_role = interaction.guild.get_role(self.helper_role_id)
        return (staff_role is not None and staff_role in interaction.user.roles) or (
            helper_role is not None and helper_role in interaction.user.roles
        )

    async def cog_load(self):
        self.apply_settings(self.load_settings())
        if not self.banned_role_id:
            logger.warning(
                "banned_role_id unset — ban/unban will not add/remove Discord role "
                "(set in config.yml or BANNED_ROLE_ID)"
            )
        if not self.api_base_url or not self.staff_key:
            logger.warning(
                "api_base_url / staff_key unset — moderation poller disabled "
                "(edit minecraftban/config.yml)"
            )
            return
        self._poll_task = asyncio.create_task(self._poll_loop())
        logger.info(
            "Moderation poller started (interval=%ss, api=%s, banned_role=%s)",
            self.poll_interval,
            self.api_base_url,
            self.banned_role_id or "(disabled)",
        )

    async def cog_unload(self):
        task = self._poll_task
        self._poll_task = None
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    async def _poll_loop(self) -> None:
        await self.bot.wait_until_ready()
        while True:
            try:
                await self._poll_once()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Moderation poll cycle failed")
            try:
                await asyncio.sleep(self.poll_interval)
            except asyncio.CancelledError:
                raise

    async def _api_get(self, path: str) -> tuple[int, Optional[Any]]:
        url = f"{self.api_base_url}{path}"
        headers = {"X-Staff-Key": self.staff_key, "Accept": "application/json"}
        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=headers) as resp:
                text = await resp.text()
                data = None
                try:
                    data = json.loads(text) if text else None
                except json.JSONDecodeError:
                    data = None
                return resp.status, data

    async def _api_post(self, path: str, payload: dict) -> tuple[int, Optional[Any]]:
        url = f"{self.api_base_url}{path}"
        headers = {
            "X-Staff-Key": self.staff_key,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        async with aiohttp.ClientSession() as session:
            async with session.post(url, headers=headers, json=payload) as resp:
                text = await resp.text()
                data = None
                try:
                    data = json.loads(text) if text else None
                except json.JSONDecodeError:
                    data = None
                return resp.status, data

    async def _poll_once(self) -> None:
        status, data = await self._api_get("/skins/moderation/notifications")
        if status != 200 or not isinstance(data, dict):
            if status not in (0, 200):
                logger.debug("Moderation poll HTTP %s", status)
            return
        notices = data.get("notifications")
        if not isinstance(notices, list) or not notices:
            return

        delivered: list[int] = []
        for notice in notices:
            if not isinstance(notice, dict):
                continue
            nid = notice.get("id")
            ntype = str(notice.get("type") or "")
            discord_id = str(notice.get("discord_user_id") or "").strip()
            payload = notice.get("payload") if isinstance(notice.get("payload"), dict) else {}
            if nid is None or not discord_id:
                continue
            try:
                ok = await self._deliver_notice(ntype, discord_id, payload)
            except Exception:
                logger.exception("Failed delivering moderation notice %s", nid)
                continue
            if ok:
                delivered.append(int(nid))

        if delivered:
            ack_status, _ = await self._api_post(
                "/skins/moderation/notifications/ack", {"ids": delivered}
            )
            if ack_status != 200:
                logger.warning("Moderation ack HTTP %s for ids=%s", ack_status, delivered)

    async def _deliver_notice(
        self, ntype: str, discord_user_id: str, payload: dict
    ) -> bool:
        try:
            user = await self.bot.fetch_user(int(discord_user_id))
        except (ValueError, discord.HTTPException) as e:
            logger.warning("Cannot fetch Discord user %s: %s", discord_user_id, e)
            return True  # ack to avoid stuck queue

        mc_name = str(payload.get("minecraft_name") or "—")
        reason = str(payload.get("reason") or "—")
        duration = str(payload.get("duration") or "Permanent")
        staff_name = str(payload.get("staff_name") or "In-game")

        guild = self._primary_guild()
        if ntype == "warn":
            dm_status = await self._send_warn_dm(user, mc_name, reason)
            await self._send_warn_log(guild, user, mc_name, reason, dm_status, staff_name)
            return True
        if ntype == "ban":
            dm_status = await self._send_ban_dm(user, mc_name, reason, duration)
            role_status = await self._set_banned_role(guild, user, add=True)
            await self._send_ban_log(
                guild, user, mc_name, reason, duration, dm_status, staff_name, role_status
            )
            return True
        if ntype == "unban":
            role_status = await self._set_banned_role(guild, user, add=False)
            await self._send_unban_log(guild, user, mc_name, staff_name, role_status)
            return True
        logger.debug("Ignoring unknown moderation type %s", ntype)
        return False

    def _primary_guild(self) -> Optional[discord.Guild]:
        if self.bot.guilds:
            return self.bot.guilds[0]
        return None

    async def _send_ban_dm(
        self, user: discord.User, username: str, reason: str, duration: str
    ) -> str:
        dm_embed = discord.Embed(
            title="TFMC Ban Notification",
            description="You have been banned from the Minecraft server.",
            color=discord.Color.red(),
            timestamp=discord.utils.utcnow(),
        )
        dm_embed.add_field(name="Minecraft Username", value=username, inline=False)
        dm_embed.add_field(name="Reason", value=reason, inline=False)
        dm_embed.add_field(name="Duration", value=duration, inline=False)
        dm_embed.set_footer(text="Open a ticket for more information.")
        try:
            await user.send(embed=dm_embed)
            return "DM sent successfully."
        except discord.Forbidden:
            return "Failed to send DM (user has DMs disabled or blocked the bot)."
        except Exception as e:
            return f"Failed to send DM: {e}"

    async def _send_warn_dm(
        self, user: discord.User, username: str, reason: str
    ) -> str:
        dm_embed = discord.Embed(
            title="TFMC Warning Notification",
            description="You have received a warning from the Minecraft server.",
            color=discord.Color.gold(),
            timestamp=discord.utils.utcnow(),
        )
        dm_embed.add_field(name="Minecraft Username", value=username, inline=False)
        dm_embed.add_field(name="Reason", value=reason, inline=False)
        dm_embed.set_footer(text="Open a ticket for more information.")
        try:
            await user.send(embed=dm_embed)
            return "DM sent successfully."
        except discord.Forbidden:
            return "Failed to send DM (user has DMs disabled or blocked the bot)."
        except Exception as e:
            return f"Failed to send DM: {e}"

    async def _send_notify_dm(self, user: discord.User, message: str) -> str:
        dm_embed = discord.Embed(
            title="Message from TFMC Staff",
            description=message,
            color=discord.Color.teal(),
            timestamp=discord.utils.utcnow(),
        )
        dm_embed.set_footer(text="This message was sent by the TFMC staff team.")
        try:
            await user.send(embed=dm_embed)
            return "DM sent successfully."
        except discord.Forbidden:
            return "Failed to send DM (user has DMs disabled or blocked the bot)."
        except Exception as e:
            return f"Failed to send DM: {e}"

    async def _set_banned_role(
        self, guild: Optional[discord.Guild], user: discord.User, *, add: bool
    ) -> str:
        if not self.banned_role_id:
            return "Banned role not configured."
        if guild is None:
            return "No guild available for role update."
        role = guild.get_role(self.banned_role_id)
        if role is None:
            return f"Banned role {self.banned_role_id} not found."
        member = guild.get_member(user.id)
        if member is None:
            try:
                member = await guild.fetch_member(user.id)
            except discord.HTTPException:
                return "Member not in guild; role unchanged."
        try:
            if add:
                if role not in member.roles:
                    await member.add_roles(role, reason="TFMC ban mirror")
                return "Banned role added."
            if role in member.roles:
                await member.remove_roles(role, reason="TFMC unban mirror")
            return "Banned role removed."
        except discord.Forbidden:
            return "Missing permission to modify Banned role."
        except Exception as e:
            return f"Role update failed: {e}"

    async def _send_ban_log(
        self,
        guild: Optional[discord.Guild],
        user: discord.User,
        username: str,
        reason: str,
        duration: str,
        dm_status: str,
        issuer: str,
        role_status: str,
    ) -> None:
        log_embed = discord.Embed(
            title="TFMC Ban Log",
            description="A ban notification was issued.",
            color=discord.Color.orange(),
            timestamp=discord.utils.utcnow(),
        )
        log_embed.add_field(name="Minecraft Username", value=username, inline=False)
        log_embed.add_field(name="Discord User", value=user.mention, inline=False)
        log_embed.add_field(name="Reason", value=reason, inline=False)
        log_embed.add_field(name="Duration", value=duration, inline=False)
        log_embed.add_field(name="DM Status", value=dm_status, inline=False)
        log_embed.add_field(name="Role", value=role_status, inline=False)
        log_embed.add_field(name="Issuer", value=issuer, inline=False)
        await self._post_log(guild, log_embed)

    async def _send_warn_log(
        self,
        guild: Optional[discord.Guild],
        user: discord.User,
        username: str,
        reason: str,
        dm_status: str,
        issuer: str,
    ) -> None:
        log_embed = discord.Embed(
            title="TFMC Warning Log",
            description="A warning notification was issued.",
            color=discord.Color.orange(),
            timestamp=discord.utils.utcnow(),
        )
        log_embed.add_field(name="Minecraft Username", value=username, inline=False)
        log_embed.add_field(name="Discord User", value=user.mention, inline=False)
        log_embed.add_field(name="Reason", value=reason, inline=False)
        log_embed.add_field(name="DM Status", value=dm_status, inline=False)
        log_embed.add_field(name="Issuer", value=issuer, inline=False)
        await self._post_log(guild, log_embed)

    async def _send_notify_log(
        self,
        guild: Optional[discord.Guild],
        user: discord.User,
        message: str,
        dm_status: str,
        issuer: str,
    ) -> None:
        log_embed = discord.Embed(
            title="TFMC Staff Notify Log",
            description="A staff notification was sent (anonymous to recipient).",
            color=discord.Color.orange(),
            timestamp=discord.utils.utcnow(),
        )
        log_embed.add_field(name="Discord User", value=user.mention, inline=False)
        log_embed.add_field(name="Message", value=message, inline=False)
        log_embed.add_field(name="DM Status", value=dm_status, inline=False)
        log_embed.add_field(name="Issuer", value=issuer, inline=False)
        await self._post_log(guild, log_embed)

    async def _send_unban_log(
        self,
        guild: Optional[discord.Guild],
        user: discord.User,
        username: str,
        issuer: str,
        role_status: str,
    ) -> None:
        log_embed = discord.Embed(
            title="TFMC Unban Log",
            description="An unban was mirrored from Minecraft.",
            color=discord.Color.green(),
            timestamp=discord.utils.utcnow(),
        )
        log_embed.add_field(name="Minecraft Username", value=username, inline=False)
        log_embed.add_field(name="Discord User", value=user.mention, inline=False)
        log_embed.add_field(name="Role", value=role_status, inline=False)
        log_embed.add_field(name="Issuer", value=issuer, inline=False)
        await self._post_log(guild, log_embed)

    async def _post_log(
        self, guild: Optional[discord.Guild], embed: discord.Embed
    ) -> None:
        channel = None
        if guild is not None:
            channel = guild.get_channel(self.log_channel_id)
        if channel is None:
            channel = self.bot.get_channel(self.log_channel_id)
        if channel is None:
            logger.warning("Log channel %s not found", self.log_channel_id)
            return
        try:
            await channel.send(embed=embed)
        except discord.HTTPException as e:
            logger.warning("Failed to post staff log: %s", e)

    _RULE_RE = re.compile(r"\((\d+\.\d+)\)")

    async def _log_precedent(
        self,
        *,
        logged_by: str,
        players: list[str],
        summary: str,
        ruling: str,
        punishment: str,
    ) -> None:
        """Best-effort mirror of a warn/notify into the precedent database. Never raises."""
        if not self.api_base_url or not self.staff_key:
            return
        rule_match = self._RULE_RE.search(summary)
        try:
            status, data = await self._api_post(
                "/precedent/staff/log",
                {
                    "logged_by": logged_by,
                    "players": players,
                    "summary": summary,
                    "rule": rule_match.group(1) if rule_match else "",
                    "ruling": ruling,
                    "punishment": punishment,
                },
            )
            if status != 200:
                logger.warning("Precedent log failed HTTP %s: %s", status, data)
        except Exception:
            logger.exception("Precedent log failed for players=%s", players)

    @staticmethod
    def has_staff_or_helper(interaction: discord.Interaction) -> bool:
        cog = interaction.client.get_cog("MinecraftBan")
        if cog is None or not isinstance(cog, MinecraftBan):
            return False
        return cog.member_is_staff_or_helper(interaction)

    @app_commands.command(
        name="minecraftban", description="Notify a user of a Minecraft server ban via DM."
    )
    @app_commands.describe(
        user="The Discord user to notify",
        username="The Minecraft username that was banned",
        reason="The reason for the ban",
        duration="The duration of the ban (e.g., '7 days', 'permanent')",
    )
    @app_commands.check(has_staff_or_helper)
    @app_commands.guild_only()
    @app_commands.checks.cooldown(1, 60)
    async def minecraftban(
        self,
        interaction: discord.Interaction,
        user: discord.User,
        username: str,
        reason: str,
        duration: str,
    ):
        try:
            preview_embed = discord.Embed(
                title="TFMC Ban Notification Preview",
                description="This is the message that will be sent to the user.",
                color=discord.Color.blue(),
                timestamp=discord.utils.utcnow(),
            )
            preview_embed.add_field(name="Minecraft Username", value=username, inline=False)
            preview_embed.add_field(name="Reason", value=reason, inline=False)
            preview_embed.add_field(name="Duration", value=duration, inline=False)
            preview_embed.set_footer(text="This preview is only visible to you.")
            await interaction.response.send_message(embed=preview_embed, ephemeral=True)

            dm_status = await self._send_ban_dm(user, username, reason, duration)
            role_status = await self._set_banned_role(
                interaction.guild, user, add=True
            )
            await self._send_ban_log(
                interaction.guild,
                user,
                username,
                reason,
                duration,
                dm_status,
                interaction.user.mention,
                role_status,
            )
        except Exception as e:
            logger.error("Error in /minecraftban: %s", e, exc_info=True)
            raise

    @app_commands.command(
        name="minecraftwarn",
        description="Notify a user of a Minecraft server warning via DM.",
    )
    @app_commands.describe(
        user="The Discord user to notify",
        username="The Minecraft username that was warned",
        reason="The reason for the warning",
    )
    @app_commands.check(has_staff_or_helper)
    @app_commands.guild_only()
    @app_commands.checks.cooldown(1, 60)
    async def minecraftwarn(
        self,
        interaction: discord.Interaction,
        user: discord.User,
        username: str,
        reason: str,
    ):
        try:
            preview_embed = discord.Embed(
                title="Minecraft Warning Notification Preview",
                description="This is the message that will be sent to the user.",
                color=discord.Color.blue(),
                timestamp=discord.utils.utcnow(),
            )
            preview_embed.add_field(name="Minecraft Username", value=username, inline=False)
            preview_embed.add_field(name="Reason", value=reason, inline=False)
            preview_embed.set_footer(text="This preview is only visible to you.")
            await interaction.response.send_message(embed=preview_embed, ephemeral=True)

            dm_status = await self._send_warn_dm(user, username, reason)
            await self._send_warn_log(
                interaction.guild,
                user,
                username,
                reason,
                dm_status,
                interaction.user.mention,
            )
            await self._log_precedent(
                logged_by=getattr(interaction.user, "display_name", str(interaction.user)),
                players=[username],
                summary=reason,
                ruling="Warning issued via Discord",
                punishment="Warning",
            )
        except Exception as e:
            logger.error("Error in /minecraftwarn: %s", e, exc_info=True)
            raise

    @app_commands.command(
        name="minecraftnotify",
        description="Send an anonymous staff-team DM (not a warning).",
    )
    @app_commands.describe(
        user="The Discord user to notify",
        message="The message to send (shown anonymously as TFMC Staff)",
    )
    @app_commands.check(has_staff_or_helper)
    @app_commands.guild_only()
    @app_commands.checks.cooldown(1, 60)
    async def minecraftnotify(
        self,
        interaction: discord.Interaction,
        user: discord.User,
        message: str,
    ):
        try:
            preview_embed = discord.Embed(
                title="TFMC Staff Message Preview",
                description="This is the message that will be sent to the user.",
                color=discord.Color.blue(),
                timestamp=discord.utils.utcnow(),
            )
            preview_embed.add_field(name="Message", value=message, inline=False)
            preview_embed.set_footer(text="This preview is only visible to you.")
            await interaction.response.send_message(embed=preview_embed, ephemeral=True)

            dm_status = await self._send_notify_dm(user, message)
            await self._send_notify_log(
                interaction.guild,
                user,
                message,
                dm_status,
                interaction.user.mention,
            )
            await self._log_precedent(
                logged_by=getattr(interaction.user, "display_name", str(interaction.user)),
                players=[getattr(user, "display_name", str(user))],
                summary=message,
                ruling="Anonymous staff notice sent via Discord",
                punishment="None (notice only)",
            )
        except Exception as e:
            logger.error("Error in /minecraftnotify: %s", e, exc_info=True)
            raise

    async def cog_check(self, ctx: commands.Context) -> bool:
        if not ctx.guild:
            return False
        staff_role = ctx.guild.get_role(self.staff_role_id)
        helper_role = ctx.guild.get_role(self.helper_role_id)
        return (staff_role is not None and staff_role in ctx.author.roles) or (
            helper_role is not None and helper_role in ctx.author.roles
        )

    @minecraftban.error
    async def minecraftban_error(
        self, interaction: discord.Interaction, error: app_commands.AppCommandError
    ):
        await self._slash_error(interaction, error, "/minecraftban")

    @minecraftwarn.error
    async def minecraftwarn_error(
        self, interaction: discord.Interaction, error: app_commands.AppCommandError
    ):
        await self._slash_error(interaction, error, "/minecraftwarn")

    @minecraftnotify.error
    async def minecraftnotify_error(
        self, interaction: discord.Interaction, error: app_commands.AppCommandError
    ):
        await self._slash_error(interaction, error, "/minecraftnotify")

    async def _slash_error(
        self,
        interaction: discord.Interaction,
        error: app_commands.AppCommandError,
        label: str,
    ):
        logger.error("Error in %s: %s", label, error, exc_info=True)
        msg = f"An unexpected error occurred: {error}"
        if isinstance(error, app_commands.CheckFailure):
            msg = "You need the Staff or Helper role to use this command!"
        elif isinstance(error, app_commands.BotMissingPermissions):
            msg = "I don't have the necessary permissions to execute this command!"
        elif isinstance(error, app_commands.CommandInvokeError):
            msg = f"An error occurred while executing the command: {error.original}"
        if interaction.response.is_done():
            await interaction.followup.send(msg, ephemeral=True)
        else:
            await interaction.response.send_message(msg, ephemeral=True)
