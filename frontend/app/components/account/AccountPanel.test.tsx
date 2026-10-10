/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import AccountPanel from "./AccountPanel";
import {
  AccountApiError,
  getAccount,
  linkMinecraft,
  previewMinecraftLink,
  signOut,
  startMicrosoftLink,
  type Account,
} from "../../../lib/account/api";

vi.mock("../../../lib/account/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../lib/account/api")>(),
  getAccount: vi.fn(),
  previewMinecraftLink: vi.fn(),
  linkMinecraft: vi.fn(),
  signOut: vi.fn(),
  unlinkMinecraft: vi.fn(),
  startAccountPatreonLink: vi.fn(),
  startMicrosoftLink: vi.fn(),
}));

function account(overrides: Partial<Account> = {}): Account {
  return {
    user: {
      discord_user_id: "123",
      discord_username: "steve_tfmc",
      discord_global_name: "Steve",
      avatar_url: "https://cdn.discordapp.com/embed/avatars/0.png",
    },
    guild: { member: true, checked_at: "2026-10-05T07:00:00Z", fresh: true },
    minecraft: null,
    patreon: null,
    ...overrides,
  };
}

beforeEach(() => vi.stubEnv("NEXT_PUBLIC_API_URL", "https://www.tfminecraft.net/api"));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

it("offers Discord sign-in when signed out, with the callback notice", async () => {
  vi.mocked(getAccount).mockResolvedValue(null);
  render(<AccountPanel signin="expired" />);
  const link = await screen.findByRole("link", { name: "Sign in with Discord" });
  expect(link.getAttribute("href")).toBe(
    "https://www.tfminecraft.net/api/auth/discord/start?return_to=%2Faccount"
  );
  expect(screen.getByRole("alert").textContent).toContain("took too long");
});

it("says when sign-in is not configured", async () => {
  vi.mocked(getAccount).mockRejectedValue(new AccountApiError("discord_auth_disabled", 503));
  render(<AccountPanel signin={null} />);
  expect(await screen.findByText("Discord sign-in isn’t available yet.")).toBeTruthy();
});

it("shows an existing Minecraft link", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({
    minecraft: { player_uuid: "u", minecraft_name: "SteveMC", linked_at: "2026-09-01T00:00:00Z", in_grace: false, grace_until: null },
  }));
  render(<AccountPanel signin={null} />);
  expect((await screen.findByLabelText("Minecraft account")).textContent).toContain("SteveMC");
  expect(screen.getByRole("button", { name: "Unlink Minecraft account" })).toBeTruthy();
});

it("previews then links a code, naming both accounts", async () => {
  vi.mocked(getAccount).mockResolvedValueOnce(account()).mockResolvedValueOnce(account({
    minecraft: { player_uuid: "u", minecraft_name: "SteveMC", linked_at: "2026-10-05T07:01:00Z", in_grace: false, grace_until: null },
  }));
  vi.mocked(previewMinecraftLink).mockResolvedValue({ player_uuid: "u", minecraft_name: "SteveMC", expires_at: "z" });
  vi.mocked(linkMinecraft).mockResolvedValue(null);
  render(<AccountPanel signin={null} />);
  fireEvent.change(await screen.findByLabelText("Link code"), { target: { value: "abcd1234ef56" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect((await screen.findByText(/Link Minecraft account/)).textContent).toBe(
    "Link Minecraft account SteveMC to Discord @steve_tfmc?"
  );
  fireEvent.click(screen.getByRole("button", { name: "Link account" }));
  expect(await screen.findByRole("button", { name: "Unlink Minecraft account" })).toBeTruthy();
  expect(linkMinecraft).toHaveBeenCalledWith("abcd1234ef56");
});

it("asks for a fresh Discord check when the guild check is stale", async () => {
  vi.mocked(getAccount).mockResolvedValue(account());
  vi.mocked(previewMinecraftLink).mockResolvedValue({ player_uuid: "u", minecraft_name: "SteveMC", expires_at: "z" });
  vi.mocked(linkMinecraft).mockRejectedValue(new AccountApiError("guild_check_stale", 403));
  render(<AccountPanel signin={null} />);
  fireEvent.change(await screen.findByLabelText("Link code"), { target: { value: "ABCD-1234-EF56" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(await screen.findByRole("button", { name: "Link account" }));
  expect((await screen.findByRole("link", { name: "Confirm with Discord" })).getAttribute("href")).toContain(
    "/auth/discord/start"
  );
});

it("shows code errors from the server", async () => {
  vi.mocked(getAccount).mockResolvedValue(account());
  vi.mocked(previewMinecraftLink).mockRejectedValue(new AccountApiError("Link code has expired", 400));
  render(<AccountPanel signin={null} />);
  fireEvent.change(await screen.findByLabelText("Link code"), { target: { value: "ABCD-1234-EF56" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Link code has expired");
});

it("asks non-members to join the Discord first", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ guild: { member: false, checked_at: null, fresh: false } }));
  render(<AccountPanel signin={null} />);
  expect(await screen.findByRole("link", { name: "Join it" })).toBeTruthy();
  expect(screen.queryByLabelText("Link code")).toBeNull();
});

it("offers Patreon when enabled and unlinked", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ patreon: { linked: false } }));
  render(<AccountPanel signin={null} />);
  expect(await screen.findByRole("button", { name: "Connect Patreon" })).toBeTruthy();
});

it("shows a cancelled re-check notice while still signed in", async () => {
  vi.mocked(getAccount).mockResolvedValue(account());
  render(<AccountPanel signin="denied" />);
  expect((await screen.findByRole("alert")).textContent).toBe("Discord sign-in was cancelled.");
});

it("explains a failed sign-out that left the session active", async () => {
  vi.mocked(getAccount).mockResolvedValue(account());
  vi.mocked(signOut).mockRejectedValue(new Error("offline"));
  render(<AccountPanel signin={null} />);
  fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
  expect((await screen.findByRole("alert")).textContent).toBe("We couldn’t sign you out just now. Please try again.");
});

it("returns to signed out after signing out", async () => {
  vi.mocked(getAccount).mockResolvedValueOnce(account()).mockResolvedValueOnce(null);
  vi.mocked(signOut).mockResolvedValue({ ok: true });
  render(<AccountPanel signin={null} />);
  fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
  expect(await screen.findByRole("link", { name: "Sign in with Discord" })).toBeTruthy();
});

it("shows the grace deadline with a time", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({
    minecraft: { player_uuid: "u", minecraft_name: "SteveMC", linked_at: "2026-09-01T00:00:00Z", in_grace: true, grace_until: "2026-10-05T08:30:00Z" },
  }));
  render(<AccountPanel signin={null} />);
  const text = (await screen.findByText(/You’ve left the TFMC Discord/)).textContent || "";
  expect(text).toMatch(/\d{1,2}:\d{2}/);
});

it("lists Discord, Minecraft and Patreon as steps with their status", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({
    minecraft: { player_uuid: "u", minecraft_name: "SteveMC", linked_at: "2026-09-01T00:00:00Z", in_grace: false, grace_until: null },
    patreon: { linked: false },
  }));
  render(<AccountPanel signin={null} />);
  const steps = within(await screen.findByRole("list", { name: "Connected accounts" })).getAllByRole("listitem");
  expect(steps.map((step) => step.getAttribute("aria-label"))).toEqual(["Discord account", "Minecraft account", "Patreon"]);
  expect(steps[0].textContent).toContain("Signed in");
  expect(steps[1].textContent).toContain("SteveMC");
  expect(steps[1].textContent).not.toContain("Mojang");
  expect(steps[2].textContent).toContain("Not connected");
});

it("says when Patreon linking is unavailable", async () => {
  vi.mocked(getAccount).mockResolvedValue(account());
  render(<AccountPanel signin={null} />);
  const row = await screen.findByLabelText("Patreon");
  expect(row.textContent).toContain("Unavailable");
  expect(row.textContent).not.toContain("isn’t available");
});

it("offers Microsoft first, with the in-game code as a fallback", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ microsoft_link: true }));
  vi.mocked(startMicrosoftLink).mockResolvedValue("https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?x=1");
  const assign = vi.fn();
  vi.stubGlobal("location", { ...window.location, assign });
  render(<AccountPanel signin={null} />);
  const row = await screen.findByLabelText("Minecraft account");
  expect(within(row).getByText("Or use a code from in game")).toBeTruthy();
  fireEvent.click(within(row).getByRole("button", { name: "Connect with Microsoft" }));
  await vi.waitFor(() => expect(assign).toHaveBeenCalledWith(
    "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?x=1"
  ));
  vi.unstubAllGlobals();
});

it("keeps only the code form when Microsoft is not set up", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ microsoft_link: false }));
  render(<AccountPanel signin={null} />);
  expect(await screen.findByLabelText("Link code")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Connect with Microsoft" })).toBeNull();
});

it("asks for a fresh Discord check before opening Microsoft", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ microsoft_link: true }));
  vi.mocked(startMicrosoftLink).mockRejectedValue(new AccountApiError("guild_check_stale", 403));
  render(<AccountPanel signin={null} />);
  fireEvent.click(await screen.findByRole("button", { name: "Connect with Microsoft" }));
  expect((await screen.findByRole("link", { name: "Confirm with Discord" })).getAttribute("href")).toContain(
    "/auth/discord/start"
  );
});

it("explains why a Microsoft link failed", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({ microsoft_link: true }));
  render(<AccountPanel signin={null} minecraft="no_java_profile" />);
  expect((await screen.findByRole("alert")).textContent).toContain("doesn’t own Minecraft: Java Edition");
});

it("confirms a Microsoft link from the account itself", async () => {
  vi.mocked(getAccount).mockResolvedValue(account({
    microsoft_link: true,
    minecraft: { player_uuid: "u", minecraft_name: "SteveMC", linked_at: "2026-10-10T09:00:00Z", in_grace: false, grace_until: null },
  }));
  render(<AccountPanel signin={null} minecraft="linked" />);
  expect((await screen.findByRole("status")).textContent).toBe("Linked with Microsoft.");
  expect(screen.queryByRole("alert")).toBeNull();
});
