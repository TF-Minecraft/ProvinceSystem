"""Exercise real Red command definitions, Discord modals and HTTP identity lookups.

No Discord login is used; delivery calls are mocked and the API runs on localhost.
"""
import asyncio
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock

from aiohttp import web

sys.path.insert(0, str(Path(__file__).parent))
from minecraftban.minecraftban import MinecraftBan
from precedent.precedent import CaseLogModal, Precedent

PLAYER = "0f6c5a52-3b7e-4c39-9d1d-2a8f0e7b9c11"
DISCORD = 323456789012345678


def interaction():
    return SimpleNamespace(
        response=SimpleNamespace(defer=AsyncMock(), send_modal=AsyncMock(), send_message=AsyncMock()),
        followup=SimpleNamespace(send=AsyncMock()),
        user=SimpleNamespace(mention="<@423456789012345678>", display_name="Staff", roles=[]),
        guild=Mock(),
    )


class IdentityCommandsTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.data = {"linked": True, "discord_user_id": str(DISCORD), "player_uuid": PLAYER,
                     "minecraft_name": "CurrentName", "name_source": "coreprotect"}
        self.status = 200
        self.requests = []

        async def identity(request):
            self.requests.append((request.path, request.headers.get("X-Staff-Key")))
            return web.json_response(self.data, status=self.status)

        app = web.Application()
        app.router.add_get("/skins/discord/identity/{discord_id}", identity)
        self.runner = web.AppRunner(app)
        await self.runner.setup()
        site = web.TCPSite(self.runner, "127.0.0.1", 0)
        await site.start()
        self.base = f"http://127.0.0.1:{site._server.sockets[0].getsockname()[1]}"
        self.target = SimpleNamespace(id=DISCORD, mention=f"<@{DISCORD}>", display_name="NotTheirMcName", name="discord_handle")
        self.cog = MinecraftBan.__new__(MinecraftBan)
        self.cog.api_base_url, self.cog.staff_key = self.base, "test-staff"
        self.cog._send_warn_dm = AsyncMock(return_value="Sent")
        self.cog._send_ban_dm = AsyncMock(return_value="Sent")
        self.cog._set_banned_role = AsyncMock(return_value="Added")
        self.cog._post_log = AsyncMock()
        self.cog._api_post = AsyncMock(return_value=(200, {"id": "case"}))
        self.precedent = Precedent.__new__(Precedent)
        self.precedent.api_base_url, self.precedent.staff_key = self.base, "test-staff"
        self.precedent.member_is_staff = Mock(return_value=True)
        self.precedent.api_post = AsyncMock(return_value=(200, "", {"id": "case"}))

    async def asyncTearDown(self):
        await self.runner.cleanup()

    async def warn(self, **kwargs):
        event = interaction()
        await MinecraftBan.minecraftwarn.callback(self.cog, event, self.target, "Rule 1", **kwargs)
        return event

    async def test_warning_resolves_member_and_logs_uuid(self):
        event = await self.warn()
        self.assertEqual(self.requests, [(f"/skins/discord/identity/{DISCORD}", "test-staff")])
        event.response.defer.assert_awaited_once_with(ephemeral=True)
        self.cog._send_warn_dm.assert_awaited_once_with(self.target, "CurrentName", "Rule 1")
        log = self.cog._post_log.await_args.args[1]
        self.assertIn(PLAYER, [field.value for field in log.fields])
        payload = self.cog._api_post.await_args.args[1]
        self.assertEqual(payload["players"], ["CurrentName"])
        self.assertEqual(payload["participants"][0]["player_uuid"], PLAYER)
        self.assertEqual(payload["participants"][0]["discord_user_id"], str(DISCORD))

    async def test_ban_resolves_without_manual_username(self):
        event = interaction()
        await MinecraftBan.minecraftban.callback(self.cog, event, self.target, "Rule 1", "7 days")
        self.cog._send_ban_dm.assert_awaited_once_with(self.target, "CurrentName", "Rule 1", "7 days")
        self.cog._set_banned_role.assert_awaited_once()
        self.assertIn(PLAYER, [f.value for f in self.cog._post_log.await_args.args[1].fields])

    async def test_mismatched_manual_name_never_sends(self):
        event = await self.warn(username="SomeoneElse")
        self.cog._send_warn_dm.assert_not_awaited()
        self.cog._post_log.assert_not_awaited()
        self.assertIn("does not match", event.followup.send.await_args.args[0])

    async def test_unlinked_has_clear_instructions_and_explicit_fallback(self):
        self.data = {"linked": False, "discord_user_id": str(DISCORD), "player_uuid": None}
        event = await self.warn()
        self.cog._send_warn_dm.assert_not_awaited()
        self.assertIn("no Minecraft link", event.followup.send.await_args.args[0])
        await self.warn(username="UnlinkedSteve")
        self.cog._send_warn_dm.assert_awaited_once_with(self.target, "UnlinkedSteve", "Rule 1")
        self.assertIn("Unlinked (manual name)", [f.value for f in self.cog._post_log.await_args.args[1].fields])

    async def test_failed_lookup_cannot_fall_back_to_a_guessed_name(self):
        self.status = 503
        event = await self.warn(username="GuessedSteve")
        self.cog._send_warn_dm.assert_not_awaited()
        self.assertIn("unavailable", event.followup.send.await_args.args[0])

    async def test_timeout_never_sends_or_logs(self):
        self.cog._api_get = AsyncMock(side_effect=asyncio.TimeoutError)
        await self.warn()
        self.cog._send_warn_dm.assert_not_awaited()
        self.cog._api_post.assert_not_awaited()

    async def test_bad_or_wrong_account_response_never_sends(self):
        for change in ({"player_uuid": "garbage"}, {"discord_user_id": "423456789012345678"}, {"linked": "true"}):
            original = self.data.copy()
            self.data.update(change)
            await self.warn()
            self.cog._send_warn_dm.assert_not_awaited()
            self.data = original

    async def test_unlink_is_seen_on_next_command(self):
        await self.warn()
        self.cog._send_warn_dm.reset_mock()
        self.data = {"linked": False, "discord_user_id": str(DISCORD), "player_uuid": None}
        await self.warn()
        self.cog._send_warn_dm.assert_not_awaited()

    async def test_staff_lookup_is_private(self):
        event = interaction()
        await MinecraftBan.minecraftwho.callback(self.cog, event, self.target)
        self.assertTrue(event.followup.send.await_args.kwargs["ephemeral"])
        self.assertIn(PLAYER, [f.value for f in event.followup.send.await_args.kwargs["embed"].fields])

    def fill_modal(self, modal):
        for name, value in {"summary": "What happened", "rule": "1", "ruling": "a" * 300,
                            "punishment": "Warning"}.items():
            getattr(modal, name)._value = value

    async def test_selected_case_needs_no_player_name_and_stores_identifiers(self):
        event = interaction()
        await Precedent.case_log.callback(self.precedent, event, self.target)
        modal = event.response.send_modal.await_args.args[0]
        self.assertNotIn(modal.players, modal.children)
        self.fill_modal(modal)
        await modal.on_submit(interaction())
        payload = self.precedent.api_post.await_args.args[1]
        self.assertEqual(payload["players"], ["CurrentName"])
        self.assertEqual(payload["summary"], "What happened")
        self.assertEqual(payload["participants"][0]["player_uuid"], PLAYER)
        self.assertEqual(payload["participants"][0]["discord_user_id"], str(DISCORD))
        self.assertLessEqual(len(payload["ruling"]), 500)

    async def test_case_still_records_discord_account_unlinked_before_submit(self):
        modal = CaseLogModal(self.precedent, self.target)
        self.fill_modal(modal)
        self.data = {"linked": False, "discord_user_id": str(DISCORD)}
        await modal.on_submit(interaction())
        payload = self.precedent.api_post.await_args.args[1]
        self.assertEqual(payload["participants"][0]["discord_user_id"], str(DISCORD))
        self.assertIsNone(payload["participants"][0]["player_uuid"])
        self.assertEqual(payload["players"], [self.target.display_name])

    async def test_case_rechecks_staff_permission(self):
        modal = CaseLogModal(self.precedent, self.target)
        self.fill_modal(modal)
        self.precedent.member_is_staff.return_value = False
        await modal.on_submit(interaction())
        self.precedent.api_post.assert_not_awaited()
        self.assertEqual(self.requests, [])

    async def test_manual_case_keeps_multiple_player_workflow(self):
        modal = CaseLogModal(self.precedent)
        self.fill_modal(modal)
        modal.players._value = "First, Second"
        await modal.on_submit(interaction())
        payload = self.precedent.api_post.await_args.args[1]
        self.assertEqual(payload["players"], ["First", "Second"])
        self.assertEqual(self.requests, [])

    async def test_notification_outbox_does_not_require_lookup(self):
        self.cog.bot = SimpleNamespace(fetch_user=AsyncMock(return_value=self.target), guilds=[Mock()])
        result = await self.cog._deliver_notice("warn", str(DISCORD), {"minecraft_name": "ServerSteve", "reason": "Rule 1"})
        self.assertTrue(result)
        self.assertEqual(self.requests, [])
        self.cog._send_warn_dm.assert_awaited_once_with(self.target, "ServerSteve", "Rule 1")

    def test_command_contracts_and_permissions(self):
        for name in ("minecraftban", "minecraftwarn"):
            command = getattr(MinecraftBan, name)
            self.assertFalse(next(p for p in command.parameters if p.name == "username").required)
            self.assertTrue(command.guild_only)
            self.assertIn(MinecraftBan.has_staff_or_helper, [getattr(check, "__func__", check) for check in command.checks])
        self.assertTrue(MinecraftBan.minecraftwho.guild_only)
        self.assertTrue(Precedent.case_log.guild_only)
        self.cog.staff_role_id, self.cog.helper_role_id = 1, 2
        event = interaction()
        self.assertFalse(self.cog.member_is_staff_or_helper(event))
        event.user.roles = [event.guild.get_role(1)]
        self.assertTrue(self.cog.member_is_staff_or_helper(event))


if __name__ == "__main__":
    unittest.main()
