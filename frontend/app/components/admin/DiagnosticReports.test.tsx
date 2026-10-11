/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import DiagnosticReports from "./DiagnosticReports";
import { getDiagnosticReport, type DiagnosticReportRow } from "../../../lib/diagnostic/api";

vi.mock("../../../lib/diagnostic/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/diagnostic/api")>()),
  getDiagnosticReport: vi.fn(),
}));

const ROW: DiagnosticReportRow = {
  code: "AZ6YYM",
  created_at: "2026-10-11T13:13:52Z",
  user_id: null,
  discord_name: null,
  minecraft_name: "Nijika_",
  country: "PH",
  worst: "fail",
  summary: "The resource pack download failed",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("opens a report from the recent list", async () => {
  vi.mocked(getDiagnosticReport).mockResolvedValue({
    ...ROW,
    report: {
      user_agent: "Chrome",
      findings: [{ level: "fail", title: "The resource pack download failed", fix: "Try again." }],
      results: {
        latency: { medianMs: 310, jitterMs: 20, lost: 0, sent: 10 },
        pack: { ok: false, bytes: 1000, ms: 30000, mbps: 0, error: "timed out", sha1Match: null },
      },
    },
  });
  render(<DiagnosticReports initial={[ROW]} />);
  fireEvent.click(screen.getByRole("button", { name: /AZ6YYM/ }));
  expect(await screen.findByText("Round trip to TFMC")).toBeTruthy();
  expect(getDiagnosticReport).toHaveBeenCalledWith("AZ6YYM");
  expect(screen.getByText("Failed after 1000 B: timed out")).toBeTruthy();
  expect(screen.getAllByText("The resource pack download failed").length).toBe(2);
});

it("shows the raw report when it isn't laid out as expected", async () => {
  vi.mocked(getDiagnosticReport).mockResolvedValue({ ...ROW, report: { something: "else" } });
  render(<DiagnosticReports initial={[]} />);
  fireEvent.change(screen.getByLabelText("Report code"), { target: { value: "az6yym" } });
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  expect(await screen.findByText(/"something": "else"/)).toBeTruthy();
  expect(screen.getByText("No reports yet.")).toBeTruthy();
});
