// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import StationModelViewer from "./StationModelViewer";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("loads only visible previews, aborts offscreen work, and reloads on return", () => {
  let notify: IntersectionObserverCallback;
  const disconnect = vi.fn();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        notify = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  const fetchModel = vi.fn(() => new Promise<Response>(() => {}));
  vi.stubGlobal("fetch", fetchModel);
  const view = render(<StationModelViewer modelUrl="/wiki/models/stations/meal-prep-station.json" />);
  expect(fetchModel).not.toHaveBeenCalled();
  const visibility = (isIntersecting: boolean) =>
    act(() => {
      notify([{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver);
    });
  visibility(true);
  expect(fetchModel).toHaveBeenCalledTimes(1);
  const firstSignal = (fetchModel.mock.calls[0] as unknown as [string, RequestInit])[1].signal!;
  visibility(false);
  expect(firstSignal.aborted).toBe(true);
  visibility(true);
  expect(fetchModel).toHaveBeenCalledTimes(2);
  view.unmount();
  expect(disconnect).toHaveBeenCalledTimes(1);
});
