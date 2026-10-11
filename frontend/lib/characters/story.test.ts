import { expect, it } from "vitest";
import { COLLAPSE_OVER, paragraphs, splitStory } from "./story";

const sentence = "The winter took the mill and most of the village with it. ";

it("shows a background up to the limit in full", () => {
  expect(splitStory("Short.")).toBeNull();
  expect(splitStory("x".repeat(COLLAPSE_OVER))).toBeNull();
  // Many short paragraphs alone don't collapse it.
  expect(splitStory(Array.from({ length: 12 }, () => "A line.").join("\n\n"))).toBeNull();
});

it("ends the excerpt at a blank line when there is one in range", () => {
  const first = sentence.repeat(12).trim(); // ~700 characters
  expect(splitStory(`${first}\n\n${sentence.repeat(12).trim()}`)!.lead).toBe(first);
});

it("keeps a single line break inside its paragraph and ends at a sentence", () => {
  const text = `${sentence.repeat(11)}\n${sentence.repeat(20)}`;
  const { lead } = splitStory(text)!;
  expect(lead.endsWith("with it.")).toBe(true);
  expect(lead.length).toBeGreaterThan(text.indexOf("\n"));
  expect(lead.length).toBeLessThanOrEqual(800);
});

it("ends one long paragraph at a sentence", () => {
  const { lead } = splitStory(sentence.repeat(30))!;
  expect(lead.endsWith("with it.")).toBe(true);
  expect(lead.length).toBeGreaterThanOrEqual(650);
  expect(sentence.repeat(30).startsWith(lead)).toBe(true);
});

it("falls back to a word, then a hard cut, marking the cut", () => {
  expect(splitStory("word ".repeat(300))!.lead.endsWith("word…")).toBe(true);
  expect(splitStory("x".repeat(1500))!.lead).toBe(`${"x".repeat(800)}…`);
});

it("splits paragraphs on blank lines only", () => {
  expect(paragraphs("One\ntwo\n\n  \n\nThree")).toEqual(["One\ntwo", "Three"]);
});
