// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { downloadBlob } from "./downloadBlob";

const createObjectURL = vi.fn(() => "blob:download");
const revokeObjectURL = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  // jsdom has no object URLs; these stand in for the browser ones.
  Object.assign(URL, { createObjectURL, revokeObjectURL });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
});

it("clicks an attached anchor, removes it and revokes the URL a minute later", () => {
  const blob = new Blob(["{}"], { type: "application/json" });
  let clicked: HTMLAnchorElement | null = null;
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    expect(this.isConnected).toBe(true);
    clicked = this;
  });

  downloadBlob(blob, "plan.json");

  expect(createObjectURL).toHaveBeenCalledWith(blob);
  expect(clicked).not.toBeNull();
  expect(clicked!.href).toBe("blob:download");
  expect(clicked!.download).toBe("plan.json");
  expect(clicked!.isConnected).toBe(false);

  expect(revokeObjectURL).not.toHaveBeenCalled();
  vi.advanceTimersByTime(59_999);
  expect(revokeObjectURL).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:download");
});
