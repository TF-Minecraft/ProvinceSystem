import Link from "next/link";
import { DataTable, SeeAlso, WikiPage, WikiSectionHeading } from "@/app/components/wiki";
import { allCommandRows, getNavItemByHref } from "../data";

export default function CommandIndexPage() {
  const commands = allCommandRows.filter((entry) => (entry.row.access ?? "player") === "player");
  return (
    <WikiPage lastModified="2026-09-12" title="Command Index" width="lg" intro="Player commands covered in this guide, A–Z.">
      <WikiSectionHeading id="commands">
        Player commands
      </WikiSectionHeading>
      <DataTable className="mt-4" minWidth="48rem" rowKey={(_row, index) => `${commands[index].href}:${commands[index].row.command}`}
        columns={[{ header: "Command", width: "18rem" }, { header: "Aliases", width: "10rem" }, { header: "What it does" }, { header: "Guide", width: "12rem" }]}
        rows={commands.map((entry) => [
          <code key="command" className="font-mono text-[var(--tfmc-accent)]">{entry.row.command}</code>,
          entry.row.aliases?.length ? entry.row.aliases.join(", ") : "—",
          entry.row.description,
          <Link key="guide" href={entry.href} className="underline decoration-dotted hover:text-[var(--tfmc-accent)]">{getNavItemByHref(entry.href)?.label ?? entry.system}</Link>,
        ])} />
      <SeeAlso hrefs={["/wiki/getting-started", "/wiki/materials", "/wiki/stations"]} />
    </WikiPage>
  );
}
