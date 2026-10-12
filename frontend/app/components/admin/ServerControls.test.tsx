/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ServerControls from "./ServerControls";
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
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const plan: ServerPlan = {
  id: "a".repeat(32),
  server: "main",
  mode: "latest",
  expires_at: Date.now() / 1000 + 600,
  changes: [{ repo: "Cooking", old_version: "1.0.0", version: "2.0.0", asset: "cooking-2.0.0.jar" }],
  activation: [],
  skipped: [{ repo: "TFMCCore", reason: "test_or_unknown_build" }],
  last_backup_at: null,
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

it("reviews changes and skips, and requires a Main reason and backup before starting", async () => {
  vi.mocked(getControl).mockResolvedValue({ status: "available", jobs: [], allowed_servers: ["main", "dev"] });
  vi.mocked(planServer).mockResolvedValue(plan);
  vi.mocked(serverAction).mockResolvedValue(job);
  render(<ServerControls onComplete={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Use latest releases and restart Main" }));
  const dialog = await screen.findByRole("dialog", { name: "Confirm Main restart" });
  expect(within(dialog).getByText(/Cooking: 1.0.0 → 2.0.0/)).toBeTruthy();
  expect(within(dialog).getByText(/TFMCCore: test or unrecognised build/)).toBeTruthy();
  const start = within(dialog).getByRole("button", { name: "Start Main countdown" }) as HTMLButtonElement;
  expect(start.disabled).toBe(true);
  fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "publish tested cooking" } });
  expect(start.disabled).toBe(true);
  fireEvent.change(within(dialog).getByLabelText("Backup prepared for this restart"), {
    target: { value: "AMP 2026-10-12 plus province DB" },
  });
  expect(start.disabled).toBe(false);
  fireEvent.click(start);
  await waitFor(() =>
    expect(serverAction).toHaveBeenCalledWith(
      "main",
      "start",
      plan.id,
      "publish tested cooking",
      "AMP 2026-10-12 plus province DB",
      false,
    ),
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
  const dialog = screen.getByRole("dialog", { name: "cancel Main" });
  const button = within(dialog).getByRole("button", { name: "Confirm cancel" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  expect(serverAction).not.toHaveBeenCalled();
  fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Players need more time" } });
  fireEvent.click(button);
  await waitFor(() =>
    expect(serverAction).toHaveBeenCalledWith("main", "cancel", job.id, "Players need more time", "", false),
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
  const dialog = screen.getByRole("dialog", { name: "reopen Main" });
  expect(within(dialog).getByText(/checked the changed features/)).toBeTruthy();
  fireEvent.change(within(dialog).getByLabelText("Reason"), {
    target: { value: "Verified recipes and persisted character data" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Confirm reopen" }));
  await waitFor(() =>
    expect(serverAction).toHaveBeenCalledWith(
      "main",
      "reopen",
      job.id,
      "Verified recipes and persisted character data",
      "",
      false,
    ),
  );
});

it("Dev confirms an instant restart without an override or backup field", async () => {
  vi.mocked(getControl).mockResolvedValue({ status: "available", jobs: [], allowed_servers: ["dev"] });
  vi.mocked(planServer).mockResolvedValue({ ...plan, server: "dev", mode: "restart" });
  vi.mocked(serverAction).mockResolvedValue({ ...job, server: "dev", phase: "installing" });
  render(<ServerControls onComplete={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Restart Dev" }));
  const dialog = await screen.findByRole("dialog", { name: "Confirm Dev restart" });
  expect(within(dialog).getByText(/restarts Dev immediately after confirmation/)).toBeTruthy();
  expect(within(dialog).queryByRole("checkbox")).toBeNull();
  expect(within(dialog).queryByLabelText("Backup prepared for this restart")).toBeNull();
  fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Dev test restart" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Restart Dev now" }));
  await waitFor(() =>
    expect(serverAction).toHaveBeenCalledWith("dev", "start", plan.id, "Dev test restart", "", false),
  );
});

it("Main emergency override is unchecked by default and is explicit in the action", async () => {
  vi.mocked(getControl).mockResolvedValue({ status: "available", jobs: [], allowed_servers: ["main", "dev"] });
  vi.mocked(planServer).mockResolvedValue(plan);
  vi.mocked(serverAction).mockResolvedValue({ ...job, phase: "installing", emergency_override: true });
  render(<ServerControls onComplete={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Use latest releases and restart Main" }));
  const dialog = await screen.findByRole("dialog", { name: "Confirm Main restart" });
  const override = within(dialog).getByRole("checkbox", { name: /OVERRIDE:/ }) as HTMLInputElement;
  expect(override.checked).toBe(false);
  fireEvent.click(override);
  const start = within(dialog).getByRole("button", { name: "Restart Main now" }) as HTMLButtonElement;
  expect(start.disabled).toBe(true);
  fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Emergency rollback fix" } });
  fireEvent.change(within(dialog).getByLabelText("Backup prepared for this restart"), {
    target: { value: "Emergency recovery backup" },
  });
  fireEvent.click(start);
  await waitFor(() =>
    expect(serverAction).toHaveBeenCalledWith(
      "main",
      "start",
      plan.id,
      "Emergency rollback fix",
      "Emergency recovery backup",
      true,
    ),
  );
});
