/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import AdminPanel from "./AdminPanel";
import { AccountApiError } from "../../../lib/account/api";
import {
  canManage,
  changeRole,
  getAdminMe,
  getStaff,
  lookupAccounts,
  revokeSessions,
  type AdminAccount,
  type AdminMe,
} from "../../../lib/admin/api";

vi.mock("../../../lib/admin/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../lib/admin/api")>(),
  getAdminMe: vi.fn(),
  getStaff: vi.fn(),
  lookupAccounts: vi.fn(),
  changeRole: vi.fn(),
  revokeSessions: vi.fn(),
}));

const ADMIN: AdminMe = {
  user_id: 1,
  discord_username: "adam",
  role: "admin",
  capabilities: ["view_admin", "revoke_sessions", "change_role"],
  assignable_roles: ["player", "mod"],
};

function acct(user_id: number, name: string, role: AdminAccount["role"], minecraft: string | null = null): AdminAccount {
  return {
    user_id,
    discord_user_id: String(1000 + user_id),
    discord_username: name,
    discord_global_name: name.toUpperCase(),
    avatar_url: "https://cdn.discordapp.com/embed/avatars/0.png",
    role,
    minecraft_name: minecraft,
    created_at: "2026-10-01T00:00:00Z",
    last_login_at: "2026-10-05T00:00:00Z",
  };
}

beforeEach(() => vi.stubEnv("NEXT_PUBLIC_API_URL", "https://www.tfminecraft.net/api"));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

it.each([
  [401, "Sign in with Discord"],
  [403, "This page is for TFMC staff only."],
  [503, "The staff panel isn’t available yet."],
])("explains a %s from the server", async (status, text) => {
  vi.mocked(getAdminMe).mockRejectedValue(new AccountApiError("x", status));
  vi.mocked(getStaff).mockRejectedValue(new AccountApiError("x", status));
  render(<AdminPanel />);
  expect(await screen.findByText(text)).toBeTruthy();
});

it("lists staff and only offers actions on accounts below you", async () => {
  vi.mocked(getAdminMe).mockResolvedValue(ADMIN);
  vi.mocked(getStaff).mockResolvedValue([acct(9, "rory", "root"), acct(1, "adam", "admin"), acct(5, "mona", "mod", "MonaMC")]);
  render(<AdminPanel />);
  const staff = await screen.findByRole("region", { name: "Staff" });
  expect(within(staff).getByLabelText("rory").textContent).not.toContain("Change role");
  expect(within(staff).getByLabelText("adam").textContent).toContain("(you)");
  expect(within(staff).getByLabelText("adam").textContent).not.toContain("Sign out everywhere");
  const mona = within(staff).getByLabelText("mona");
  expect(mona.textContent).toContain("Minecraft MonaMC");
  expect(within(mona).getByRole("button", { name: "Change role" })).toBeTruthy();
});

it("changes a role with a reason and reloads", async () => {
  vi.mocked(getAdminMe).mockResolvedValue(ADMIN);
  vi.mocked(getStaff).mockResolvedValue([]);
  vi.mocked(lookupAccounts).mockResolvedValue([acct(7, "pat", "player")]);
  vi.mocked(changeRole).mockResolvedValue({ ok: true });
  render(<AdminPanel />);
  fireEvent.change(await screen.findByLabelText("Discord username, display name or ID"), { target: { value: "pat" } });
  fireEvent.click(screen.getByRole("button", { name: "Find" }));
  const pat = await screen.findByLabelText("pat");
  fireEvent.click(within(pat).getByRole("button", { name: "Change role" }));
  const save = within(pat).getByRole("button", { name: "Make Moderator" }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  fireEvent.change(within(pat).getByLabelText("Reason (recorded)"), { target: { value: "Helps run events" } });
  fireEvent.click(save);
  await vi.waitFor(() => expect(getStaff).toHaveBeenCalledTimes(2));
  expect(changeRole).toHaveBeenCalledWith(7, "mod", "Helps run events");
});

it("shows the server's refusal in plain words", async () => {
  vi.mocked(getAdminMe).mockResolvedValue({ ...ADMIN, role: "mod", capabilities: ["view_admin", "revoke_sessions"], assignable_roles: [] });
  vi.mocked(getStaff).mockResolvedValue([]);
  vi.mocked(lookupAccounts).mockResolvedValue([acct(7, "pat", "player")]);
  vi.mocked(revokeSessions).mockRejectedValue(new AccountApiError("target_outranks_you", 403));
  render(<AdminPanel />);
  fireEvent.change(await screen.findByLabelText("Discord username, display name or ID"), { target: { value: "pat" } });
  fireEvent.click(screen.getByRole("button", { name: "Find" }));
  const pat = await screen.findByLabelText("pat");
  expect(within(pat).queryByRole("button", { name: "Change role" })).toBeNull();
  fireEvent.click(within(pat).getByRole("button", { name: "Sign out everywhere" }));
  fireEvent.change(within(pat).getByLabelText("Reason (recorded)"), { target: { value: "Shared login" } });
  fireEvent.click(within(pat).getByRole("button", { name: "Sign out everywhere" }));
  expect((await within(pat).findByRole("alert")).textContent).toBe("You can only change accounts below your own role.");
});

it("mirrors the rank rule", () => {
  expect(canManage(ADMIN, acct(2, "x", "mod"))).toBe(true);
  expect(canManage(ADMIN, acct(2, "x", "admin"))).toBe(false);
  expect(canManage(ADMIN, acct(1, "adam", "player"))).toBe(false);
});

it("offers the account's new choices after a role change", async () => {
  vi.mocked(getAdminMe).mockResolvedValue(ADMIN);
  vi.mocked(getStaff).mockResolvedValue([]);
  vi.mocked(lookupAccounts)
    .mockResolvedValueOnce([acct(7, "pat", "player")])
    .mockResolvedValue([acct(7, "pat", "mod")]);
  vi.mocked(changeRole).mockResolvedValue({ ok: true });
  render(<AdminPanel />);
  fireEvent.change(await screen.findByLabelText("Discord username, display name or ID"), { target: { value: "pat" } });
  fireEvent.click(screen.getByRole("button", { name: "Find" }));
  let pat = await screen.findByLabelText("pat");
  fireEvent.click(within(pat).getByRole("button", { name: "Change role" }));
  fireEvent.change(within(pat).getByLabelText("Reason (recorded)"), { target: { value: "Helps run events" } });
  fireEvent.click(within(pat).getByRole("button", { name: "Make Moderator" }));
  await vi.waitFor(() => expect(lookupAccounts).toHaveBeenCalledTimes(2));
  pat = await screen.findByLabelText("pat");
  await vi.waitFor(() => expect(pat.textContent).toContain("Moderator"));
  fireEvent.click(within(pat).getByRole("button", { name: "Change role" }));
  expect(within(pat).getByRole("button", { name: "Make Player" })).toBeTruthy();
  fireEvent.change(within(pat).getByLabelText("Reason (recorded)"), { target: { value: "Stepped back" } });
  fireEvent.click(within(pat).getByRole("button", { name: "Make Player" }));
  await vi.waitFor(() => expect(changeRole).toHaveBeenLastCalledWith(7, "player", "Stepped back"));
});

it("tells a failed search apart from no match", async () => {
  vi.mocked(getAdminMe).mockResolvedValue(ADMIN);
  vi.mocked(getStaff).mockResolvedValue([]);
  vi.mocked(lookupAccounts).mockRejectedValue(new Error("offline"));
  render(<AdminPanel />);
  fireEvent.change(await screen.findByLabelText("Discord username, display name or ID"), { target: { value: "pat" } });
  fireEvent.click(screen.getByRole("button", { name: "Find" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Something went wrong. Please try again.");
  expect(screen.queryByText("No account matches that.")).toBeNull();
});

it("returns to the sign-in prompt when the session ends mid-search", async () => {
  vi.mocked(getAdminMe).mockResolvedValueOnce(ADMIN).mockRejectedValue(new AccountApiError("not_signed_in", 401));
  vi.mocked(getStaff).mockResolvedValue([]);
  vi.mocked(lookupAccounts).mockRejectedValue(new AccountApiError("not_signed_in", 401));
  render(<AdminPanel />);
  fireEvent.change(await screen.findByLabelText("Discord username, display name or ID"), { target: { value: "pat" } });
  fireEvent.click(screen.getByRole("button", { name: "Find" }));
  expect(await screen.findByText("Sign in with Discord")).toBeTruthy();
});
