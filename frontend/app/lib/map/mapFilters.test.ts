import { describe, expect, it } from "vitest";

import { mapFiltersSupported } from "./mapFilters";

describe("mapFiltersSupported", () => {
  it("is off for WebKit: Safari, and every iPhone browser", () => {
    expect(
      mapFiltersSupported(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1"
      )
    ).toBe(false);
    expect(
      mapFiltersSupported(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1"
      )
    ).toBe(false);
    expect(
      mapFiltersSupported(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15"
      )
    ).toBe(false);
  });

  it("is on for Chromium and Firefox", () => {
    expect(
      mapFiltersSupported(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
      )
    ).toBe(true);
    expect(
      mapFiltersSupported(
        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"
      )
    ).toBe(true);
    expect(
      mapFiltersSupported("Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0")
    ).toBe(true);
  });
});
