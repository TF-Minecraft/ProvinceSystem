/**
 * @vitest-environment jsdom
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MapLayersMenu from "./MapLayersMenu";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
});

function renderMenu(onMapTypeChange = vi.fn()) {
  render(
    <MapLayersMenu
      mapType="nation"
      onMapTypeChange={onMapTypeChange}
      toggles={[]}
      mapId="main"
      previews={false}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: /Layers/ }));
  return screen.getByRole("dialog", { name: "Map layers" });
}

/** One finger from `from` to `to` (clientY), in steps a few ms apart. */
function pull(sheet: HTMLElement, from: number, to: number, stepMs = 16) {
  const touch = (clientY: number) => ({ touches: [{ clientY }] });
  fireEvent.touchStart(sheet, touch(from));
  const steps = 6;
  for (let i = 1; i <= steps; i++) {
    vi.advanceTimersByTime(stepMs);
    fireEvent.touchMove(sheet, touch(from + ((to - from) * i) / steps));
  }
  fireEvent.touchEnd(sheet, { touches: [] });
}

describe("MapLayersMenu", () => {
  it("closes once a map type is chosen", () => {
    const onMapTypeChange = vi.fn();
    renderMenu(onMapTypeChange);
    fireEvent.click(screen.getByRole("button", { name: "Kingdoms" }));
    expect(onMapTypeChange).toHaveBeenCalledWith("kingdom");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes when the sheet is pulled well down from the top", () => {
    const sheet = renderMenu();
    pull(sheet, 300, 500, 200);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("springs back from a short, slow pull", () => {
    const sheet = renderMenu();
    pull(sheet, 300, 340, 200);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByRole("dialog")).toBe(sheet);
    expect(sheet.style.transform).toBe("");
  });

  it("closes on a short flick", () => {
    const sheet = renderMenu();
    pull(sheet, 300, 360, 8);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("leaves a pull to the content while it is scrolled down", () => {
    const sheet = renderMenu();
    sheet.scrollTop = 120;
    pull(sheet, 300, 500, 200);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByRole("dialog")).toBe(sheet);
    expect(sheet.style.transform).toBe("");
  });
});

describe("MapLayersMenu pull that stops before lifting", () => {
  it("is not a flick", () => {
    const sheet = renderMenu();
    const touch = (clientY: number) => ({ touches: [{ clientY }] });
    fireEvent.touchStart(sheet, touch(300));
    for (let i = 1; i <= 6; i++) {
      vi.advanceTimersByTime(8);
      fireEvent.touchMove(sheet, touch(300 + i * 10));
    }
    vi.advanceTimersByTime(400);
    fireEvent.touchEnd(sheet, { touches: [] });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByRole("dialog")).toBe(sheet);
  });
});
