/**
 * @vitest-environment jsdom
 *
 * Mount tests for the shared wiki component library.
 *
 * These components are the contract ~40 pages are written against, so the
 * things pinned here are the things a page author would silently get wrong:
 * arbitrary ReactNode cells surviving into the DOM, the player-vs-permission
 * distinction being visible rather than implied, and `SeeAlso` refusing to
 * invent a label for an href that no registered page owns.
 */

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { navItems, overviewNavItem } from "@/app/wiki/data";

import Callout, { type CalloutVariant } from "./Callout";
import CommandTable from "./CommandTable";
import DataTable from "./DataTable";
import SeeAlso from "./SeeAlso";
import WikiPage, { WIKI_LAST_MODIFIED, formatWikiDate } from "./WikiPage";

afterEach(cleanup);

describe("WikiPage", () => {
  it("always shows the maintained wiki revision as one semantic date", () => {
    render(<WikiPage title="Materials">Content</WikiPage>);

    const labels = screen.getAllByText(/Updated/);
    expect(labels).toHaveLength(1);
    const date = labels[0].querySelector("time");
    expect(date?.dateTime).toBe(WIKI_LAST_MODIFIED);
    expect(date?.textContent).toBe(formatWikiDate(WIKI_LAST_MODIFIED));
  });

  it("uses a valid page-specific ISO date and falls back for invalid calendar dates", () => {
    const { rerender } = render(
      <WikiPage title="Commands" lastModified="2026-09-01">Content</WikiPage>
    );
    expect(screen.getByText(/Updated/).querySelector("time")?.dateTime).toBe("2026-09-01");

    rerender(<WikiPage title="Commands" lastModified="2026-02-30">Content</WikiPage>);
    expect(screen.getByText(/Updated/).querySelector("time")?.dateTime).toBe(
      WIKI_LAST_MODIFIED
    );

    for (const invalidDate of ["2026-13-01", "2026-09-99"]) {
      expect(() =>
        rerender(<WikiPage title="Commands" lastModified={invalidDate}>Content</WikiPage>)
      ).not.toThrow();
      expect(screen.getByText(/Updated/).querySelector("time")?.dateTime).toBe(
        WIKI_LAST_MODIFIED
      );
    }
  });
});

describe("formatWikiDate", () => {
  it("writes the day, short month and year in British order", () => {
    expect(formatWikiDate("2026-09-12")).toMatch(/^12 Sept? 2026$/);
    expect(formatWikiDate("2026-01-01")).toBe("1 Jan 2026");
  });
});

describe("DataTable", () => {
  it("renders strings, numbers and arbitrary ReactNode cells", () => {
    render(
      <DataTable
        columns={[{ header: "Item" }, { header: "Chance", align: "right" }, { header: "Source" }]}
        rows={[
          [
            "Mythril Fragment",
            12,
            <a key="link" href="/wiki/materials/mythril-fragment">
              Materials
            </a>,
          ],
        ]}
      />
    );

    const table = screen.getByRole("table");
    expect(within(table).getByText("Mythril Fragment")).toBeTruthy();
    expect(within(table).getByText("12")).toBeTruthy();
    // A full element, not a stringified object.
    const link = within(table).getByRole("link", { name: "Materials" });
    expect(link.getAttribute("href")).toBe("/wiki/materials/mythril-fragment");
  });

  it("uses semantic column headers", () => {
    render(
      <DataTable columns={[{ header: "Item" }, { header: "Chance" }]} rows={[["Coke", "3%"]]} />
    );

    const headers = screen.getAllByRole("columnheader");
    expect(headers.map((h) => h.textContent)).toEqual(["Item", "Chance"]);
    expect(headers.every((h) => h.getAttribute("scope") === "col")).toBe(true);
  });

  it("falls back to a message instead of an empty table shell", () => {
    render(<DataTable columns={[{ header: "Item" }]} rows={[]} emptyMessage="No drops yet." />);

    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("No drops yet.")).toBeTruthy();
  });
});

describe("CommandTable", () => {
  it("shows ordinary player commands and omits permission-gated commands", () => {
    render(
      <CommandTable
        commands={[
          { command: "/instruments list", description: "Lists every instrument." },
          {
            command: "/instruments reload",
            description: "Reloads the config.",
            access: "permission",
            permission: "instruments.admin",
          },
        ]}
      />
    );

    const rows = screen.getAllByRole("row").slice(1); // drop the header row
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText("/instruments list")).toBeTruthy();
    expect(screen.queryByText("/instruments reload")).toBeNull();
    expect(screen.queryByText("instruments.admin")).toBeNull();
  });

  it("renders the four documented columns and aliases without staff commands", () => {
    render(
      <CommandTable
        commands={[
          {
            command: "/mountwhistle",
            aliases: ["/mw", "/whistle"],
            description: "Highlights nearby mounts.",
            notes: "3s cooldown.",
          },
        ]}
        excludedStaffCommands={["/mountwhistle reload", "/mountwhistle debug"]}
      />
    );

    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Command",
      "Aliases",
      "What it does",
      "Notes",
    ]);
    expect(screen.getByText("/mw, /whistle")).toBeTruthy();
    expect(screen.queryByText("/mountwhistle reload")).toBeNull();
    expect(screen.queryByText("/mountwhistle debug")).toBeNull();
  });

  it("can hide notes while keeping aliases and descriptions", () => {
    render(
      <CommandTable
        commands={[{
          command: "/magic",
          aliases: ["/m"],
          description: "Opens magic.",
          notes: "Hidden detail.",
        }]}
        showNotes={false}
      />
    );

    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Command",
      "Aliases",
      "What it does",
    ]);
    expect(screen.getByText("/m")).toBeTruthy();
    expect(screen.getByText("Opens magic.")).toBeTruthy();
    expect(screen.queryByText("Hidden detail.")).toBeNull();
  });
});

describe("SeeAlso", () => {
  it("resolves every label from the nav registry rather than the caller", () => {
    const target = navItems[0];

    render(<SeeAlso hrefs={[overviewNavItem.href, target.href]} />);

    const nav = screen.getByRole("navigation", { name: "See also" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      overviewNavItem.href,
      target.href,
    ]);
    expect(within(nav).getByText(overviewNavItem.label)).toBeTruthy();
    expect(within(nav).getByText(target.label)).toBeTruthy();
    // A real list inside the landmark, not a pile of divs.
    expect(within(nav).getAllByRole("listitem")).toHaveLength(2);
  });

  it("throws on an unresolvable href instead of rendering an empty or guessed label", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => render(<SeeAlso hrefs={["/wiki/does-not-exist"]} />)).toThrow(
        /not a registered wiki page/
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it("degrades to a loud visible placeholder in a production build, never a silent drop", () => {
    // NODE_ENV is read at render time, so this exercises the production branch.
    vi.stubEnv("NODE_ENV", "production");
    try {
      render(<SeeAlso hrefs={["/wiki/does-not-exist"]} />);
      const alert = screen.getByRole("alert");
      expect(alert.textContent).toContain("/wiki/does-not-exist");
      expect(screen.queryAllByRole("link")).toHaveLength(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("Callout", () => {
  const variants: Array<[CalloutVariant, string]> = [
    ["note", "Note"],
    ["warning", "Warning"],
    ["bug", "Known bug"],
    ["draft", "Draft: unverified"],
    ["staff", "Staff only"],
  ];

  it.each(variants)("renders the %s variant with its own label", (variant, label) => {
    render(<Callout variant={variant}>Body copy.</Callout>);

    const box = screen.getByRole("note");
    expect(box.getAttribute("data-variant")).toBe(variant);
    expect(within(box).getByText(label)).toBeTruthy();
    expect(within(box).getByText("Body copy.")).toBeTruthy();
  });

  it("defaults to note and lets the label be overridden", () => {
    render(<Callout title="Read this first">Body copy.</Callout>);

    const box = screen.getByRole("note");
    expect(box.getAttribute("data-variant")).toBe("note");
    expect(within(box).getByText("Read this first")).toBeTruthy();
    expect(within(box).queryByText("Note")).toBeNull();
  });

  it("gives warning and bug distinct backgrounds with uniform borders", () => {
    const classFor = (variant: CalloutVariant) => {
      cleanup();
      render(<Callout variant={variant}>x</Callout>);
      return screen.getByRole("note").className;
    };

    const note = classFor("note");
    const warning = classFor("warning");
    const bug = classFor("bug");

    expect(warning).not.toBe(note);
    expect(bug).not.toBe(warning);
    expect(warning).toContain(" border ");
    expect(bug).toContain(" border ");
    expect(warning).not.toContain("border-l-");
    expect(bug).not.toContain("border-l-");
  });
});
