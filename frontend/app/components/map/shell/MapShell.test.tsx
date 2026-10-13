/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MapShell from "./MapShell";

let resize: (event: MediaQueryListEvent) => void;

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: (_type: string, listener: typeof resize) => {
      resize = listener;
    },
    removeEventListener() {},
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function shell(key: string | null = "holy-order", onClose = vi.fn()) {
  return (
    <MapShell
      plaque={<input aria-label="Search Vardera" role="combobox" defaultValue="Holy Order" />}
      details={key ? <p>{key}</p> : null}
      detailsKey={key}
      onDetailsClose={onClose}
      zoomControls={null}
    >
      <div data-testid="map" />
    </MapShell>
  );
}

describe("MapShell desktop drawer", () => {
  it("hides search and details together without clearing or remounting the selection", () => {
    const onClose = vi.fn();
    render(shell("holy-order", onClose));
    const search = screen.getByRole("combobox");
    const details = screen.getByText("holy-order");
    const scroller = details.parentElement!;
    scroller.scrollTop = 120;
    const collapse = screen.getByRole("button", { name: "Collapse map panel" });
    const sidebar = document.getElementById(collapse.getAttribute("aria-controls")!)!;

    fireEvent.click(collapse);
    expect(sidebar.hasAttribute("inert")).toBe(true);
    expect(sidebar.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByRole("combobox", { hidden: true })).toBe(search);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Expand map panel" }));
    expect(sidebar.hasAttribute("inert")).toBe(false);
    expect(screen.getByRole("combobox")).toBe(search);
    expect(screen.getByText("holy-order")).toBe(details);
    expect(scroller.scrollTop).toBe(120);
    expect(screen.getAllByTestId("map")).toHaveLength(1);
  });

  it("reopens for a different selection and removes the handle when selection clears", () => {
    const { rerender } = render(shell());
    fireEvent.click(screen.getByRole("button", { name: "Collapse map panel" }));
    rerender(shell("thalendor"));
    expect(screen.getByRole("combobox")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Collapse map panel" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("thalendor")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Collapse map panel" }));
    rerender(shell(null));
    expect(screen.getByRole("combobox")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /map panel/ })).toBeNull();
  });

  it("restores the phone search and sheet when resizing a collapsed desktop drawer", () => {
    render(shell());
    fireEvent.click(screen.getByRole("button", { name: "Collapse map panel" }));
    act(() => resize({ matches: false } as MediaQueryListEvent));
    expect(screen.getByRole("combobox")).toBeTruthy();
    expect(screen.getByText("holy-order").closest("[inert]")).toBeNull();
  });

  it("reopens and focuses search with its existing keyboard shortcut", () => {
    let frame!: FrameRequestCallback;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    });
    render(shell());
    fireEvent.click(screen.getByRole("button", { name: "Collapse map panel" }));
    fireEvent.keyDown(window, { key: "/" });
    act(() => frame(0));
    expect(document.activeElement).toBe(screen.getByRole("combobox"));
  });
});
