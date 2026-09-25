// @vitest-environment node

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import UpdatesPageView, { WeekPageView } from "../components/updates/UpdatesPageView";
import type { WeekNotes } from "@/lib/patchnotes/notes";

const current = {
  week: "2026-W39",
  label: "Week of 21 September 2026",
};

const earlier = {
  week: "2026-W38",
  label: "Week of 14 September 2026",
};

const notes: WeekNotes = {
  week: "2026-W39",
  label: "Week of 21 September 2026",
  bullets: [
    { id: "new-1", section: "new", body: "Added a station" },
    { id: "fixed-1", section: "fixed", body: "Fixed a door" },
    { id: "adjusted-1", section: "adjusted", body: "Lowered a price" },
    { id: "tech-1", section: "technical", body: "Rebuilt a plugin" },
    { id: "html-1", section: "new", body: "<script>alert(1)</script>" },
  ],
};

function markup(weeks: { week: string; label: string }[], unavailable = false): string {
  return renderToStaticMarkup(<UpdatesPageView weeks={weeks} unavailable={unavailable} />);
}

describe("Updates page", () => {
  it("lists each week as a button and leaves the notes off the index", () => {
    const html = markup([current, earlier]);
    expect(html).toContain('href="/updates/2026-W39"');
    expect(html).toContain('href="/updates/2026-W38"');
    expect(html).toContain("Week of 21 September 2026");
    expect(html).toContain("Week of 14 September 2026");
    expect(html).toContain("rounded-sm border");
    expect(html).not.toContain("Added a station");
    expect(html).not.toContain("Fixed a chest");
    expect(html).not.toContain("hover:underline");
    expect(html.indexOf("2026-W39")).toBeLessThan(html.indexOf("2026-W38"));
  });

  it("says when nothing is published", () => {
    expect(markup([])).toContain("Nothing has been published yet.");
  });

  it("says when the notes cannot be loaded", () => {
    const html = markup([current], true);
    expect(html).toContain("Patch notes are unavailable right now.");
    expect(html).not.toContain("Week of 21 September 2026");
  });
});

describe("Week page", () => {
  it("shows that week and folds technical notes", () => {
    const html = renderToStaticMarkup(<WeekPageView notes={notes} />);
    expect(html).toContain('href="/updates"');
    expect(html).toContain("All updates");
    expect(html).toContain("rounded-sm border");
    expect(html).toContain("Week of 21 September 2026");
    expect(html).toContain("Highlights");
    expect(html).toContain("Crafting");
    expect(html).toContain("Added a station");
    expect(html).toContain("Bug fixes");
    expect(html).toContain("Fixed a door");
    expect(html).toContain("Other");
    expect(html).toContain("Lowered a price");
    expect(html).toContain("Technical (1)");
    expect(html).toContain("Rebuilt a plugin");
    expect(html).not.toContain(">New<");
    expect(html).not.toContain(">Adjusted<");
    expect(html).not.toContain("<details open");
    expect(html.indexOf("Highlights")).toBeLessThan(html.indexOf("Crafting"));
    expect(html.indexOf("Crafting")).toBeLessThan(html.indexOf("Bug fixes"));
    expect(html.indexOf("Bug fixes")).toBeLessThan(html.indexOf("<details"));
    expect(html.indexOf("<details")).toBeLessThan(html.indexOf("Rebuilt a plugin"));
  });

  it("renders bullet text instead of HTML", () => {
    const html = renderToStaticMarkup(<WeekPageView notes={notes} />);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});
