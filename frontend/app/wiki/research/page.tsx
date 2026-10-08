import { Callout, DataTable, SeeAlso, StationLink, StatGrid, WikiItemLink, WikiPage, WikiSectionHeading } from "@/app/components/wiki";

export default function ResearchPage() {
  return <WikiPage lastModified="2026-09-27" title="Research" width="lg" intro="Research is an item-based deduction puzzle. Make a research paper at a Cartography Table, study it at a Lectern, and test materials to uncover and fill its hidden aspects.">
    <WikiSectionHeading id="start">Make a paper and start a project</WikiSectionHeading>
    <ol className="mt-4 list-decimal space-y-3 pl-6 text-sm text-[var(--tfmc-mist)]">
      <li>Sneak-right-click a Cartography Table to open the <StationLink name="Research Station" />. Combine one vanilla Paper and one <WikiItemLink name="Alchemy Powder" /> for one <WikiItemLink name="Parchment Paper" />. It takes 2 seconds.</li>
      <li>Combine one <WikiItemLink name="Parchment Paper" /> with the subject ingredient. Every paper, including an <WikiItemLink name="Unknown Research Paper" />, takes 5 seconds. Every station recipe grants 10 Herborist EXP. Recipes hide when you lack their ingredients.</li>
      <li>Hold the resulting paper and right-click a Lectern. Each lectern has one owner, so find another lectern if one is occupied. A Minor, Lesser, Greater or Ascendant Runestone (weapon or armour) can start its own project without first becoming a paper.</li>
      <li>Choose an experiment item, inspect its point preview, then confirm. Each different item may be tested once per project. Items with no aspect tags cannot be used.</li>
      <li>Use the Testing, Confirmed and Rejected labels to guide your next experiment. Fill every required aspect completely, then collect the result that drops above the lectern. It is not placed directly in your inventory.</li>
    </ol>
    <Callout variant="warning">Breaking the lectern destroys the project. The Scrap button also destroys it after a confirmation and does not refund the project.</Callout>
    <WikiSectionHeading id="experiments">How experiments reveal the answer</WikiSectionHeading>
    <DataTable columns={[{header:"Rule"},{header:"Meaning"}]} rows={[
      ["Primary / secondary aspect", "An item contributes more strongly to each primary aspect than to each secondary aspect. One item can contribute to several aspects."],
      ["Rejected", "An aspect outside the hidden recipe is rejected after enough testing. An experiment containing only rejected aspects is blocked."],
      ["Undiscovered Aspect", "Its row appears after you make some progress toward the required points. Intelligence makes it appear sooner."],
      ["Confirmed", "Its identity appears after further progress. Intelligence makes it appear sooner. Confirmation is not completion: keep filling it."],
      ["Product reveal", "The product appears after enough aspects are confirmed. Intelligence can make it appear sooner, but early reveal is not assured."],
      ["Completion", "Every hidden aspect must reach its full required points. Total points are not an experiment count, because tests may contribute to multiple aspects."],
    ]}/>
    <Callout title="A concrete experiment example"><WikiItemLink name="Arcane Crystal" /> is a primary Arcane item, so it supplies 2 Arcane points when tested. Crying Obsidian is secondary Arcane and supplies 1. These are distinct items, so each can be tested once. The <WikiItemLink name="Arcane Crystal" /> project requires 3 Arcane points, plus its Earth, Energy and Machine requirements.</Callout>
    <WikiSectionHeading id="focus">Budget your Mental Points</WikiSectionHeading>
    <StatGrid stats={[{label:"Maximum Focus",value:"150",note:"Stored per RP character; shared with Magic meditation"},{label:"Each experiment",value:"1 point"},{label:"Base refill",value:"10 per real hour",note:"Regenerates offline; 15 hours from empty to full"}]}/>
    <p className="mt-4 text-sm text-[var(--tfmc-mist)]">Wisdom adds 0.5 points per hour per attribute point; Intelligence adds 0.25. The regeneration interval is one hour. When exhausted, the lectern tells you that you are too tired to research. The aspect table counts distinct primary and secondary items; it is not a recipe or a list of required quantities.</p>
    <SeeAlso hrefs={["/wiki/magic","/wiki/codex","/wiki/gem-infusion","/wiki/materials","/wiki/stations"]}/>
  </WikiPage>;
}
