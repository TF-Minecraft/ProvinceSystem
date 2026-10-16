/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ControlDialog, ControlNotice, ServerActions, useServerControls } from "./ServerControls";
import {
  getControl,
  planServer,
  serverAction,
  type ServerJob,
  type ServerPlan,
} from "../../../lib/admin/serverControl";

vi.mock("../../../lib/admin/serverControl", async (original) => ({
  ...(await original<typeof import("../../../lib/admin/serverControl")>()),
  getControl: vi.fn(),
  planServer: vi.fn(),
  serverAction: vi.fn(),
}));
function ServerControls({ onComplete }: { onComplete: () => void }) {
  const control = useServerControls(onComplete);
  return (
    <>
      <ServerActions control={control} server="main" />
      <ServerActions control={control} server="dev" />
      <ControlNotice control={control} />
      <ControlDialog control={control} />
    </>
  );
}
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const plan: ServerPlan = {
  id: "a".repeat(32),
  server: "main",
  mode: "latest",
  expires_at: Date.now() / 1000 + 600,
  changes: [
    { repo: "Cooking", old_version: "1.0.0", version: "2.0.0", asset: "cooking-2.0.0.jar" },
    { repo: "TLibs", old_version: "2.2.0", version: "2.3.1", asset: "tlibs-2.3.1.jar", test_build: true },
  ],
  activation: [],
  skipped: [{ repo: "Gathering", reason: "not_verified_on_dev" }],
  last_backup_at: null,
  backup: true,
};
const job: ServerJob = {
  id: plan.id,
  server: "main",
  phase: "countdown",
  deadline: Date.now() / 1000 + 300,
  maintenance_started: false,
  error: null,
  changes: plan.changes,
  activation: [],
};

it("shows setup status and does not expose actions without a connection", async () => {
  vi.mocked(getControl).mockResolvedValue({ status: "control_not_configured", jobs: [] });
  render(<ServerControls onComplete={vi.fn()} />);
  await screen.findByText(/need the host connection/);
  expect(screen.queryByRole("button", { name: "Restart Main" })).toBeNull();
});

it("reviews changes and skips, and requires a Main reason before starting", async () => {
  vi.mocked(getControl).mockResolvedValue({ status: "available", jobs: [], allowed_servers: ["main", "dev"] });
  vi.mocked(planServer).mockResolvedValue(plan);
  vi.mocked(serverAction).mockResolvedValue(job);
  render(<ServerControls onComplete={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Update and restart Main" }));
  const dialog = await screen.findByRole("dialog", { name: /Main\?$/ });
  expect(within(dialog).getByText("Cooking")).toBeTruthy();
  expect(within(dialog).getByText("not run on Dev yet")).toBeTruthy();
  expect((within(dialog).getByRole("checkbox", { name: /TLibs/ }) as HTMLInputElement).checked).toBe(true);
  const start = within(dialog).getByRole("button", { name: "Start Main countdown" }) as HTMLButtonElement;
  expect(start.disabled).toBe(true);
  expect(within(dialog).getByText(/fresh backup during the countdown.*Last AMP backup: not recorded\./)).toBeTruthy();
  fireEvent.change(within(dialog).getByLabelText(/^Reason/), { target: { value: "publish tested cooking" } });
  expect(start.disabled).toBe(false);
  fireEvent.click(start);
  await waitFor(() =>
    expect(serverAction).toHaveBeenCalledWith("main", "start", plan.id, "publish tested cooking", false, ["TLibs"]),
  );
});

it("Dev socket only offers Dev controls", async () => {
  vi.mocked(getControl).mockResolvedValue({ status: "available", jobs: [], allowed_servers: ["dev"] });
  render(<ServerControls onComplete={vi.fn()} />);
  await screen.findByRole("button", { name: "Restart Dev" });
  expect(screen.queryByRole("button", { name: "Restart Main" })).toBeNull();
});

it("asks for a cancellation reason before issuing the action", async () => {
  vi.mocked(getControl).mockResolvedValue({ status: "available", jobs: [job] });
  vi.mocked(serverAction).mockResolvedValue({ ...job, phase: "cancelled" });
  render(<ServerControls onComplete={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Cancel Main restart" }));
  const dialog = screen.getByRole("dialog", { name: "Cancel the Main restart?" });
  const button = within(dialog).getByRole("button", { name: "Cancel restart" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  expect(serverAction).not.toHaveBeenCalled();
  fireEvent.change(within(dialog).getByLabelText(/^Reason/), { target: { value: "Players need more time" } });
  fireEvent.click(button);
  await waitFor(() =>
    expect(serverAction).toHaveBeenCalledWith("main", "cancel", job.id, "Players need more time", false, []),
  );
});

it("Main release upgrades require a feature review before reopening", async () => {
  vi.mocked(getControl).mockResolvedValue({
    status: "available",
    jobs: [{ ...job, phase: "awaiting_review", maintenance_started: true }],
  });
  vi.mocked(serverAction).mockResolvedValue({ ...job, phase: "complete" });
  render(<ServerControls onComplete={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Recheck and reopen Main" }));
  const dialog = screen.getByRole("dialog", { name: "Reopen Main?" });
  expect(within(dialog).getByText(/checked the changed features/)).toBeTruthy();
  fireEvent.change(within(dialog).getByLabelText(/^Reason/), {
    target: { value: "Verified recipes and persisted character data" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Reopen Main" }));
  await waitFor(() =>
    expect(serverAction).toHaveBeenCalledWith(
      "main",
      "reopen",
      job.id,
      "Verified recipes and persisted character data",
      false,
      [],
    ),
  );
});

it("Dev confirms an instant restart without an override or backup note", async () => {
  vi.mocked(getControl).mockResolvedValue({ status: "available", jobs: [], allowed_servers: ["dev"] });
  vi.mocked(planServer).mockResolvedValue({ ...plan, server: "dev", mode: "restart" });
  vi.mocked(serverAction).mockResolvedValue({ ...job, server: "dev", phase: "installing" });
  render(<ServerControls onComplete={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Restart Dev" }));
  const dialog = await screen.findByRole("dialog", { name: "Restart Dev?" });
  expect(within(dialog).getByText(/Dev restarts as soon as you confirm/)).toBeTruthy();
  expect(within(dialog).queryByRole("checkbox", { name: /Emergency/ })).toBeNull();
  expect(within(dialog).queryByText(/AMP backup/)).toBeNull();
  fireEvent.change(within(dialog).getByLabelText(/^Reason/), { target: { value: "Dev test restart" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Restart Dev now" }));
  await waitFor(() =>
    expect(serverAction).toHaveBeenCalledWith("dev", "start", plan.id, "Dev test restart", false, []),
  );
});

it("Main emergency override is unchecked by default and is explicit in the action", async () => {
  vi.mocked(getControl).mockResolvedValue({ status: "available", jobs: [], allowed_servers: ["main", "dev"] });
  vi.mocked(planServer).mockResolvedValue(plan);
  vi.mocked(serverAction).mockResolvedValue({ ...job, phase: "installing", emergency_override: true });
  render(<ServerControls onComplete={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Update and restart Main" }));
  const dialog = await screen.findByRole("dialog", { name: /Main\?$/ });
  const override = within(dialog).getByRole("checkbox", { name: /Emergency/ }) as HTMLInputElement;
  expect(override.checked).toBe(false);
  fireEvent.click(override);
  const start = within(dialog).getByRole("button", { name: "Restart Main now" }) as HTMLButtonElement;
  expect(start.disabled).toBe(true);
  expect(within(dialog).getByText(/skips the fresh backup/)).toBeTruthy();
  fireEvent.change(within(dialog).getByLabelText(/^Reason/), { target: { value: "Emergency rollback fix" } });
  fireEvent.click(start);
  await waitFor(() =>
    expect(serverAction).toHaveBeenCalledWith("main", "start", plan.id, "Emergency rollback fix", true, ["TLibs"]),
  );
});

it("warns that a plain Main restart activating staged plugins needs feature review", async () => {
  vi.mocked(getControl).mockResolvedValue({ status: "available", jobs: [], allowed_servers: ["main", "dev"] });
  vi.mocked(planServer).mockResolvedValue({
    ...plan,
    mode: "restart",
    changes: [],
    activation: [{ name: "Cooking", loaded: "1.0.0", version: "2.0.0" }],
  });
  render(<ServerControls onComplete={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Restart Main" }));
  const dialog = await screen.findByRole("dialog", { name: /Main\?$/ });
  expect(within(dialog).getByText(/Main stays in maintenance after startup/)).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("checkbox", { name: /Emergency/ }));
  expect(within(dialog).getByText(/Main stays in maintenance after startup/)).toBeTruthy();
});

it("Dev keeps test builds unless staff choose to replace them", async () => {
  vi.mocked(getControl).mockResolvedValue({ status: "available", jobs: [], allowed_servers: ["dev"] });
  vi.mocked(planServer).mockResolvedValue({ ...plan, server: "dev", skipped: [] });
  vi.mocked(serverAction).mockResolvedValue({ ...job, server: "dev", phase: "installing" });
  render(<ServerControls onComplete={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Update and restart Dev" }));
  const dialog = await screen.findByRole("dialog", { name: "Update and restart Dev?" });
  const tlibs = within(dialog).getByRole("checkbox", { name: /TLibs/ }) as HTMLInputElement;
  expect(tlibs.checked).toBe(false);
  fireEvent.click(within(dialog).getByRole("button", { name: "Replace all" }));
  expect(tlibs.checked).toBe(true);
  fireEvent.change(within(dialog).getByLabelText(/^Reason/), { target: { value: "Back to releases" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Restart Dev now" }));
  await waitFor(() =>
    expect(serverAction).toHaveBeenCalledWith("dev", "start", plan.id, "Back to releases", false, ["TLibs"]),
  );
});

it("shows the countdown's AMP backup progress", async () => {
  vi.mocked(getControl).mockResolvedValue({
    status: "available",
    jobs: [{ ...job, backup: { title: "Before restart aaaaaaaa", state: "running" } }],
  });
  render(<ServerControls onComplete={vi.fn()} />);
  await screen.findByText("AMP backup running. The restart waits for it.");
});
