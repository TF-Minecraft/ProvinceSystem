"""
PatchNotes - weekly patch note review (Red V3).

On Friday at 12:00 Central European time the week's notes are posted as one
message and Staff are pinged. Deny once with everything that should change.
That text is feedback for rewriting the whole note, not the new wording, and
the updated note is posted again. At 18:00 lines still waiting are approved
and posted to #updates. Postpone holds the week and tells #updates at 18:00.
Lore items are hidden knowledge. Technical lines stay on the website.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

import aiohttp
import discord
import yaml
from redbot.core import Config, app_commands, commands
from redbot.core.bot import Red

from .format import (
    folders_message,
    post_messages,
    post_review_controls,
    post_review_notice,
    post_test_end,
    post_test_notice,
    post_title,
    postponement_message,
    review_notice,
    review_parts,
    updates_message,
    week_label,
)
from .safety import hidden_knowledge_warning
from .schedule import (
    REVIEW_HOUR,
    friday_at,
    held_review_week,
    note_week,
    previous_week,
    publish_due,
    resolve_zone,
    review_due,
)

logger = logging.getLogger("red.patchnotes")

_DEFAULT_STAFF_ROLE = 1045375274528821318
_DEFAULT_REVIEW_CHANNEL = 1232114215435894865
_DEFAULT_UPDATES_CHANNEL = 1079697131213955122
_DEFAULT_PING_ROLE = 1124721131165847682
_DEFAULT_PAGE_URL = "https://www.tfminecraft.net/updates"
_DEFAULT_POLL_SECONDS = 120
_MIN_POLL_SECONDS = 30
_MAX_POLL_SECONDS = 600
_CONFIG_PATH = Path(__file__).resolve().parent / "config.yml"
# How long the Friday review waits for the weekly post before using the line review.
_POST_WAIT = timedelta(hours=1)
# How long Deny waits for the writer to rewrite the post.
_POST_JOB_SECONDS = 540


def _clamp_poll(value: int) -> int:
    return max(_MIN_POLL_SECONDS, min(_MAX_POLL_SECONDS, value))


def _read_yaml_config() -> dict[str, Any]:
    if not _CONFIG_PATH.is_file():
        logger.warning("PatchNotes config.yml not found at %s", _CONFIG_PATH)
        return {}
    try:
        with _CONFIG_PATH.open(encoding="utf-8") as handle:
            data = yaml.safe_load(handle) or {}
    except Exception:
        logger.exception("Failed to read patchnotes config.yml")
        return {}
    if not isinstance(data, dict):
        logger.warning("patchnotes config.yml root must be a mapping")
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


def _api_detail(data: Optional[Any], text: str) -> str:
    if isinstance(data, dict) and data.get("detail") is not None:
        detail = data["detail"]
        return detail if isinstance(detail, str) else str(detail)
    return (text or "Unknown error")[:300]


def _has_staff(interaction: discord.Interaction) -> bool:
    cog = interaction.client.get_cog("PatchNotes")
    member_is_staff = getattr(cog, "member_is_staff", None)
    return bool(member_is_staff and member_is_staff(interaction))


class DenyReasonModal(discord.ui.Modal, title="Deny patch note"):
    reason = discord.ui.TextInput(
        label="What should change?",
        style=discord.TextStyle.paragraph,
        required=True,
        min_length=1,
        max_length=1000,
        placeholder="What should change? One note can cover several lines. This is not the new wording.",
    )

    def __init__(self, cog: "PatchNotes", bullet_id: str):
        super().__init__()
        self.cog = cog
        self.bullet_id = bullet_id

    async def on_submit(self, interaction: discord.Interaction):
        if not self.cog.member_is_staff(interaction):
            await interaction.response.send_message(
                "You need the Staff role to deny patch notes.",
                ephemeral=True,
            )
            return
        reason = str(self.reason.value).strip()
        if not reason:
            await interaction.response.send_message("Feedback is required.", ephemeral=True)
            return
        await interaction.response.defer(ephemeral=True)
        await self.cog.deny_from_bullet(interaction, self.bullet_id, reason)


class PatchNotesView(discord.ui.View):
    """Persistent Approve/Deny/Postpone controls. custom_ids include the bullet id."""

    def __init__(self, cog: "PatchNotes", bullet_id: str):
        super().__init__(timeout=None)
        self.cog = cog
        self.bullet_id = bullet_id

        approve_btn = discord.ui.Button(
            label="Approve",
            style=discord.ButtonStyle.success,
            custom_id=f"patchnotes:approve:{bullet_id}",
        )
        deny_btn = discord.ui.Button(
            label="Deny",
            style=discord.ButtonStyle.danger,
            custom_id=f"patchnotes:deny:{bullet_id}",
        )
        postpone_btn = discord.ui.Button(
            label="Postpone",
            style=discord.ButtonStyle.secondary,
            custom_id=f"patchnotes:postpone:{bullet_id}",
        )
        approve_btn.callback = self._approve  # type: ignore[method-assign]
        deny_btn.callback = self._deny  # type: ignore[method-assign]
        postpone_btn.callback = self._postpone  # type: ignore[method-assign]
        self.add_item(approve_btn)
        self.add_item(deny_btn)
        self.add_item(postpone_btn)

    async def _approve(self, interaction: discord.Interaction):
        if not self.cog.member_is_staff(interaction):
            await interaction.response.send_message(
                "You need the Staff role to approve patch notes.",
                ephemeral=True,
            )
            return
        await interaction.response.defer(ephemeral=True)
        await self.cog.apply_decision(interaction, self.bullet_id, deny_reason=None)

    async def _deny(self, interaction: discord.Interaction):
        if not self.cog.member_is_staff(interaction):
            await interaction.response.send_message(
                "You need the Staff role to deny patch notes.",
                ephemeral=True,
            )
            return
        await interaction.response.send_modal(DenyReasonModal(self.cog, self.bullet_id))

    async def _postpone(self, interaction: discord.Interaction):
        if not self.cog.member_is_staff(interaction):
            await interaction.response.send_message(
                "You need the Staff role to postpone patch notes.",
                ephemeral=True,
            )
            return
        await interaction.response.defer(ephemeral=True)
        await self.cog.begin_postpone(interaction, self.bullet_id)


class PostponeConfirmView(discord.ui.View):
    """Confirm or cancel a week hold. custom_ids survive a reload."""

    def __init__(self, cog: "PatchNotes", week: str, bullet_id: str):
        super().__init__(timeout=None)
        self.cog = cog
        self.week = week
        self.bullet_id = bullet_id
        yes = discord.ui.Button(
            label="Confirm postpone",
            style=discord.ButtonStyle.danger,
            custom_id=f"patchnotes:postpone-yes:{week}:{bullet_id}",
        )
        no = discord.ui.Button(
            label="Cancel",
            style=discord.ButtonStyle.secondary,
            custom_id=f"patchnotes:postpone-no:{week}:{bullet_id}",
        )
        yes.callback = self._yes  # type: ignore[method-assign]
        no.callback = self._no  # type: ignore[method-assign]
        self.add_item(yes)
        self.add_item(no)

    async def _yes(self, interaction: discord.Interaction):
        if not self.cog.member_is_staff(interaction):
            await interaction.response.send_message(
                "You need the Staff role to postpone patch notes.",
                ephemeral=True,
            )
            return
        await interaction.response.defer(ephemeral=True)
        await self.cog.confirm_postpone(interaction, self.week, self.bullet_id)

    async def _no(self, interaction: discord.Interaction):
        if not self.cog.member_is_staff(interaction):
            await interaction.response.send_message(
                "You need the Staff role to postpone patch notes.",
                ephemeral=True,
            )
            return
        await self.cog.cancel_postpone(interaction, self.bullet_id)


class UndoPostponeView(discord.ui.View):
    """Take back a week hold."""

    def __init__(self, cog: "PatchNotes", week: str, bullet_id: str):
        super().__init__(timeout=None)
        self.cog = cog
        self.week = week
        self.bullet_id = bullet_id
        undo = discord.ui.Button(
            label="Undo postpone",
            style=discord.ButtonStyle.secondary,
            custom_id=f"patchnotes:postpone-undo:{week}:{bullet_id}",
        )
        undo.callback = self._undo  # type: ignore[method-assign]
        self.add_item(undo)

    async def _undo(self, interaction: discord.Interaction):
        if not self.cog.member_is_staff(interaction):
            await interaction.response.send_message(
                "You need the Staff role to undo a postponement.",
                ephemeral=True,
            )
            return
        await interaction.response.defer(ephemeral=True)
        await self.cog.undo_postpone(interaction, self.week, self.bullet_id)


class TestDenyModal(discord.ui.Modal, title="Deny patch note"):
    """Feedback on the whole test note. It is not pasted in as the new text."""

    reason = discord.ui.TextInput(
        label="What should change?",
        style=discord.TextStyle.paragraph,
        required=True,
        min_length=1,
        max_length=1000,
        placeholder="Feedback on the whole note. It is not pasted in as the text.",
    )

    def __init__(self, cog: "PatchNotes", week: str):
        super().__init__()
        self.cog = cog
        self.week = week

    async def on_submit(self, interaction: discord.Interaction):
        if not self.cog.member_is_staff(interaction):
            await interaction.response.send_message(
                "You need the Staff role to deny patch notes.",
                ephemeral=True,
            )
            return
        reason = str(self.reason.value).strip()
        if not reason:
            await interaction.response.send_message("Feedback is required.", ephemeral=True)
            return
        await interaction.response.defer(ephemeral=True)
        await self.cog.post_test_denial(interaction, self.week, reason)


class TestPostponeConfirmView(discord.ui.View):
    """Confirm control for the test. It does not postpone the week."""

    def __init__(self, cog: "PatchNotes", week: str):
        super().__init__(timeout=None)
        self.cog = cog
        self.week = week
        yes_btn = discord.ui.Button(
            label="Confirm postpone",
            style=discord.ButtonStyle.danger,
            custom_id=f"patchnotes:test-postpone-yes:{week}",
        )
        no_btn = discord.ui.Button(
            label="Cancel",
            style=discord.ButtonStyle.secondary,
            custom_id=f"patchnotes:test-postpone-no:{week}",
        )
        yes_btn.callback = self._yes  # type: ignore[method-assign]
        no_btn.callback = self._no  # type: ignore[method-assign]
        self.add_item(yes_btn)
        self.add_item(no_btn)

    async def _yes(self, interaction: discord.Interaction):
        if not self.cog.member_is_staff(interaction):
            await interaction.response.send_message(
                "You need the Staff role to postpone patch notes.",
                ephemeral=True,
            )
            return
        view = TestPreviewView(self.cog, self.week)
        self.cog.bot.add_view(view)
        await interaction.response.edit_message(view=view)
        await interaction.followup.send(
            "Postpone works. This is a test, so the week was not postponed.",
            ephemeral=True,
        )

    async def _no(self, interaction: discord.Interaction):
        if not self.cog.member_is_staff(interaction):
            await interaction.response.send_message(
                "You need the Staff role to postpone patch notes.",
                ephemeral=True,
            )
            return
        view = TestPreviewView(self.cog, self.week)
        self.cog.bot.add_view(view)
        await interaction.response.edit_message(view=view)
        await interaction.followup.send("Cancelled.", ephemeral=True)


class TestPreviewView(discord.ui.View):
    """Approve, Deny, and Postpone for /patchnotes test. Nothing is posted publicly."""

    def __init__(self, cog: "PatchNotes", week: str):
        super().__init__(timeout=None)
        self.cog = cog
        self.week = week
        approve_btn = discord.ui.Button(
            label="Approve",
            style=discord.ButtonStyle.success,
            custom_id=f"patchnotes:test:{week}",
        )
        deny_btn = discord.ui.Button(
            label="Deny",
            style=discord.ButtonStyle.danger,
            custom_id=f"patchnotes:test-deny:{week}",
        )
        postpone_btn = discord.ui.Button(
            label="Postpone",
            style=discord.ButtonStyle.secondary,
            custom_id=f"patchnotes:test-postpone:{week}",
        )
        approve_btn.callback = self._approve  # type: ignore[method-assign]
        deny_btn.callback = self._deny  # type: ignore[method-assign]
        postpone_btn.callback = self._postpone  # type: ignore[method-assign]
        self.add_item(approve_btn)
        self.add_item(deny_btn)
        self.add_item(postpone_btn)

    async def _approve(self, interaction: discord.Interaction):
        if not self.cog.member_is_staff(interaction):
            await interaction.response.send_message(
                "You need the Staff role to approve patch notes.",
                ephemeral=True,
            )
            return
        await interaction.response.defer(ephemeral=True)
        try:
            await self.cog.refresh_test_message(interaction, self.week)
        except Exception as exc:
            await interaction.followup.send(str(exc)[:300], ephemeral=True)
            return
        await interaction.followup.send(
            "Approve works. This is a test, so nothing was posted in #updates.",
            ephemeral=True,
        )

    async def _deny(self, interaction: discord.Interaction):
        if not self.cog.member_is_staff(interaction):
            await interaction.response.send_message(
                "You need the Staff role to deny patch notes.",
                ephemeral=True,
            )
            return
        await interaction.response.send_modal(TestDenyModal(self.cog, self.week))

    async def _postpone(self, interaction: discord.Interaction):
        if not self.cog.member_is_staff(interaction):
            await interaction.response.send_message(
                "You need the Staff role to postpone patch notes.",
                ephemeral=True,
            )
            return
        view = TestPostponeConfirmView(self.cog, self.week)
        self.cog.bot.add_view(view)
        await interaction.response.edit_message(view=view)


class WeekDenyModal(discord.ui.Modal, title="Deny patch note"):
    """Feedback on the whole week's note. It is not pasted in as the new text."""

    reason = discord.ui.TextInput(
        label="What should change?",
        style=discord.TextStyle.paragraph,
        required=True,
        min_length=1,
        max_length=1000,
        placeholder="What should change? One note can cover several lines. This is not the new wording.",
    )

    def __init__(self, cog: "PatchNotes", week: str):
        super().__init__()
        self.cog = cog
        self.week = week

    async def on_submit(self, interaction: discord.Interaction):
        if not self.cog.member_is_staff(interaction):
            await interaction.response.send_message(
                "You need the Staff role to deny patch notes.",
                ephemeral=True,
            )
            return
        reason = str(self.reason.value).strip()
        if not reason:
            await interaction.response.send_message("Feedback is required.", ephemeral=True)
            return
        await interaction.response.defer(ephemeral=True)
        await self.cog.post_week_denial(interaction, self.week, reason)


class WeekPostponeConfirmView(discord.ui.View):
    """Confirm or cancel a hold from the week's single review message."""

    def __init__(self, cog: "PatchNotes", week: str):
        super().__init__(timeout=None)
        self.cog = cog
        self.week = week
        yes = discord.ui.Button(
            label="Confirm postpone",
            style=discord.ButtonStyle.danger,
            custom_id=f"patchnotes:week-postpone-yes:{week}",
        )
        no = discord.ui.Button(
            label="Cancel",
            style=discord.ButtonStyle.secondary,
            custom_id=f"patchnotes:week-postpone-no:{week}",
        )
        yes.callback = self._yes  # type: ignore[method-assign]
        no.callback = self._no  # type: ignore[method-assign]
        self.add_item(yes)
        self.add_item(no)

    async def _yes(self, interaction: discord.Interaction):
        if not self.cog.member_is_staff(interaction):
            await interaction.response.send_message(
                "You need the Staff role to postpone patch notes.",
                ephemeral=True,
            )
            return
        await interaction.response.defer(ephemeral=True)
        await self.cog.confirm_week_postpone(interaction, self.week)

    async def _no(self, interaction: discord.Interaction):
        if not self.cog.member_is_staff(interaction):
            await interaction.response.send_message(
                "You need the Staff role to postpone patch notes.",
                ephemeral=True,
            )
            return
        await self.cog.cancel_week_postpone(interaction, self.week)


class WeekUndoPostponeView(discord.ui.View):
    """Take back a week hold from the single review message."""

    def __init__(self, cog: "PatchNotes", week: str):
        super().__init__(timeout=None)
        self.cog = cog
        self.week = week
        undo = discord.ui.Button(
            label="Undo postpone",
            style=discord.ButtonStyle.secondary,
            custom_id=f"patchnotes:week-postpone-undo:{week}",
        )
        undo.callback = self._undo  # type: ignore[method-assign]
        self.add_item(undo)

    async def _undo(self, interaction: discord.Interaction):
        if not self.cog.member_is_staff(interaction):
            await interaction.response.send_message(
                "You need the Staff role to undo a postponement.",
                ephemeral=True,
            )
            return
        await interaction.response.defer(ephemeral=True)
        await self.cog.undo_week_postpone(interaction, self.week)


class WeekReviewView(discord.ui.View):
    """Approve, Deny, and Postpone for one week's notes."""

    def __init__(self, cog: "PatchNotes", week: str):
        super().__init__(timeout=None)
        self.cog = cog
        self.week = week
        approve_btn = discord.ui.Button(
            label="Approve",
            style=discord.ButtonStyle.success,
            custom_id=f"patchnotes:week-approve:{week}",
        )
        deny_btn = discord.ui.Button(
            label="Deny",
            style=discord.ButtonStyle.danger,
            custom_id=f"patchnotes:week-deny:{week}",
        )
        postpone_btn = discord.ui.Button(
            label="Postpone",
            style=discord.ButtonStyle.secondary,
            custom_id=f"patchnotes:week-postpone:{week}",
        )
        approve_btn.callback = self._approve  # type: ignore[method-assign]
        deny_btn.callback = self._deny  # type: ignore[method-assign]
        postpone_btn.callback = self._postpone  # type: ignore[method-assign]
        self.add_item(approve_btn)
        self.add_item(deny_btn)
        self.add_item(postpone_btn)

    async def _approve(self, interaction: discord.Interaction):
        if not self.cog.member_is_staff(interaction):
            await interaction.response.send_message(
                "You need the Staff role to approve patch notes.",
                ephemeral=True,
            )
            return
        await interaction.response.defer(ephemeral=True)
        await self.cog.approve_week_review(interaction, self.week)

    async def _deny(self, interaction: discord.Interaction):
        if not self.cog.member_is_staff(interaction):
            await interaction.response.send_message(
                "You need the Staff role to deny patch notes.",
                ephemeral=True,
            )
            return
        await interaction.response.send_modal(WeekDenyModal(self.cog, self.week))

    async def _postpone(self, interaction: discord.Interaction):
        if not self.cog.member_is_staff(interaction):
            await interaction.response.send_message(
                "You need the Staff role to postpone patch notes.",
                ephemeral=True,
            )
            return
        await interaction.response.defer(ephemeral=True)
        await self.cog.begin_week_postpone(interaction, self.week)


class ResetConfirmView(discord.ui.View):
    """Confirm before deny edits are dropped and the original notes return."""

    def __init__(self, cog: "PatchNotes", week: str):
        super().__init__(timeout=180)
        self.cog = cog
        self.week = week

    @discord.ui.button(label="Confirm reset", style=discord.ButtonStyle.danger)
    async def confirm(self, interaction: discord.Interaction, button: discord.ui.Button):
        del button
        if not self.cog.member_is_staff(interaction):
            await interaction.response.send_message(
                "You need the Staff role to reset patch notes.",
                ephemeral=True,
            )
            return
        await interaction.response.defer()
        try:
            status, text, data = await self.cog.api_request(
                "POST", f"/patchnotes/staff/weeks/{self.week}/reset"
            )
        except Exception as exc:
            for child in self.children:
                child.disabled = True
            await interaction.edit_original_response(content=str(exc)[:300], view=self)
            return
        for child in self.children:
            child.disabled = True
        if status != 200 or not isinstance(data, dict):
            await interaction.edit_original_response(
                content=f"Could not reset that week: {_api_detail(data, text)}",
                view=self,
            )
            return
        removed = int(data.get("removed") or 0)
        restored = int(data.get("restored") or 0)
        if removed == 0 and restored == 0:
            content = f"No deny edits to clear for {week_label(self.week)}."
        else:
            content = (
                f"Cleared the deny edits for {week_label(self.week)}. "
                "The original notes are back."
            )
            try:
                await self.cog.retire_review_message(self.week)
                bundles = dict(await self.cog.config.review_bundles())
                bundles.pop(self.week, None)
                await self.cog.config.review_bundles.set(bundles)
                await self.cog.post_week_review(self.week, ping=False)
                content += " A new review message is in the channel."
            except Exception:
                logger.exception("Reset %s but the review was not posted again", self.week)
                content += " The review message could not be posted yet. It will be retried."
        await interaction.edit_original_response(content=content, view=self)

    @discord.ui.button(label="Cancel", style=discord.ButtonStyle.secondary)
    async def cancel(self, interaction: discord.Interaction, button: discord.ui.Button):
        del button
        if not self.cog.member_is_staff(interaction):
            await interaction.response.send_message(
                "You need the Staff role to reset patch notes.",
                ephemeral=True,
            )
            return
        for child in self.children:
            child.disabled = True
        await interaction.response.edit_message(content="Cancelled.", view=self)


class PatchNotes(commands.Cog):
    """Staff patch note review. Players only see approved lines."""

    patchnotes = app_commands.Group(
        name="patchnotes",
        description="TFMC weekly patch note review",
    )

    def __init__(self, bot: Red):
        self.bot = bot
        self.config = Config.get_conf(self, identifier=884422110033, force_registration=True)
        self.config.register_global(
            posted_ids=[],
            review_messages={},
            week_messages={},
            announced_weeks=[],
            review_posted_weeks=[],
            review_sort_attempted_weeks=[],
            published_weeks=[],
            test_weeks=[],
            postpone_confirm={},
            postpone_undo={},
            postponement_messages={},
            review_bundles={},
            week_postpone_confirm=[],
            week_postpone_undo=[],
            post_review_messages={},
            week_post_messages={},
        )
        self._poll_task: Optional[asyncio.Task] = None
        self.apply_settings(self.load_settings())

    def load_settings(self) -> dict[str, Any]:
        raw = _read_yaml_config()
        return {
            "api_base_url": _env_or_yaml_str("API_BASE_URL", raw.get("api_base_url")).rstrip("/"),
            "staff_key": _env_or_yaml_str("STAFF_KEY", raw.get("staff_key")),
            "review_channel_id": _env_or_yaml_int(
                "PATCHNOTES_REVIEW_CHANNEL_ID",
                raw.get("review_channel_id"),
                _DEFAULT_REVIEW_CHANNEL,
            ),
            "updates_channel_id": _env_or_yaml_int(
                "PATCHNOTES_UPDATES_CHANNEL_ID",
                raw.get("updates_channel_id"),
                _DEFAULT_UPDATES_CHANNEL,
            ),
            "update_ping_role_id": _env_or_yaml_int(
                "PATCHNOTES_PING_ROLE_ID",
                raw.get("update_ping_role_id"),
                _DEFAULT_PING_ROLE,
            ),
            "staff_role_id": _env_or_yaml_int(
                "STAFF_ROLE_ID", raw.get("staff_role_id"), _DEFAULT_STAFF_ROLE
            ),
            "page_url": _env_or_yaml_str(
                "PATCHNOTES_PAGE_URL", raw.get("page_url"), _DEFAULT_PAGE_URL
            ),
            "timezone": _env_or_yaml_str(
                "PATCHNOTES_TZ", raw.get("timezone"), "Europe/Berlin"
            ),
            "poll_interval": _clamp_poll(
                _env_or_yaml_int(
                    "PATCHNOTES_POLL_INTERVAL_SECONDS",
                    raw.get("poll_interval_seconds"),
                    _DEFAULT_POLL_SECONDS,
                )
            ),
        }

    def apply_settings(self, settings: dict[str, Any]) -> None:
        self.api_base_url = settings["api_base_url"]
        self.staff_key = settings["staff_key"]
        self.review_channel_id = int(settings["review_channel_id"] or 0)
        self.updates_channel_id = int(settings["updates_channel_id"] or 0)
        self.update_ping_role_id = int(settings["update_ping_role_id"] or 0)
        self.staff_role_id = int(settings["staff_role_id"] or 0)
        self.page_url = settings["page_url"] or _DEFAULT_PAGE_URL
        self.poll_interval = int(settings["poll_interval"])
        try:
            self.zone = resolve_zone(str(settings.get("timezone") or ""))
        except ValueError:
            logger.exception("PatchNotes timezone is invalid; using Europe/Berlin")
            self.zone = resolve_zone("Europe/Berlin")

    def member_is_staff(self, interaction: discord.Interaction) -> bool:
        if not interaction.guild or not self.staff_role_id:
            return False
        member = interaction.user
        roles = getattr(member, "roles", None)
        if not roles:
            return False
        staff_role = interaction.guild.get_role(self.staff_role_id)
        return staff_role is not None and staff_role in roles

    async def cog_load(self):
        self.apply_settings(self.load_settings())
        messages = await self.config.review_messages()
        if isinstance(messages, dict):
            for bullet_id in messages:
                self.bot.add_view(PatchNotesView(self, str(bullet_id)))
            logger.info("Reattached %s patchnotes view(s)", len(messages))
        for week in await self.config.test_weeks():
            self.bot.add_view(TestPreviewView(self, str(week)))
        confirms = await self.config.postpone_confirm()
        if isinstance(confirms, dict):
            for bullet_id, week in confirms.items():
                self.bot.add_view(PostponeConfirmView(self, str(week), str(bullet_id)))
        held = await self.config.postpone_undo()
        if isinstance(held, dict):
            for week, bullet_id in held.items():
                self.bot.add_view(UndoPostponeView(self, str(week), str(bullet_id)))
        bundles = await self.config.review_bundles()
        if isinstance(bundles, dict):
            for week in bundles:
                self.bot.add_view(WeekReviewView(self, str(week)))
        for week in await self.config.week_postpone_confirm():
            self.bot.add_view(WeekPostponeConfirmView(self, str(week)))
        for week in await self.config.week_postpone_undo():
            self.bot.add_view(WeekUndoPostponeView(self, str(week)))
        self._poll_task = asyncio.create_task(self._poll_loop())
        logger.info(
            "PatchNotes poller started (interval=%ss, api=%s)",
            self.poll_interval,
            self.api_base_url or "(unset)",
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
        logger.info("PatchNotes poller stopped")

    async def _poll_loop(self) -> None:
        await self.bot.wait_until_ready()
        while True:
            try:
                await self._poll_once()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("PatchNotes poll cycle failed")
            try:
                await asyncio.sleep(self.poll_interval)
            except asyncio.CancelledError:
                raise

    async def _poll_once(self) -> None:
        if not self.api_base_url or not self.staff_key:
            logger.warning("PatchNotes poll skipped: set api_base_url and staff_key")
            return
        pending = await self.fetch_pending()
        pending_ids = {
            str(bullet.get("id") or "").strip()
            for bullet in pending
            if isinstance(bullet, dict) and str(bullet.get("id") or "").strip()
        }
        posted_list = [
            str(item)
            for item in await self.config.posted_ids()
            if str(item).strip() in pending_ids
        ]
        if list(await self.config.posted_ids()) != posted_list:
            await self.config.posted_ids.set(posted_list)
        now = datetime.now(timezone.utc)
        due_weeks: list[str] = []
        seen_weeks: set[str] = set()
        for bullet in pending:
            bullet_id = str(bullet.get("id") or "").strip()
            week = str(bullet.get("week") or "").strip()
            if not bullet_id or not week or week in seen_weeks:
                continue
            try:
                ready = review_due(week, now, self.zone)
            except ValueError:
                logger.warning("Skipping patch note %s with week %r", bullet_id, week)
                continue
            if not ready:
                continue
            seen_weeks.add(week)
            due_weeks.append(week)
        if due_weeks and not self.review_channel_id:
            logger.warning("PatchNotes review skipped: review_channel_id is not set")
            due_weeks = []
        bundles = {
            str(week)
            for week in dict(await self.config.review_bundles())
        }
        review_posted = [str(item) for item in await self.config.review_posted_weeks()]
        for week in due_weeks:
            if week in bundles:
                continue
            try:
                if week not in review_posted and week not in await self.config.review_sort_attempted_weeks():
                    await self._remember_week_flag("review_sort_attempted_weeks", week)
                    await self.sort_week(week)
                if not await self.post_due_review(week, ping=week not in review_posted, now=now):
                    continue
            except Exception:
                logger.exception("Failed to post the review for %s", week)
                continue
            if week not in review_posted:
                review_posted.append(week)
                await self.config.review_posted_weeks.set(review_posted)
        await self._publish_due_weeks(now, pending)

    def staff_headers(self) -> dict[str, str]:
        return {"X-Staff-Key": self.staff_key}

    # The weekly Discord post, written by the API from the week's server changes.

    async def fetch_post(self, week: str) -> Optional[dict]:
        """The week's post, or None when the server comparison has not run."""
        status, text, data = await self.api_request("GET", f"/patchnotes/staff/weeks/{week}/post")
        if status == 404:
            return None
        if status != 200 or not isinstance(data, dict):
            raise RuntimeError(f"Could not load the post for {week}: HTTP {status} {(text or '')[:200]}")
        return data

    @staticmethod
    def post_ready(post: Optional[dict]) -> bool:
        return bool(post and post.get("messages"))

    def ping_mention(self) -> Optional[str]:
        return f"<@&{self.update_ping_role_id}>" if self.update_ping_role_id else None

    async def post_due_review(self, week: str, *, ping: bool, now: datetime) -> bool:
        """Post the Friday review. False means wait: the post is still being written."""
        try:
            post = await self.fetch_post(week)
        except Exception:
            logger.exception("Could not load the post for %s", week)
            post = None
        if self.post_ready(post):
            await self.post_post_review(week, post, ping=ping)
            return True
        if now < friday_at(week, REVIEW_HOUR, self.zone) + _POST_WAIT:
            return False
        logger.warning("No post for %s after an hour; posting the line review", week)
        await self.post_week_review(week, ping=ping)
        return True

    async def post_post_review(
        self, week: str, post: dict, *, ping: bool = False, rewritten: bool = False
    ) -> None:
        """Staff notice, the post exactly as players will see it, then the buttons."""
        channel = await self._channel(self.review_channel_id)
        if channel is None:
            raise RuntimeError("Review channel is not available.")
        staff = f"<@&{self.staff_role_id}>" if ping and self.staff_role_id else None
        notice = await channel.send(
            post_review_notice(week, post, mention=staff, rewritten=rewritten),
            allowed_mentions=self._review_allowed(staff),
        )
        sent = [notice.id]
        for content in post_messages(post, self.ping_mention()):
            message = await channel.send(content, allowed_mentions=discord.AllowedMentions.none())
            sent.append(message.id)
        view = WeekReviewView(self, week)
        self.bot.add_view(view)
        control = await channel.send(
            post_review_controls(post), view=view, allowed_mentions=discord.AllowedMentions.none()
        )
        sent.append(control.id)
        bundles = dict(await self.config.review_bundles())
        bundles[week] = control.id
        await self.config.review_bundles.set(bundles)
        reviews = dict(await self.config.post_review_messages())
        reviews[week] = sent
        await self.config.post_review_messages.set(reviews)
        logger.info("Posted the %s post review with %s messages", week, len(sent) - 2)

    async def submit_post_feedback(self, week: str, feedback: str) -> dict:
        """Rewrite the whole post from feedback and return the new post."""
        status, text, data = await self.api_request(
            "POST", f"/patchnotes/staff/weeks/{week}/post/feedback", {"feedback": feedback}
        )
        if status == 409:
            raise RuntimeError(_api_detail(data, text))
        if status != 202 or not isinstance(data, dict) or not isinstance(data.get("job"), dict):
            raise RuntimeError(_api_detail(data, text))
        return await self._wait_for_post(week, str(data["job"].get("id") or ""))

    async def write_post(self, week: str) -> dict:
        """Write the post again from the week's server changes."""
        status, text, data = await self.api_request("POST", f"/patchnotes/staff/weeks/{week}/post/compose")
        if status != 202 or not isinstance(data, dict) or not isinstance(data.get("job"), dict):
            raise RuntimeError(_api_detail(data, text))
        return await self._wait_for_post(week, str(data["job"].get("id") or ""))

    async def _wait_for_post(self, week: str, job_id: str) -> dict:
        if not job_id:
            raise RuntimeError("The API did not return a job id.")
        result = await self._poll_job(job_id, timeout=_POST_JOB_SECONDS)
        if result is None:
            raise RuntimeError("The writer is still working. Try again in a few minutes.")
        job = result.get("job") if isinstance(result.get("job"), dict) else {}
        if job.get("status") != "done":
            raise RuntimeError(str(job.get("error") or "The writer failed.")[:300])
        post = await self.fetch_post(week)
        if not self.post_ready(post):
            raise RuntimeError("The writer finished but the post is empty.")
        return post

    async def approve_post(self, week: str) -> None:
        try:
            await self.api_request("POST", f"/patchnotes/staff/weeks/{week}/post/approve")
        except Exception:
            logger.exception("Could not mark the %s post approved", week)

    async def publish_post(self, week: str, post: dict, *, ping: bool = True) -> None:
        """Send or edit the post in #updates. Only a first send pings."""
        channel = await self._channel(self.updates_channel_id)
        if channel is None:
            raise RuntimeError("Updates channel is not available.")
        stored = dict(await self.config.week_post_messages())
        old_ids = [int(item) for item in stored.get(week) or []]
        announced = [str(item) for item in await self.config.announced_weeks()]
        pinging = ping and not old_ids and week not in announced and bool(self.update_ping_role_id)
        shown = self.ping_mention() if pinging or week in announced else None
        messages = post_messages(post, shown)
        ping_first = (
            discord.AllowedMentions(everyone=False, users=False, roles=[discord.Object(id=self.update_ping_role_id)])
            if pinging
            else discord.AllowedMentions.none()
        )
        new_ids: list[int] = []
        for index, content in enumerate(messages):
            message = None
            if index < len(old_ids):
                try:
                    message = await channel.fetch_message(old_ids[index])
                    await message.edit(content=content, allowed_mentions=discord.AllowedMentions.none())
                except discord.NotFound:
                    message = None
            if message is None:
                allowed = ping_first if index == 0 else discord.AllowedMentions.none()
                message = await channel.send(content, allowed_mentions=allowed)
            new_ids.append(message.id)
        for extra in old_ids[len(messages):]:
            try:
                await (await channel.fetch_message(extra)).delete()
            except discord.HTTPException:
                logger.warning("Could not remove an old %s update message", week)
        stored[week] = new_ids
        await self.config.week_post_messages.set(stored)
        legacy = dict(await self.config.week_messages())
        legacy[week] = new_ids[0]
        await self.config.week_messages.set(legacy)
        if week not in announced:
            announced.append(week)
            await self.config.announced_weeks.set(announced)

    async def send_test_post(self, channel: discord.abc.Messageable, week: str, post: dict) -> None:
        """A copy of the post for staff to read. No buttons, and nobody is pinged."""
        none = discord.AllowedMentions.none()
        await channel.send(post_test_notice(week, post), allowed_mentions=none)
        for content in post_messages(post, self.ping_mention()):
            await channel.send(content, allowed_mentions=none)
        await channel.send(post_test_end(), allowed_mentions=none)

    async def api_request(
        self, method: str, path: str, payload: Optional[dict] = None
    ) -> tuple[int, str, Optional[Any]]:
        if not self.api_base_url:
            raise RuntimeError("api_base_url is not set in config.yml")
        headers = self.staff_headers()
        if payload is not None:
            headers["Content-Type"] = "application/json"
        async with aiohttp.ClientSession() as session:
            async with session.request(
                method, f"{self.api_base_url}{path}", headers=headers, json=payload
            ) as resp:
                text = await resp.text()
                try:
                    data: Optional[Any] = json.loads(text) if text else None
                except json.JSONDecodeError:
                    data = None
                return resp.status, text, data

    async def fetch_pending(self) -> list[dict]:
        status, text, data = await self.api_request("GET", "/patchnotes/staff/queue")
        if status == 401:
            raise RuntimeError("API returned 401: invalid or missing STAFF_KEY.")
        if status != 200:
            raise RuntimeError(f"API error HTTP {status}: {(text or '')[:200]}")
        if not isinstance(data, dict) or not isinstance(data.get("bullets"), list):
            raise RuntimeError("API queue response missing bullets list.")
        return [bullet for bullet in data["bullets"] if isinstance(bullet, dict)]

    async def fetch_week(self, week: str) -> list[dict]:
        status, text, data = await self.api_request(
            "GET", f"/patchnotes/weeks/{week}"
        )
        if status != 200 or not isinstance(data, dict) or not isinstance(data.get("bullets"), list):
            raise RuntimeError(f"Could not load approved notes for {week}: HTTP {status} {(text or '')[:200]}")
        return [bullet for bullet in data["bullets"] if isinstance(bullet, dict)]

    async def fetch_bullet(self, bullet_id: str) -> dict:
        status, text, data = await self.api_request("GET", f"/patchnotes/staff/bullets/{bullet_id}")
        if status != 200 or not isinstance(data, dict):
            raise RuntimeError(f"Could not load that note: HTTP {status} {(text or '')[:200]}")
        return data

    async def unreleased_week(self) -> str:
        """The week test and reset edit: still in review until it is posted or postponed."""
        now = datetime.now(timezone.utc)
        filing = note_week(now, self.zone)
        closed = previous_week(filing)
        published = {str(item) for item in await self.config.published_weeks()}
        released = closed in published
        postponed = False
        has_notes = False
        if not released:
            try:
                state = await self.fetch_week_status(closed)
                postponed = bool(state.get("postponed"))
            except Exception:
                logger.exception("Could not load the week status for %s", closed)
            if not postponed:
                try:
                    pending = await self.fetch_pending()
                    has_notes = any(str(bullet.get("week") or "") == closed for bullet in pending)
                    if not has_notes:
                        has_notes = bool(await self.fetch_week(closed))
                except Exception:
                    logger.exception("Could not tell whether %s still has notes", closed)
                    has_notes = True
        return held_review_week(
            now,
            self.zone,
            released=released,
            postponed=postponed,
            has_notes=has_notes,
        )

    async def fetch_week_status(self, week: str) -> dict:
        status, text, data = await self.api_request("GET", f"/patchnotes/staff/weeks/{week}")
        if status != 200 or not isinstance(data, dict):
            raise RuntimeError(f"Could not load {week}: HTTP {status} {(text or '')[:200]}")
        return data

    async def auto_approve_week(self, week: str) -> None:
        status, text, data = await self.api_request(
            "POST", f"/patchnotes/staff/weeks/{week}/auto-approve"
        )
        if status == 409:
            return
        if status != 200:
            raise RuntimeError(
                f"Could not approve waiting notes for {week}: HTTP {status} {(text or '')[:200]}"
            )

    async def _forget_confirm(self, bullet_id: str) -> None:
        confirms = dict(await self.config.postpone_confirm())
        if bullet_id in confirms:
            confirms.pop(bullet_id, None)
            await self.config.postpone_confirm.set(confirms)

    async def _remember_undo(self, week: str, bullet_id: str) -> None:
        held = dict(await self.config.postpone_undo())
        held[week] = bullet_id
        await self.config.postpone_undo.set(held)

    async def begin_postpone(self, interaction: discord.Interaction, bullet_id: str) -> None:
        try:
            bullet = await self.fetch_bullet(bullet_id)
        except Exception as exc:
            await interaction.followup.send(str(exc)[:300], ephemeral=True)
            return
        week = str(bullet.get("week") or "").strip()
        if not week:
            await interaction.followup.send("That note has no week.", ephemeral=True)
            return
        try:
            state = await self.fetch_week_status(week)
        except Exception as exc:
            await interaction.followup.send(str(exc)[:300], ephemeral=True)
            return
        if state.get("postponed"):
            view = UndoPostponeView(self, week, bullet_id)
            self.bot.add_view(view)
            await self._remember_undo(week, bullet_id)
            if interaction.message is not None:
                await interaction.message.edit(view=view)
            await interaction.followup.send(
                "This week is already postponed. Use Undo postpone to take it back.",
                ephemeral=True,
            )
            return
        view = PostponeConfirmView(self, week, bullet_id)
        self.bot.add_view(view)
        confirms = dict(await self.config.postpone_confirm())
        confirms[bullet_id] = week
        await self.config.postpone_confirm.set(confirms)
        if interaction.message is not None:
            await interaction.message.edit(view=view)
        await interaction.followup.send(
            "Confirm postpone to hold this week's notes until next week.",
            ephemeral=True,
        )

    async def cancel_postpone(self, interaction: discord.Interaction, bullet_id: str) -> None:
        await self._forget_confirm(bullet_id)
        view = PatchNotesView(self, bullet_id)
        self.bot.add_view(view)
        await interaction.response.edit_message(view=view)

    async def confirm_postpone(
        self, interaction: discord.Interaction, week: str, bullet_id: str
    ) -> None:
        status, text, data = await self.api_request(
            "POST", f"/patchnotes/staff/weeks/{week}/postpone"
        )
        if status != 200:
            await interaction.followup.send(
                f"Could not postpone that week: {_api_detail(data, text)}",
                ephemeral=True,
            )
            return
        await self._forget_confirm(bullet_id)
        await self._remember_undo(week, bullet_id)
        view = UndoPostponeView(self, week, bullet_id)
        self.bot.add_view(view)
        if interaction.message is not None:
            try:
                await interaction.message.edit(view=view)
            except discord.HTTPException:
                logger.exception("Could not show the undo button")
        try:
            due = publish_due(week, datetime.now(timezone.utc), self.zone)
        except ValueError:
            due = False
        if not due:
            await interaction.followup.send(
                "Postponed. The updates channel will say so at 18:00. "
                "Use Undo postpone if this was a misclick.",
                ephemeral=True,
            )
            return
        try:
            await self.finish_postponement(week)
        except Exception:
            logger.exception("Postponed %s but the notice was not posted", week)
            await interaction.followup.send(
                "Postponed. The notice could not be posted yet; it will be retried.",
                ephemeral=True,
            )
            return
        await interaction.followup.send(
            "Postponed. The updates channel has the notice. Use Undo postpone to take it back.",
            ephemeral=True,
        )

    async def undo_postpone(
        self, interaction: discord.Interaction, week: str, bullet_id: str
    ) -> None:
        status, text, data = await self.api_request(
            "POST", f"/patchnotes/staff/weeks/{week}/undo-postpone"
        )
        if status != 200:
            await interaction.followup.send(
                f"Could not undo that postponement: {_api_detail(data, text)}",
                ephemeral=True,
            )
            return
        held = dict(await self.config.postpone_undo())
        held.pop(week, None)
        await self.config.postpone_undo.set(held)
        notices = dict(await self.config.postponement_messages())
        notices.pop(week, None)
        await self.config.postponement_messages.set(notices)
        published = [item for item in await self.config.published_weeks() if str(item) != week]
        await self.config.published_weeks.set(published)
        view = PatchNotesView(self, bullet_id)
        self.bot.add_view(view)
        if interaction.message is not None:
            try:
                await interaction.message.edit(view=view)
            except discord.HTTPException:
                logger.exception("Could not restore the review buttons")
        try:
            due = publish_due(week, datetime.now(timezone.utc), self.zone)
        except ValueError:
            due = False
        if not due:
            await interaction.followup.send("Postpone undone.", ephemeral=True)
            return
        try:
            await self.auto_approve_week(week)
            await self.publish_week(week)
        except Exception:
            logger.exception("Undid the postponement for %s but the notes were not posted", week)
            await interaction.followup.send(
                "Postpone undone, but the notes could not be posted. "
                "Use `/patchnotes refresh` once the channel is reachable.",
                ephemeral=True,
            )
            return
        await self._mark_published(week)
        await interaction.followup.send("Postpone undone. This week's notes were posted.", ephemeral=True)

    async def finish_postponement(self, week: str) -> None:
        state = await self.fetch_week_status(week)
        if not state.get("postponed"):
            return
        if not state.get("deferred_to"):
            await self._announce_postponement(week)
            status, text, data = await self.api_request(
                "POST", f"/patchnotes/staff/weeks/{week}/defer"
            )
            if status == 409:
                return
            if status != 200:
                raise RuntimeError(
                    f"Could not move {week} to next week: HTTP {status} {(text or '')[:200]}"
                )
        await self._mark_published(week)

    async def _announce_postponement(self, week: str) -> None:
        notices = dict(await self.config.postponement_messages())
        if notices.get(week):
            return
        channel = await self._channel(self.updates_channel_id)
        if channel is None:
            raise RuntimeError("Updates channel is not available.")
        body = postponement_message(week)
        updates = dict(await self.config.week_messages())
        message_id = updates.get(week)
        message = None
        if message_id:
            try:
                message = await channel.fetch_message(int(message_id))
                await message.edit(content=body, allowed_mentions=discord.AllowedMentions.none())
            except discord.NotFound:
                message = None
            except discord.HTTPException:
                logger.exception("Could not replace the weekly message for %s", week)
                message = None
        if message is None:
            message = await channel.send(body, allowed_mentions=discord.AllowedMentions.none())
            updates[week] = message.id
            await self.config.week_messages.set(updates)
        notices[week] = message.id
        await self.config.postponement_messages.set(notices)
        # A posted multi-message update keeps only its first message, now the notice.
        posts = dict(await self.config.week_post_messages())
        for extra in (posts.pop(week, None) or [])[1:]:
            try:
                await (await channel.fetch_message(int(extra))).delete()
            except discord.HTTPException:
                logger.warning("Could not remove an old %s update message", week)
        await self.config.week_post_messages.set(posts)

    def build_review_embed(self, bullet: dict, *, decision: str = "", reason: str = "") -> discord.Embed:
        section = str(bullet.get("section") or "note")
        label = {"new": "New", "fixed": "Fixed", "adjusted": "Adjusted", "technical": "Technical"}.get(
            section, section
        )
        week = str(bullet.get("week") or "")
        title = f"{label} · {week_label(week)}"
        if not decision and str(bullet.get("revision_note") or "").strip():
            title = f"Revised · {title}"
        if decision:
            title = f"{decision} · {title}"
        colour = discord.Color.green() if decision == "Approved" else discord.Color.orange()
        if decision == "Denied":
            colour = discord.Color.red()
        embed = discord.Embed(
            title=title[:256],
            description=str(bullet.get("body") or "")[:4096],
            colour=colour,
        )
        embed.set_footer(text=str(bullet.get("id") or ""))
        warning = str(bullet.get("warning") or "").strip() or (
            hidden_knowledge_warning(str(bullet.get("body") or "")) or ""
        )
        if warning:
            embed.add_field(name="Hidden knowledge", value=warning[:1024], inline=False)
        if reason:
            embed.add_field(name="Reason", value=reason[:1024], inline=False)
        note = str(bullet.get("revision_note") or "").strip()
        if note and not reason:
            embed.add_field(name="Rewritten because", value=note[:1024], inline=False)
        return embed

    async def _channel(self, channel_id: int) -> Optional[discord.abc.Messageable]:
        if not channel_id:
            return None
        channel = self.bot.get_channel(channel_id)
        if channel is None:
            try:
                channel = await self.bot.fetch_channel(channel_id)
            except discord.HTTPException:
                logger.warning("Could not fetch channel %s", channel_id)
                return None
        return channel

    def _test_banner(self, body: str) -> str:
        prefix = "# This is a test!\n"
        if len(prefix) + len(body) <= 2000:
            return prefix + body
        return prefix + body[: 1999 - len(prefix)] + "…"

    async def preview_bullets(self, week: str) -> list[dict]:
        """Approved lines plus anything still waiting, for this week only."""
        approved = await self.fetch_week(week)
        pending = await self.fetch_pending()
        seen = {str(bullet.get("id") or "") for bullet in approved}
        extra = [
            bullet
            for bullet in pending
            if str(bullet.get("week") or "") == week and str(bullet.get("id") or "") not in seen
        ]
        return approved + extra

    async def create_test_preview(self, week: str) -> list[dict]:
        """Store a staff-only website note for this week. It expires after one hour."""
        status, text, data = await self.api_request(
            "POST", "/patchnotes/staff/preview", {"week": week}
        )
        if status != 200 or not isinstance(data, dict) or not isinstance(data.get("bullets"), list):
            raise RuntimeError(
                f"Could not store the test preview: HTTP {status} {(text or '')[:200]}"
            )
        return [bullet for bullet in data["bullets"] if isinstance(bullet, dict)]

    async def _remember_test_week(self, week: str) -> None:
        weeks = [str(item) for item in await self.config.test_weeks()]
        if week not in weeks:
            weeks.append(week)
            await self.config.test_weeks.set(weeks)

    async def post_test_review(self, week: str) -> None:
        channel = await self._channel(self.review_channel_id)
        if channel is None:
            raise RuntimeError("Review channel is not available.")
        bullets = await self.create_test_preview(week)
        content = self._test_banner(updates_message(week, bullets, self.page_url))
        view = TestPreviewView(self, week)
        self.bot.add_view(view)
        await channel.send(content, view=view, allowed_mentions=discord.AllowedMentions.none())
        await self._remember_test_week(week)

    async def refresh_test_message(self, interaction: discord.Interaction, week: str) -> None:
        """Rewrite the test headlines in place. The buttons stay on the message."""
        bullets = await self.create_test_preview(week)
        content = self._test_banner(updates_message(week, bullets, self.page_url))
        view = TestPreviewView(self, week)
        self.bot.add_view(view)
        message = interaction.message
        if message is None:
            return
        try:
            await message.edit(content=content, view=view)
        except discord.HTTPException:
            logger.exception("Could not refresh the test message")

    async def post_test_denial(
        self,
        interaction: discord.Interaction,
        week: str,
        feedback: str,
    ) -> None:
        """Rewrite the whole test note from feedback. The week is not postponed."""
        try:
            result = await self.submit_feedback(week, feedback)
        except Exception as exc:
            await interaction.followup.send(
                f"Could not rewrite the note: {exc}",
                ephemeral=True,
            )
            return
        try:
            await self.refresh_test_message(interaction, week)
        except Exception:
            logger.exception("Rewrote %s but the test message was not refreshed", week)
        changed = int(result.get("changed") or 0)
        if changed:
            await interaction.followup.send(
                "Rewrote the note from that feedback. Deny again if it is still not right. "
                "Nothing was posted in #updates.",
                ephemeral=True,
            )
            return
        await interaction.followup.send(
            "Nothing in the note changed from that feedback.",
            ephemeral=True,
        )

    async def _poll_job(self, job_id: str, *, timeout: float = 360) -> Optional[dict]:
        """Poll a queued rewrite or sort job every three seconds."""
        deadline = asyncio.get_running_loop().time() + timeout
        while True:
            status, text, data = await self.api_request(
                "GET", f"/patchnotes/staff/jobs/{job_id}"
            )
            if status != 200 or not isinstance(data, dict) or not isinstance(data.get("job"), dict):
                raise RuntimeError(f"Could not load rewrite job: HTTP {status} {(text or '')[:200]}")
            job = data["job"]
            state = str(job.get("status") or "")
            if state in {"done", "failed"}:
                return data
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                return None
            await asyncio.sleep(min(3, remaining))

    async def submit_feedback(self, week: str, feedback: str) -> dict:
        """Queue feedback and return its completed job response."""
        status, text, data = await self.api_request(
            "POST",
            f"/patchnotes/staff/weeks/{week}/feedback",
            {"feedback": feedback},
        )
        if status == 409:
            raise RuntimeError("A rewrite is already running for this week.")
        if status != 202 or not isinstance(data, dict) or not isinstance(data.get("job"), dict):
            raise RuntimeError(_api_detail(data, text))
        job_id = str(data["job"].get("id") or "")
        if not job_id:
            raise RuntimeError("The API did not return a rewrite job id.")
        result = await self._poll_job(job_id)
        if result is None:
            raise RuntimeError("The rewrite is still running. The review page will show it.")
        job = result.get("job")
        if not isinstance(job, dict):
            raise RuntimeError("The API returned an invalid rewrite job.")
        if job.get("status") != "done":
            raise RuntimeError(str(job.get("error") or "The rewrite failed.")[:300])
        result["changed"] = job.get("changed")
        return result

    async def sort_week(self, week: str) -> str:
        """Queue a sort, wait for its result, and return its outcome."""
        try:
            status, text, data = await self.api_request(
                "POST", f"/patchnotes/staff/weeks/{week}/sort"
            )
        except Exception:
            logger.exception("Could not start sort for %s; posting the review anyway", week)
            return "failed"
        if status in (409, 422):
            return "skipped"
        if status != 202 or not isinstance(data, dict) or not isinstance(data.get("job"), dict):
            logger.warning("Could not start sort for %s: %s", week, _api_detail(data, text))
            return "failed"
        job_id = str(data["job"].get("id") or "")
        if not job_id:
            logger.warning("Sort for %s returned no job id", week)
            return "failed"
        try:
            result = await self._poll_job(job_id)
        except Exception:
            logger.exception("Could not poll sort job for %s", week)
            return "failed"
        if result is None:
            logger.warning("Sort for %s timed out; posting the review anyway", week)
            return "timeout"
        job = result.get("job")
        if not isinstance(job, dict) or job.get("status") != "done":
            error = str(job.get("error") or "unknown error") if isinstance(job, dict) else "invalid response"
            logger.warning("Sort for %s failed: %s", week, error[:300])
            return "failed"
        return "done"

    def _review_allowed(self, mention: str | None) -> discord.AllowedMentions:
        if mention and self.staff_role_id:
            return discord.AllowedMentions(
                everyone=False,
                users=False,
                roles=[discord.Object(id=self.staff_role_id)],
            )
        return discord.AllowedMentions.none()

    def _prepare_review_lines(self, bullets: list[dict]) -> list[dict]:
        prepared: list[dict] = []
        for bullet in bullets:
            if not isinstance(bullet, dict):
                continue
            item = dict(bullet)
            if not str(item.get("warning") or "").strip():
                warning = hidden_knowledge_warning(str(item.get("body") or ""))
                if warning:
                    item["warning"] = warning
            prepared.append(item)
        return prepared

    async def post_week_review(
        self,
        week: str,
        *,
        bullets: list[dict] | None = None,
        ping: bool = False,
        rewritten: bool = False,
    ) -> None:
        """Post one review message for every line in the week."""
        channel = await self._channel(self.review_channel_id)
        if channel is None:
            raise RuntimeError("Review channel is not available.")
        if bullets is None:
            bullets = await self.preview_bullets(week)
        prepared = self._prepare_review_lines(bullets)
        mention = f"<@&{self.staff_role_id}>" if ping and self.staff_role_id else None
        content, description = review_parts(
            review_notice(
                week,
                bullets=prepared,
                mention=mention,
                rewritten=rewritten,
                page_url=self.page_url,
            ),
            prepared,
        )
        embed = discord.Embed(
            title=week_label(week)[:256],
            description=description[:4096],
            colour=discord.Color.orange(),
        )
        embed.set_footer(text=f"{len(prepared)} lines")
        view = WeekReviewView(self, week)
        self.bot.add_view(view)
        message = await channel.send(
            content,
            embed=embed,
            view=view,
            allowed_mentions=self._review_allowed(mention),
        )
        bundles = dict(await self.config.review_bundles())
        bundles[week] = message.id
        await self.config.review_bundles.set(bundles)
        posted = list(await self.config.posted_ids())
        for bullet in prepared:
            bullet_id = str(bullet.get("id") or "").strip()
            if bullet_id and bullet_id not in posted:
                posted.append(bullet_id)
        await self.config.posted_ids.set(posted)
        logger.info("Posted the %s review with %s lines", week, len(prepared))

    async def retire_review_message(self, week: str) -> None:
        """Remove the buttons from the current review message for this week."""
        bundles = dict(await self.config.review_bundles())
        message_id = bundles.get(week)
        if not message_id:
            return
        channel = await self._channel(self.review_channel_id)
        if channel is None:
            return
        try:
            message = await channel.fetch_message(int(message_id))
            await message.edit(view=None)
        except discord.HTTPException:
            logger.exception("Could not remove the review buttons for %s", week)

    async def _clear_message_buttons(self, message: Optional[discord.Message]) -> None:
        if message is None:
            return
        try:
            await message.edit(view=None)
        except discord.HTTPException:
            logger.exception("Could not remove the review buttons")

    async def post_week_denial(
        self,
        interaction: discord.Interaction,
        week: str,
        feedback: str,
    ) -> None:
        """Rewrite the whole note from feedback, then post that note again."""
        try:
            post = await self.fetch_post(week)
        except Exception:
            logger.exception("Could not load the post for %s; rewriting the lines", week)
            post = None
        if self.post_ready(post):
            await self.post_post_denial(interaction, week, feedback)
            return
        try:
            data = await self.submit_feedback(week, feedback)
        except Exception as exc:
            await interaction.followup.send(
                f"Could not rewrite the note: {exc}",
                ephemeral=True,
            )
            return
        job = data.get("job") if isinstance(data.get("job"), dict) else {}
        changed = int(job.get("changed") or 0)
        if not changed:
            await interaction.followup.send(
                "Nothing in the note changed from that feedback.",
                ephemeral=True,
            )
            return
        await self._clear_message_buttons(interaction.message)
        await self.retire_review_message(week)
        bullets = data.get("bullets") if isinstance(data.get("bullets"), list) else None
        try:
            await self.post_week_review(week, bullets=bullets, ping=False, rewritten=True)
        except Exception:
            logger.exception("Rewrote %s but the updated note was not posted", week)
            await interaction.followup.send(
                "Rewrote the note, but the updated message could not be posted.",
                ephemeral=True,
            )
            return
        published = {str(item) for item in await self.config.published_weeks()}
        messages = dict(await self.config.week_messages())
        if week in published or week in messages:
            try:
                await self.publish_week(week, ping=False)
            except Exception:
                logger.exception("Rewrote %s but the public update was not refreshed", week)
        await interaction.followup.send(
            "Rewrote the note from that feedback. The updated note is in the review channel. "
            "Deny again if it is still not right.",
            ephemeral=True,
        )

    async def post_post_denial(self, interaction: discord.Interaction, week: str, feedback: str) -> None:
        """Rewrite the weekly post from feedback and show the new version for review."""
        try:
            post = await self.submit_post_feedback(week, feedback)
        except Exception as exc:
            await interaction.followup.send(f"Could not rewrite the post: {exc}", ephemeral=True)
            return
        await self._clear_message_buttons(interaction.message)
        await self.retire_review_message(week)
        try:
            await self.post_post_review(week, post, ping=False, rewritten=True)
        except Exception:
            logger.exception("Rewrote the %s post but the review was not posted", week)
            await interaction.followup.send(
                "Rewrote the post, but the new version could not be posted for review.",
                ephemeral=True,
            )
            return
        if week in dict(await self.config.week_post_messages()):
            try:
                await self.publish_post(week, post, ping=False)
            except Exception:
                logger.exception("Rewrote %s but #updates was not refreshed", week)
        await interaction.followup.send(
            "Rewrote the post from that feedback. The new version is in the review channel. "
            "Deny again if it is still not right.",
            ephemeral=True,
        )

    async def deny_from_bullet(
        self,
        interaction: discord.Interaction,
        bullet_id: str,
        feedback: str,
    ) -> None:
        """A deny on an older per-line message still rewrites the whole week."""
        try:
            bullet = await self.fetch_bullet(bullet_id)
        except Exception as exc:
            await interaction.followup.send(str(exc)[:300], ephemeral=True)
            return
        week = str(bullet.get("week") or "").strip()
        if not week:
            await interaction.followup.send("That note has no week.", ephemeral=True)
            return
        await self.post_week_denial(interaction, week, feedback)

    async def approve_week_review(self, interaction: discord.Interaction, week: str) -> None:
        try:
            await self.auto_approve_week(week)
        except Exception as exc:
            await interaction.followup.send(str(exc)[:300], ephemeral=True)
            return
        await self.approve_post(week)
        try:
            due = publish_due(week, datetime.now(timezone.utc), self.zone)
        except ValueError:
            due = False
        published = {str(item) for item in await self.config.published_weeks()}
        messages = dict(await self.config.week_messages())
        if not due and week not in published and week not in messages:
            await interaction.followup.send(
                "Approved. These notes will go out at 18:00. Deny if something should still change.",
                ephemeral=True,
            )
            return
        try:
            await self.publish_week(week)
        except Exception:
            logger.exception("Approved %s but the weekly message was not updated", week)
            await interaction.followup.send(
                "Approved, but the weekly message could not be updated. "
                "Use `/patchnotes refresh` once the channel is reachable.",
                ephemeral=True,
            )
            return
        if week not in published:
            await self._mark_published(week)
        await interaction.followup.send(
            "Approved and posted to this week's update.",
            ephemeral=True,
        )

    async def _remember_week_flag(self, key: str, week: str) -> None:
        weeks = [str(item) for item in await getattr(self.config, key)()]
        if week not in weeks:
            weeks.append(week)
            await getattr(self.config, key).set(weeks)

    async def _forget_week_flag(self, key: str, week: str) -> None:
        weeks = [str(item) for item in await getattr(self.config, key)() if str(item) != week]
        await getattr(self.config, key).set(weeks)

    async def _restore_week_view(self, interaction: discord.Interaction, week: str) -> None:
        view = WeekReviewView(self, week)
        self.bot.add_view(view)
        if interaction.message is not None:
            try:
                await interaction.message.edit(view=view)
            except discord.HTTPException:
                logger.exception("Could not restore the review buttons")

    async def begin_week_postpone(self, interaction: discord.Interaction, week: str) -> None:
        try:
            state = await self.fetch_week_status(week)
        except Exception as exc:
            await interaction.followup.send(str(exc)[:300], ephemeral=True)
            return
        if state.get("postponed"):
            view = WeekUndoPostponeView(self, week)
            self.bot.add_view(view)
            await self._remember_week_flag("week_postpone_undo", week)
            if interaction.message is not None:
                await interaction.message.edit(view=view)
            await interaction.followup.send(
                "This week is already postponed. Use Undo postpone to take it back.",
                ephemeral=True,
            )
            return
        view = WeekPostponeConfirmView(self, week)
        self.bot.add_view(view)
        await self._remember_week_flag("week_postpone_confirm", week)
        if interaction.message is not None:
            await interaction.message.edit(view=view)
        await interaction.followup.send(
            "Confirm postpone to hold this week's notes until next week.",
            ephemeral=True,
        )

    async def cancel_week_postpone(self, interaction: discord.Interaction, week: str) -> None:
        await self._forget_week_flag("week_postpone_confirm", week)
        view = WeekReviewView(self, week)
        self.bot.add_view(view)
        await interaction.response.edit_message(view=view)

    async def confirm_week_postpone(self, interaction: discord.Interaction, week: str) -> None:
        status, text, data = await self.api_request(
            "POST", f"/patchnotes/staff/weeks/{week}/postpone"
        )
        if status != 200:
            await interaction.followup.send(
                f"Could not postpone that week: {_api_detail(data, text)}",
                ephemeral=True,
            )
            return
        await self._forget_week_flag("week_postpone_confirm", week)
        await self._remember_week_flag("week_postpone_undo", week)
        view = WeekUndoPostponeView(self, week)
        self.bot.add_view(view)
        if interaction.message is not None:
            try:
                await interaction.message.edit(view=view)
            except discord.HTTPException:
                logger.exception("Could not show the undo button")
        try:
            due = publish_due(week, datetime.now(timezone.utc), self.zone)
        except ValueError:
            due = False
        if not due:
            await interaction.followup.send(
                "Postponed. The updates channel will say so at 18:00. "
                "Use Undo postpone if this was a misclick.",
                ephemeral=True,
            )
            return
        try:
            await self.finish_postponement(week)
        except Exception:
            logger.exception("Postponed %s but the notice was not posted", week)
            await interaction.followup.send(
                "Postponed. The notice could not be posted yet; it will be retried.",
                ephemeral=True,
            )
            return
        await interaction.followup.send(
            "Postponed. The updates channel has the notice. Use Undo postpone to take it back.",
            ephemeral=True,
        )

    async def undo_week_postpone(self, interaction: discord.Interaction, week: str) -> None:
        status, text, data = await self.api_request(
            "POST", f"/patchnotes/staff/weeks/{week}/undo-postpone"
        )
        if status != 200:
            await interaction.followup.send(
                f"Could not undo that postponement: {_api_detail(data, text)}",
                ephemeral=True,
            )
            return
        await self._forget_week_flag("week_postpone_undo", week)
        notices = dict(await self.config.postponement_messages())
        notices.pop(week, None)
        await self.config.postponement_messages.set(notices)
        published = [item for item in await self.config.published_weeks() if str(item) != week]
        await self.config.published_weeks.set(published)
        await self._restore_week_view(interaction, week)
        try:
            due = publish_due(week, datetime.now(timezone.utc), self.zone)
        except ValueError:
            due = False
        if not due:
            await interaction.followup.send("Postpone undone.", ephemeral=True)
            return
        try:
            await self.auto_approve_week(week)
            await self.publish_week(week)
        except Exception:
            logger.exception("Undid the postponement for %s but the notes were not posted", week)
            await interaction.followup.send(
                "Postpone undone, but the notes could not be posted. "
                "Use `/patchnotes refresh` once the channel is reachable.",
                ephemeral=True,
            )
            return
        await self._mark_published(week)
        await interaction.followup.send(
            "Postpone undone. This week's notes were posted.",
            ephemeral=True,
        )

    async def _mark_published(self, week: str) -> None:
        published = [str(item) for item in await self.config.published_weeks()]
        if week not in published:
            published.append(week)
            await self.config.published_weeks.set(published)

    async def _publish_due_weeks(self, now: datetime, pending: list[dict]) -> None:
        reviewed = [str(item) for item in await self.config.review_posted_weeks()]
        published = {str(item) for item in await self.config.published_weeks()}
        pending_weeks = {
            str(bullet.get("week") or "").strip()
            for bullet in pending
            if isinstance(bullet, dict)
        }
        for week in reviewed:
            if not week or week in published:
                continue
            try:
                ready = publish_due(week, now, self.zone)
            except ValueError:
                logger.warning("Skipping publish for week %r", week)
                continue
            if not ready:
                continue
            try:
                state = await self.fetch_week_status(week)
            except Exception:
                logger.exception("Could not load the week status for %s", week)
                continue
            if state.get("postponed"):
                try:
                    await self.finish_postponement(week)
                except Exception:
                    logger.exception("Could not postpone %s", week)
                continue
            try:
                await self.auto_approve_week(week)
            except Exception:
                logger.exception("Could not auto-approve %s", week)
                continue
            try:
                bullets = await self.fetch_week(week)
            except Exception:
                logger.exception("Could not load approved notes for %s", week)
                continue
            if not bullets:
                if week not in pending_weeks:
                    await self._mark_published(week)
                continue
            try:
                await self.publish_week(week)
            except Exception:
                logger.exception("Could not post the weekly update for %s", week)
                continue
            await self._mark_published(week)

    async def _edit_review_message(
        self,
        interaction: discord.Interaction,
        bullet: dict,
        *,
        decision: str,
        reason: str = "",
    ) -> None:
        embed = self.build_review_embed(bullet, decision=decision, reason=reason)
        message = interaction.message
        if message is None:
            stored = dict(await self.config.review_messages())
            message_id = stored.get(str(bullet.get("id") or ""))
            channel = await self._channel(self.review_channel_id)
            if channel is None or not message_id:
                return
            try:
                message = await channel.fetch_message(int(message_id))
            except discord.HTTPException:
                return
        try:
            await message.edit(embed=embed, view=None)
        except discord.HTTPException:
            logger.exception("Could not update the review message")

    async def publish_week(self, week: str, *, ping: bool = True) -> None:
        # An API error raises here and is retried, so a glitch never posts the old format instead.
        post = await self.fetch_post(week)
        if self.post_ready(post):
            await self.publish_post(week, post, ping=ping)
            return
        bullets = await self.fetch_week(week)
        body = updates_message(week, bullets, self.page_url)
        channel = await self._channel(self.updates_channel_id)
        if channel is None:
            raise RuntimeError("Updates channel is not available.")
        messages = dict(await self.config.week_messages())
        message_id = messages.get(week)
        if message_id:
            try:
                message = await channel.fetch_message(int(message_id))
                await message.edit(
                    content=body,
                    allowed_mentions=discord.AllowedMentions.none(),
                )
                return
            except discord.NotFound:
                message_id = None
        announced = [str(item) for item in await self.config.announced_weeks()]
        mention = None
        if ping and week not in announced and self.update_ping_role_id:
            mention = f"<@&{self.update_ping_role_id}>"
        content = updates_message(week, bullets, self.page_url, mention=mention)
        allowed = (
            discord.AllowedMentions(
                everyone=False,
                users=False,
                roles=[discord.Object(id=self.update_ping_role_id)],
            )
            if mention
            else discord.AllowedMentions.none()
        )
        message = await channel.send(content, allowed_mentions=allowed)
        messages[week] = message.id
        await self.config.week_messages.set(messages)
        if week not in announced:
            announced.append(week)
            await self.config.announced_weeks.set(announced)

    async def apply_decision(
        self,
        interaction: discord.Interaction,
        bullet_id: str,
        *,
        deny_reason: Optional[str],
    ) -> None:
        if deny_reason is not None:
            await self.deny_from_bullet(interaction, bullet_id, deny_reason)
            return
        status, text, data = await self.api_request(
            "POST", f"/patchnotes/staff/bullets/{bullet_id}/approve"
        )
        decision = "Approved"
        if status == 409:
            await interaction.followup.send("That note was already reviewed.", ephemeral=True)
            return
        if status != 200 or not isinstance(data, dict):
            await interaction.followup.send(
                f"Could not {decision.lower()} that note: {_api_detail(data, text)}",
                ephemeral=True,
            )
            return
        await self._edit_review_message(
            interaction, data, decision=decision, reason=deny_reason or ""
        )
        week = str(data.get("week") or "")
        published = {str(item) for item in await self.config.published_weeks()}
        messages = dict(await self.config.week_messages())
        if week not in published and week not in messages:
            await interaction.followup.send(
                "Approved. It will go out with this week's patch notes.",
                ephemeral=True,
            )
            return
        try:
            await self.publish_week(week)
        except Exception:
            logger.exception("Approved %s but the weekly message was not updated", bullet_id)
            await interaction.followup.send(
                "Approved, but the weekly message could not be updated. "
                "Use `/patchnotes refresh` once the channel is reachable.",
                ephemeral=True,
            )
            return
        await interaction.followup.send("Approved and added to this week's update.", ephemeral=True)

    async def cog_app_command_error(
        self, interaction: discord.Interaction, error: app_commands.AppCommandError
    ):
        msg = "An unexpected error occurred."
        if isinstance(error, app_commands.CheckFailure):
            msg = "You need the Staff role to use this command."
        elif isinstance(error, app_commands.CommandInvokeError):
            msg = f"An error occurred: {error.original}"
            logger.error("patchnotes command error: %s", error, exc_info=True)
        if interaction.response.is_done():
            await interaction.followup.send(msg, ephemeral=True)
        else:
            await interaction.response.send_message(msg, ephemeral=True)

    @patchnotes.command(name="ping", description="Check the patch note API and staff key.")
    @app_commands.check(_has_staff)
    @app_commands.guild_only()
    async def ping(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        if not self.api_base_url or not self.staff_key:
            await interaction.followup.send(
                "api_base_url or staff_key is not set. See config.example.yml.",
                ephemeral=True,
            )
            return
        try:
            pending = await self.fetch_pending()
        except Exception as exc:
            await interaction.followup.send(str(exc)[:300], ephemeral=True)
            return
        await interaction.followup.send(
            f"API ok. {len(pending)} pending note(s).", ephemeral=True
        )

    @patchnotes.command(name="pending", description="List pending patch note bullets.")
    @app_commands.check(_has_staff)
    @app_commands.guild_only()
    async def pending_cmd(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        try:
            pending = await self.fetch_pending()
        except Exception as exc:
            await interaction.followup.send(str(exc)[:300], ephemeral=True)
            return
        if not pending:
            await interaction.followup.send("Nothing is waiting for review.", ephemeral=True)
            return
        lines = []
        for bullet in pending[:20]:
            lines.append(
                f"`{bullet.get('id')}` {bullet.get('section')} — {str(bullet.get('body') or '')[:80]}"
            )
        extra = f"\n…and {len(pending) - 20} more." if len(pending) > 20 else ""
        await interaction.followup.send(
            "\n".join(lines) + extra,
            ephemeral=True,
            allowed_mentions=discord.AllowedMentions.none(),
        )

    @patchnotes.command(
        name="test",
        description="Preview the unreleased week in the review channel and on the site for one hour.",
    )
    @app_commands.check(_has_staff)
    @app_commands.guild_only()
    async def test_cmd(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        try:
            week = await self.unreleased_week()
        except Exception as exc:
            await interaction.followup.send(str(exc)[:300], ephemeral=True)
            return
        try:
            await self.post_test_review(week)
        except Exception as exc:
            await interaction.followup.send(str(exc)[:300], ephemeral=True)
            return
        await interaction.followup.send(
            f"Posted headlines for {week_label(week)} in the review channel, "
            "with Approve, Deny, and Postpone. "
            "Postpone does not hold the week. "
            "The full note is on the updates page for staff and is removed after one hour.",
            ephemeral=True,
        )

    async def fetch_folders(self) -> list[dict]:
        status, text, data = await self.api_request("GET", "/patchnotes/staff/folders")
        if status != 200 or not isinstance(data, dict) or not isinstance(data.get("folders"), list):
            raise RuntimeError(f"Could not list folders: HTTP {status} {(text or '')[:200]}")
        return [folder for folder in data["folders"] if isinstance(folder, dict)]

    @patchnotes.command(name="folders", description="List plugin folders the watcher checks.")
    @app_commands.check(_has_staff)
    @app_commands.guild_only()
    async def folders_cmd(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        try:
            folders = await self.fetch_folders()
        except Exception as exc:
            await interaction.followup.send(str(exc)[:300], ephemeral=True)
            return
        await interaction.followup.send(
            folders_message(folders),
            ephemeral=True,
            allowed_mentions=discord.AllowedMentions.none(),
        )

    @patchnotes.command(name="folder-add", description="Watch a plugin folder on TFMCMain.")
    @app_commands.describe(name="Plugin folder name, such as Essentials")
    @app_commands.check(_has_staff)
    @app_commands.guild_only()
    async def folder_add_cmd(self, interaction: discord.Interaction, name: str):
        await interaction.response.defer(ephemeral=True)
        try:
            status, text, data = await self.api_request(
                "POST", "/patchnotes/staff/folders", {"name": name.strip()}
            )
        except Exception as exc:
            await interaction.followup.send(str(exc)[:300], ephemeral=True)
            return
        if status == 200 and isinstance(data, dict):
            await interaction.followup.send(
                f"`{data.get('name')}` will be checked on TFMCMain. "
                "If the folder exists, the first scan only remembers it.",
                ephemeral=True,
            )
            return
        detail = ""
        if isinstance(data, dict) and data.get("detail"):
            detail = str(data["detail"])
        elif text:
            detail = text[:200]
        await interaction.followup.send(
            detail or f"Could not add that folder (HTTP {status}).",
            ephemeral=True,
        )

    @patchnotes.command(name="folder-remove", description="Stop watching a folder staff added.")
    @app_commands.describe(name="Plugin folder name")
    @app_commands.check(_has_staff)
    @app_commands.guild_only()
    async def folder_remove_cmd(self, interaction: discord.Interaction, name: str):
        await interaction.response.defer(ephemeral=True)
        try:
            status, text, data = await self.api_request(
                "DELETE", f"/patchnotes/staff/folders/{name.strip()}", None
            )
        except Exception as exc:
            await interaction.followup.send(str(exc)[:300], ephemeral=True)
            return
        if status == 200 and isinstance(data, dict):
            await interaction.followup.send(
                f"Stopped watching `{data.get('removed')}`.",
                ephemeral=True,
            )
            return
        detail = str(data.get("detail")) if isinstance(data, dict) and data.get("detail") else (text or "")[:200]
        await interaction.followup.send(detail or f"Could not remove that folder (HTTP {status}).", ephemeral=True)

    @patchnotes.command(name="folder-track", description="Track another kind of yaml in a watched folder.")
    @app_commands.describe(name="Plugin folder name", glob="Rule such as vehicles/*.yml")
    @app_commands.check(_has_staff)
    @app_commands.guild_only()
    async def folder_track_cmd(self, interaction: discord.Interaction, name: str, glob: str):
        await interaction.response.defer(ephemeral=True)
        try:
            status, text, data = await self.api_request(
                "POST",
                f"/patchnotes/staff/folders/{name.strip()}/track",
                {"glob": glob.strip()},
            )
        except Exception as exc:
            await interaction.followup.send(str(exc)[:300], ephemeral=True)
            return
        if status == 200:
            await interaction.followup.send(
                f"`{name.strip()}` will also track `{glob.strip()}`.",
                ephemeral=True,
            )
            return
        detail = str(data.get("detail")) if isinstance(data, dict) and data.get("detail") else (text or "")[:200]
        await interaction.followup.send(detail or f"Could not add that rule (HTTP {status}).", ephemeral=True)

    @patchnotes.command(
        name="reset",
        description="Restore the original notes for the week that has not been posted yet.",
    )
    @app_commands.check(_has_staff)
    @app_commands.guild_only()
    async def reset_cmd(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        try:
            week = await self.unreleased_week()
        except Exception as exc:
            await interaction.followup.send(str(exc)[:300], ephemeral=True)
            return
        await interaction.followup.send(
            f"Clear the deny edits for {week_label(week)} and restore the original notes?",
            view=ResetConfirmView(self, week),
            ephemeral=True,
        )

    @patchnotes.command(name="sort", description="Sort and repost the week that is in review.")
    @app_commands.check(_has_staff)
    @app_commands.guild_only()
    async def sort_cmd(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        try:
            week = await self.unreleased_week()
            outcome = await self.sort_week(week)
            await self.retire_review_message(week)
            await self.post_week_review(week, ping=False)
        except Exception as exc:
            await interaction.followup.send(str(exc)[:300], ephemeral=True)
            return
        if outcome == "done":
            message = f"Sorted and reposted the review for {week_label(week)}."
        elif outcome == "skipped":
            message = f"No sort was started. Reposted the review for {week_label(week)}."
        else:
            message = f"The sort did not finish. Reposted the review for {week_label(week)}."
        await interaction.followup.send(message, ephemeral=True)

    @patchnotes.command(name="refresh", description="Rewrite a week's #updates message without pinging.")
    @app_commands.describe(week="ISO week, such as 2026-W39")
    @app_commands.check(_has_staff)
    @app_commands.guild_only()
    async def refresh_cmd(self, interaction: discord.Interaction, week: str):
        await interaction.response.defer(ephemeral=True)
        week = week.strip()
        try:
            await self.publish_week(week, ping=False)
        except Exception as exc:
            await interaction.followup.send(str(exc)[:300], ephemeral=True)
            return
        await interaction.followup.send(f"Updated the message for {week_label(week)}.", ephemeral=True)

    async def _command_week(self, week: Optional[str]) -> str:
        text = (week or "").strip()
        return text or await self.unreleased_week()

    @patchnotes.command(
        name="test-post",
        description="Send a test copy of a week's update post. No buttons, nobody is pinged.",
    )
    @app_commands.describe(
        week="ISO week, such as 2026-W41. Defaults to the week in review.",
        here="Send it in this channel instead of the review channel.",
    )
    @app_commands.check(_has_staff)
    @app_commands.guild_only()
    async def test_post_cmd(
        self, interaction: discord.Interaction, week: Optional[str] = None, here: bool = False
    ):
        await interaction.response.defer(ephemeral=True)
        try:
            week = await self._command_week(week)
            post = await self.fetch_post(week)
        except Exception as exc:
            await interaction.followup.send(str(exc)[:300], ephemeral=True)
            return
        if post is None:
            await interaction.followup.send(
                f"There is no server comparison for {week_label(week)} yet. "
                "It runs after the week closes on Friday at 12:00.",
                ephemeral=True,
            )
            return
        if not self.post_ready(post):
            await interaction.followup.send(
                f"The post for {week_label(week)} is still being written. Try again in a few minutes.",
                ephemeral=True,
            )
            return
        channel = interaction.channel if here else await self._channel(self.review_channel_id)
        if channel is None:
            await interaction.followup.send("Review channel is not available.", ephemeral=True)
            return
        try:
            await self.send_test_post(channel, week, post)
        except discord.HTTPException as exc:
            await interaction.followup.send(f"Could not send the test copy: {exc}"[:300], ephemeral=True)
            return
        await interaction.followup.send(
            f"Sent a test copy of {post_title(post)} to {getattr(channel, 'mention', 'the channel')}. "
            "Nothing was posted to #updates.",
            ephemeral=True,
        )

    @patchnotes.command(
        name="write-post",
        description="Write a week's update post again from the server changes, dropping earlier feedback.",
    )
    @app_commands.describe(week="ISO week, such as 2026-W41. Defaults to the week in review.")
    @app_commands.check(_has_staff)
    @app_commands.guild_only()
    async def write_post_cmd(self, interaction: discord.Interaction, week: Optional[str] = None):
        await interaction.response.defer(ephemeral=True)
        try:
            week = await self._command_week(week)
            post = await self.write_post(week)
        except Exception as exc:
            await interaction.followup.send(f"Could not write the post: {exc}"[:300], ephemeral=True)
            return
        await interaction.followup.send(
            f"Wrote {post_title(post)} with {len(post.get('messages') or [])} messages. "
            "Use `/patchnotes test-post` to read it. A review that is already posted is not replaced.",
            ephemeral=True,
        )

    @patchnotes.command(name="act", description="Title a week's update post with an act, on act change weeks.")
    @app_commands.describe(
        act="Such as Act 1. Leave empty to clear it.",
        week="ISO week, such as 2026-W41. Defaults to the week in review.",
    )
    @app_commands.check(_has_staff)
    @app_commands.guild_only()
    async def act_cmd(
        self, interaction: discord.Interaction, act: Optional[str] = None, week: Optional[str] = None
    ):
        await interaction.response.defer(ephemeral=True)
        try:
            week = await self._command_week(week)
            status, text, data = await self.api_request(
                "PUT", f"/patchnotes/staff/weeks/{week}/meta", {"act": (act or "").strip() or None}
            )
        except Exception as exc:
            await interaction.followup.send(str(exc)[:300], ephemeral=True)
            return
        if status != 200 or not isinstance(data, dict):
            await interaction.followup.send(f"Could not set the act: {_api_detail(data, text)}", ephemeral=True)
            return
        shown = data.get("act") or "no act"
        await interaction.followup.send(
            f"{week_label(week)} is now titled with {shown}. "
            "Use `/patchnotes write-post` to write the post again with it.",
            ephemeral=True,
        )
