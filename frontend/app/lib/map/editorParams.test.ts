import { describe, expect, it } from "vitest";

import { parseEditorTierParam, parseRequiredEditorMapIdParam } from "@/lib/map/editorParams";

describe("editorParams", () => {
  describe("parseRequiredEditorMapIdParam", () => {
    it("returns null when missing", () => {
      expect(parseRequiredEditorMapIdParam(null)).toBeNull();
      expect(parseRequiredEditorMapIdParam("")).toBeNull();
    });

    it("returns main or dev for valid ids", () => {
      expect(parseRequiredEditorMapIdParam("main")).toBe("main");
      expect(parseRequiredEditorMapIdParam("MAIN")).toBe("main");
      expect(parseRequiredEditorMapIdParam("dev")).toBe("dev");
    });

    it("returns null for invalid ids", () => {
      expect(parseRequiredEditorMapIdParam("calavorn")).toBeNull();
      expect(parseRequiredEditorMapIdParam("notamap")).toBeNull();
    });
  });

  describe("parseEditorTierParam", () => {
    it("defaults to county", () => {
      expect(parseEditorTierParam(null)).toBe("county");
      expect(parseEditorTierParam("")).toBe("county");
    });

    it("parses valid tiers", () => {
      expect(parseEditorTierParam("duchy")).toBe("duchy");
      expect(parseEditorTierParam("EMPIRE")).toBe("empire");
    });
  });
});
