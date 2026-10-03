import { describe, expect, it } from "vitest";
import { getPatreonLinkedResult } from "./patreonLinked";

describe("Patreon linked result copy", () => {
  it.each([
    ["ok", "You’re all set"],
    ["not_a_member", "Patreon linked"],
    ["already_linked", "This Patreon is already linked"],
    ["relink_cooldown", "Please wait before linking again"],
    ["expired", "Link expired"],
    ["denied", "Link not completed"],
    ["error", "Something went wrong"],
  ])("maps %s to fixed copy", (status, title) => {
    expect(getPatreonLinkedResult(status, "ascended").title).toBe(title);
  });

  it("uses a known tier name but never echoes an unknown query value", () => {
    expect(getPatreonLinkedResult("ok", "gilded").message).toContain("Gilded");
    expect(getPatreonLinkedResult("ok", "<script>").message).not.toContain("<script>");
  });

  it("uses safe fallback copy for unknown status values", () => {
    const result = getPatreonLinkedResult("<script>alert(1)</script>", "secret");
    expect(result.title).toBe("Link result unavailable");
    expect(result.message).not.toContain("script");
    expect(result.message).not.toContain("secret");
  });
});
