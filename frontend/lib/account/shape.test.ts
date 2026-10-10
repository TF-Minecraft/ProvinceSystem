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
  const shape: AccountShape = { signedIn: true, subline: 2, chips: true, tabs: false, rows: 2 };
  expect(encodeAccountShape(shape)).toBe("12102");
  expect(decodeAccountShape("12102")).toEqual(shape);
});

it("keeps the card height to a tenth of a pixel", () => {
  const shape: AccountShape = { ...DEFAULT_ACCOUNT_SHAPE, cardHeight: 361.54 };
  expect(encodeAccountShape(shape)).toBe("12113-361.5");
  expect(decodeAccountShape("12113-361.5")).toEqual({ ...shape, cardHeight: 361.5 });
  expect(decodeAccountShape("12113-0")).toEqual(DEFAULT_ACCOUNT_SHAPE);
});

it.each([undefined, null, "", "1111", "131103", "111114", "12113-", "12113-12345", "12113-1.25", "abcde", "121103", "111113x"])("falls back to the default for %s", (value) => {
  expect(decodeAccountShape(value)).toEqual(DEFAULT_ACCOUNT_SHAPE);
});

it("keeps the cookie on the Profile path for a year", () => {
  const set = vi.spyOn(Document.prototype, "cookie", "set");
  rememberAccountShape({ ...DEFAULT_ACCOUNT_SHAPE, signedIn: false });
  expect(set).toHaveBeenCalledWith("tfmc_profile_shape=02113; Path=/profile; Max-Age=31536000; SameSite=Lax");
});
