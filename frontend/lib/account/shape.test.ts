/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import {
  DEFAULT_ACCOUNT_SHAPE,
  decodeAccountShape,
  encodeAccountShape,
  rememberAccountShape,
  type AccountShape,
} from "./shape";

afterEach(() => {
  vi.restoreAllMocks();
});

it("round-trips a shape through the cookie value", () => {
  const shape: AccountShape = { signedIn: true, subline: 2, chips: true, tiles: false, notes: false, rows: 2 };
  expect(encodeAccountShape(shape)).toBe("121002");
  expect(decodeAccountShape("121002")).toEqual(shape);
});

it("keeps the card height to a tenth of a pixel", () => {
  const shape: AccountShape = { ...DEFAULT_ACCOUNT_SHAPE, cardHeight: 361.54 };
  expect(encodeAccountShape(shape)).toBe("121103-361.5");
  expect(decodeAccountShape("121103-361.5")).toEqual({ ...shape, cardHeight: 361.5 });
  expect(decodeAccountShape("121103-0")).toEqual(DEFAULT_ACCOUNT_SHAPE);
});

it.each([undefined, null, "", "11111", "1311103", "1111104", "121103-", "121103-12345", "121103-1.25", "abcdef", "1111113x"])("falls back to the default for %s", (value) => {
  expect(decodeAccountShape(value)).toEqual(DEFAULT_ACCOUNT_SHAPE);
});

it("keeps the cookie on the Account path for a year", () => {
  const set = vi.spyOn(Document.prototype, "cookie", "set");
  rememberAccountShape({ ...DEFAULT_ACCOUNT_SHAPE, signedIn: false });
  expect(set).toHaveBeenCalledWith("tfmc_account_shape=021103; Path=/account; Max-Age=31536000; SameSite=Lax");
});
