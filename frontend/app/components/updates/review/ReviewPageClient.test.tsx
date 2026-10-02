// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import ReviewPageClient from "./ReviewPageClient";

const mocks = vi.hoisted(() => ({
  state: "staff" as "staff" | "denied",
  listReviewWeeks: vi.fn(),
  loadReviewWeek: vi.fn(),
}));

vi.mock("@/app/hooks/useSiteStaffAccess", () => ({
  useSiteStaffAccess: () => ({ state: mocks.state }),
}));

vi.mock("@/lib/characters/session", () => ({
  getSession: () => ({ session_token: "test-token" }),
  isSessionValid: () => true,
}));

vi.mock("@/lib/patchnotes/review", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/patchnotes/review")>();
  return {
    ...actual,
    listReviewWeeks: mocks.listReviewWeeks,
    loadReviewWeek: mocks.loadReviewWeek,
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("shows toolbar actions and compact review rows to staff", async () => {
  mocks.state = "staff";
  mocks.listReviewWeeks.mockResolvedValue({
    current: "2026-W40",
    weeks: [{
      week: "2026-W40",
      label: "Week of 28 September 2026",
      pending: 1,
      approved: 1,
      denied: 0,
      postponed: false,
    }],
  });
  mocks.loadReviewWeek.mockResolvedValue({
    week: "2026-W40",
    postponed: false,
    deferredTo: null,
    job: null,
    removed: [],
    bullets: [
      {
        id: "one",
        section: "new",
        body: "A new ferry route opened.",
        topic: null,
        highlight: false,
        status: "pending",
        deny_reason: null,
        warning: null,
      },
      {
        id: "two",
        section: "fixed",
        body: "The bridge no longer flickers.",
        topic: null,
        highlight: false,
        status: "approved",
        deny_reason: null,
        warning: null,
      },
    ],
  });

  render(<ReviewPageClient />);

  expect(await screen.findByText("A new ferry route opened.")).toBeTruthy();
  expect(screen.getByText("The bridge no longer flickers.")).toBeTruthy();
  expect(screen.getByText("New (1)")).toBeTruthy();
  expect(screen.getByText("Fixed (1)")).toBeTruthy();
  expect(screen.getByText("Approved")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Preview as players see it" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Approve all waiting" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Deny with feedback" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Sort with Sol" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Postpone" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Reset week" })).toBeTruthy();

  const line = screen.getByText("A new ferry route opened.").closest("article");
  expect(line).toBeTruthy();
  expect(line?.querySelector("select[aria-label='Section']")).toBeTruthy();
  expect(line?.querySelector("select[aria-label='Topic']")).toBeTruthy();
  expect(line?.querySelector("button[aria-label='Highlight']")).toBeTruthy();
  expect(line?.textContent).toContain("Edit");
  expect(line?.textContent).toContain("Remove");
});

it("shows the sign-in message and fetches no review data for non-staff", async () => {
  mocks.state = "denied";
  render(<ReviewPageClient />);

  expect(screen.getByText(
    "This page is for staff. Sign in with a staff account to review weekly notes.",
  )).toBeTruthy();
  await waitFor(() => expect(mocks.listReviewWeeks).not.toHaveBeenCalled());
  expect(mocks.loadReviewWeek).not.toHaveBeenCalled();
  expect(screen.queryByText("A new ferry route opened.")).toBeNull();
});
