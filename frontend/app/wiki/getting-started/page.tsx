import Link from "next/link";
import { DataTable, SeeAlso, WikiPage, WikiSectionHeading } from "@/app/components/wiki";
import { gettingStartedSection } from "../data/getting-started";

const steps = [
  ["1", "Create a roleplay character", "/rpcharacter create", "/wiki/characters"],
  ["2", "Claim a starting kit", "/rpcharacter kit starter", "/wiki/characters"],
  ["3", "Learn where custom recipes are made", "Find the station listed on a recipe, then interact with its block", "/wiki/stations"],
  ["4", "Locate and research custom materials, such as steel", "Look up where to find materials and how to make them", "/wiki/materials"],
] as const;

export default function GettingStartedPage() {
  return (
    <WikiPage lastModified="2026-09-12" title={gettingStartedSection.nav.label} intro="Create your character, then follow the guides for the activity you want to play.">
      <WikiSectionHeading id="first-steps">Your first steps</WikiSectionHeading>
      <DataTable columns={[{header:"Step"},{header:"Goal"},{header:"What to do"},{header:"Guide"}]} rows={steps.map(([n,goal,action,href])=>[n,goal,action.startsWith("/") ? <code key={`${n}-action`} className="text-[var(--tfmc-accent)]">{action}</code> : action,<Link key={href} href={href} className="text-[var(--tfmc-accent)] hover:underline">Read guide</Link>])}/>

      <WikiSectionHeading id="choose-path">Choose your next guide</WikiSectionHeading>
      <DataTable columns={[{header:"If you want to…"},{header:"Start here"}]} rows={[
        ["Craft weapons, armour, tools or consumables",<Link key="gear" href="/wiki/advanced-crafting" className="text-[var(--tfmc-accent)] hover:underline">Weapons and armour</Link>],
        ["Farm crops, fish or collect materials",<Link key="farm" href="/wiki/farming" className="text-[var(--tfmc-accent)] hover:underline">Farming</Link>],
        ["Cook food or build drinks",<Link key="cook" href="/wiki/cooking" className="text-[var(--tfmc-accent)] hover:underline">Cooking</Link>],
        ["Learn magic and research",<Link key="magic" href="/wiki/magic" className="text-[var(--tfmc-accent)] hover:underline">Magic</Link>],
        ["Trade with other players",<Link key="economy" href="/wiki/economy" className="text-[var(--tfmc-accent)] hover:underline">Economy</Link>],
        ["Look up every documented command",<Link key="commands" href="/wiki/commands" className="text-[var(--tfmc-accent)] hover:underline">Command Index</Link>],
      ]}/>
      <SeeAlso hrefs={["/wiki/characters","/wiki/classes","/wiki/commands"]}/>
    </WikiPage>
  );
}
