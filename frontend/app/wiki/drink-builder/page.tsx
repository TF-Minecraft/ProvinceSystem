import {
  DataTable,
  RankName,
  SeeAlso,
  WikiPage,
  WikiSectionHeading,
} from "@/app/components/wiki";
import { WikiItemLink } from "@/app/components/wiki";
export default function DrinkBuilderPage() {
  return (
    <WikiPage
      lastModified="2026-09-12"
      title="Drink Builder"
    >
      <WikiSectionHeading id="how">
        How it works
      </WikiSectionHeading>
      <ol className="mt-4 flex flex-col gap-2 text-sm text-[var(--tfmc-mist)]">
        <li>1. On a donator rank, open the website&apos;s drinks page and design a drink: name (with colours), ingredients from a set list, cooking time, distill runs and time, barrel wood, age, difficulty, alcohol, lore, drink message and title, enchant shimmer, potion effects, colour, and, on higher ranks, a custom bottle texture.</li>
        <li>2. Submit the design for review.</li>
        <li>3. Once approved, the recipe and bottle appearance become available after a short processing delay.</li>
        <li>4. From there, your drink is brewed like any other server brew: cauldron, optional distillation, optional barrel ageing.</li>
      </ol>
      <p className="mt-3 text-sm text-[var(--tfmc-mist)]">
        For example, &quot;Big Gulp&quot;, a Milk Bucket + Rabbit Foot +
        <WikiItemLink name="Bark" /> recipe with 4 minutes cooking time, no distilling, oak wood, no ageing, difficulty 3
        and 0 alcohol.
      </p>

      <WikiSectionHeading id="ranks" intro="What each donator tier can put into a drink's name and appearance.">
        What each rank gets
      </WikiSectionHeading>
      <DataTable
        className="mt-4"
        minWidth="34rem"
        columns={[
          { header: "Rank", width: "10rem" },
          { header: "Name colours", align: "center" },
          { header: "Custom bottle texture", align: "center" },
        ]}
        rows={[
          [<RankName key="commoner" rank="Commoner" />, "0", "No"],
          [<RankName key="noble" rank="Noble" />, "1", "No"],
          [<RankName key="gilded" rank="Gilded" />, "2", "Yes"],
          [<RankName key="ascended" rank="Ascended" />, "8", "Yes"],
          [<RankName key="legacy" rank="Legacy" />, "8", "Yes"],
        ]}
      />

      <SeeAlso hrefs={["/wiki/brewing", "/wiki/cooking", "/wiki/materials", "/wiki/commands"]} />
    </WikiPage>
  );
}
