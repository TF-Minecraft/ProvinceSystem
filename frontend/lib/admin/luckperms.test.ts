import { afterEach, expect, it, vi } from "vitest";
import { expiryLabel, getLpChange, parseMcText, stripMcText, waitForChange, type LpChange } from "./luckperms";

vi.mock("./api", async (importOriginal) => ({
  ...await importOriginal<typeof import("./api")>(),
  adminRequest: vi.fn(),
}));

afterEach(() => vi.clearAllMocks());

it("reads Minecraft colour and style codes", () => {
  expect(parseMcText("&6Noble &lLord&r!")).toEqual([
    { text: "Noble ", colour: "#FFAA00", bold: false, italic: false, underline: false, strike: false },
    { text: "Lord", colour: "#FFAA00", bold: true, italic: false, underline: false, strike: false },
    { text: "!", colour: null, bold: false, italic: false, underline: false, strike: false },
  ]);
  expect(parseMcText("&#ff8800Hex")[0].colour).toBe("#FF8800");
  expect(stripMcText("§cStaff & co &z")).toBe("Staff & co &z");
});

it("says when temporary nodes run out", () => {
  expect(expiryLabel(0)).toBe("");
  expect(expiryLabel(1000, 2000)).toBe("Expired");
  expect(expiryLabel(1000 + 600, 1000)).toBe("Expires in 10 min");
  expect(expiryLabel(1000 + 3 * 86400, 1000)).toBe("Expires in 3 d");
});

it("follows a change until the server settles it", async () => {
  const { adminRequest } = await import("./api");
  const base = { id: 7, status: "pending" } as LpChange;
  vi.mocked(adminRequest)
    .mockResolvedValueOnce(base)
    .mockResolvedValueOnce({ ...base, status: "sent" })
    .mockResolvedValueOnce({ ...base, status: "applied" });
  const settled = await waitForChange(7, { intervalMs: 1 });
  expect(settled.status).toBe("applied");
  expect(vi.mocked(adminRequest)).toHaveBeenCalledWith("/admin/luckperms/changes/7");
  vi.mocked(adminRequest).mockResolvedValue(base);
  expect((await waitForChange(7, { intervalMs: 1, limitMs: 5 })).status).toBe("pending");
  expect(getLpChange).toBeDefined();
});
