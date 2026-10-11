import { CommandTable, DataTable, SeeAlso, WikiPage, WikiSectionHeading } from "@/app/components/wiki";
import { codexCommands } from "../data/codex";

export default function CodexPage() {
  return (
    <WikiPage
      lastModified="2026-09-11"
      title="Codex"
      width="lg"
      intro="The Codex is your in-game discovery journal. Open it to browse lore, character entries, special discoveries, and achievements you have unlocked."
    >
      <WikiSectionHeading id="browse">Open and read your journal</WikiSectionHeading>
      <ol className="mt-4 list-decimal space-y-3 pl-6 text-sm text-[var(--tfmc-mist)]">
        <li>
          Type <code>/codex</code>. The main menu shows the journal categories and your discovery progress.
        </li>
        <li>Choose a category. Unlocked entries have a colored icon, name, description and discovery date.</li>
        <li>Click an unlocked Research, Character or Special entry to open its lore book.</li>
        <li>Close the journal with the barrier.</li>
      </ol>
      <DataTable
        columns={[{ header: "Category" }, { header: "What to expect" }]}
        rows={[
          ["Points of Interest", "Discoveries tied to places in the world."],
          ["Research", "Material, technique and lore entries."],
          ["Characters", "Named character entries."],
          ["Special", "Special books and other secrets."],
          ["Achievements", "Progress milestones and other achievement entries."],
        ]}
      />
      <WikiSectionHeading id="theses">Research theses and claiming</WikiSectionHeading>
      <p className="mt-4 text-sm text-[var(--tfmc-mist)]">
        Right-click a Completed Thesis to claim its matching Research entry. Claiming consumes the thesis. If you
        already know that entry, keep or trade the duplicate instead.
      </p>
      <WikiSectionHeading id="commands">Commands</WikiSectionHeading>
      <CommandTable commands={codexCommands.commands} />
      <SeeAlso hrefs={["/wiki/research", "/wiki/magic", "/wiki/commands"]} />
    </WikiPage>
  );
}
