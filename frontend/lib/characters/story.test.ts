import { expect, it } from "vitest";
import { COLLAPSE_OVER, paragraphs, splitStory } from "./story";

const sentence = "The winter took the mill and most of the village with it. ";

it("shows a background up to the limit in full", () => {
  expect(splitStory("Short.")).toBeNull();
  expect(splitStory("x".repeat(COLLAPSE_OVER))).toBeNull();
  // Many short paragraphs alone don't collapse it.
  expect(splitStory(Array.from({ length: 12 }, () => "A line.").join("\n\n"))).toBeNull();
});

it("ends the excerpt at a paragraph break when there is one in range", () => {
  const first = sentence.repeat(12).trim(); // ~700 characters
  const text = `${first}\n\n${sentence.repeat(12).trim()}`;
  const split = splitStory(text)!;
  expect(split.lead).toBe(first);
  expect(split.rest).toBe(sentence.repeat(12).trim());
});

it("ends one long paragraph at a sentence", () => {
  const split = splitStory(sentence.repeat(30))!;
  expect(split.lead.endsWith("with it.")).toBe(true);
  expect(split.lead.length).toBeGreaterThanOrEqual(650);
  expect(split.lead.length).toBeLessThanOrEqual(800);
  expect(`${split.lead} ${split.rest}`).toBe(sentence.repeat(30).trim());
});

it("falls back to a space, then a hard cut", () => {
  const words = splitStory("word ".repeat(300))!;
  expect(words.lead.endsWith("word")).toBe(true);
  const solid = splitStory("x".repeat(1500))!;
  expect(solid.lead.length).toBe(800);
  expect(solid.lead + solid.rest).toBe("x".repeat(1500));
});

it("splits paragraphs on blank lines only", () => {
  expect(paragraphs("One\ntwo\n\n  \n\nThree")).toEqual(["One\ntwo", "Three"]);
});
