/**
 * @vitest-environment jsdom
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MapLayersMenu from "./MapLayersMenu";

const fetchManifest = vi.hoisted(() => vi.fn());
vi.mock("@/lib/map/api", async (original) => ({
  ...await original<typeof import("@/lib/map/api")>(),
  fetchMapJson: fetchManifest,
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.useFakeTimers();
  fetchManifest.mockReset();
});

function renderMenu(onMapTypeChange = vi.fn()) {
  render(
    <MapLayersMenu
      placement="phone"
      mapType="nation"
      onMapTypeChange={onMapTypeChange}
      toggles={[]}
      mapId="main"
      previews={false}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "Layers" }));
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
  it("shows only the layers icon on a phone, not the current map type", () => {
    render(
      <MapLayersMenu
        placement="phone"
        mapType="nation"
        onMapTypeChange={vi.fn()}
        toggles={[]}
        mapId="main"
        previews={false}
      />
    );
    const button = screen.getByRole("button", { name: "Layers" });
    expect(button.textContent).toBe("");
  });

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


describe("MapLayersMenu intent loading", () => {
  it("requests previews only once the panel is opened, with low image priority", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://map.test");
    fetchManifest.mockResolvedValue({
      ready: true, version: "v1", width: 512, height: 512, tile_size: 256,
      max_level: 0, levels: [{ width: 512, height: 512 }],
    });
    const { container } = render(
      <MapLayersMenu placement="phone" mapType="nation" onMapTypeChange={vi.fn()} toggles={[]} mapId="main" previews />
    );
    await act(async () => vi.advanceTimersByTime(10000));
    expect(fetchManifest).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Layers" }));
    await act(async () => {});
    expect(fetchManifest).toHaveBeenCalledWith("/main/tiles/regions-county/manifest");
    const images = container.querySelectorAll("img");
    expect(images.length).toBeGreaterThan(0);
    for (const image of images) expect(image.getAttribute("fetchpriority")).toBe("low");
  });
});

const MANIFEST = {
  ready: true, version: "v1", width: 512, height: 512, tile_size: 256,
  max_level: 0, levels: [{ width: 512, height: 512 }],
};

function renderDesktop(props: Partial<Parameters<typeof MapLayersMenu>[0]> = {}) {
  return render(
    <MapLayersMenu
      placement="desktop"
      mapType="nation"
      onMapTypeChange={vi.fn()}
      toggles={[]}
      mapId="main"
      previews={false}
      {...props}
    />
  );
}

describe("MapLayersMenu on a desktop", () => {
  it("labels the corner tile Layers, not with the current map type", () => {
    renderDesktop();
    const tile = screen.getByRole("button", { name: "Layers" });
    expect(tile.textContent).toBe("Layers");
  });

  it("offers every map type and overlay in the strip, and keeps it after a choice", () => {
    const onMapTypeChange = vi.fn();
    const onChange = vi.fn();
    renderDesktop({
      onMapTypeChange,
      toggles: [
        { id: "paint", label: "War planning", icon: () => null, desktopOnly: true, checked: false, onChange },
      ],
    });
    const strip = screen.getByRole("group", { name: "Map type and details" });
    expect(strip.querySelectorAll("button[aria-pressed]")).toHaveLength(11);
    fireEvent.click(screen.getByRole("button", { name: "Duchies" }));
    expect(onMapTypeChange).toHaveBeenCalledWith("duchy");
    fireEvent.click(screen.getByRole("switch", { name: "War planning" }));
    expect(onChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole("group", { name: "Map type and details" })).toBe(strip);
  });

  it("opens the full panel from the tile, in place of the strip", () => {
    renderDesktop();
    fireEvent.click(screen.getByRole("button", { name: "Layers" }));
    expect(screen.getByRole("dialog", { name: "Map layers" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Map type and details" })).toBeNull();
  });

  it("loads only the tile's own preview until the strip is hovered", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://map.test");
    fetchManifest.mockResolvedValue(MANIFEST);
    // Another map than the tests above, whose manifests are cached by now.
    const { container } = renderDesktop({ previews: true, mapId: "dev" });
    await act(async () => vi.advanceTimersByTime(10000));
    const asked = () => fetchManifest.mock.calls.map(([path]) => path).sort();
    expect(asked()).toEqual(["/dev/tiles/base/manifest", "/dev/tiles/regions-nation/manifest"]);
    fireEvent.pointerEnter(container.firstElementChild!);
    await act(async () => {});
    expect(asked()).toContain("/dev/tiles/regions-county/manifest");
  });
});
