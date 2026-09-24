import { Callout, CommandTable, DataTable, SeeAlso, WikiPage, WikiSectionHeading } from "@/app/components/wiki";
import { animalHusbandryCommands } from "../data/animal-husbandry";

export default function AnimalHusbandryPage() {
  return (
    <WikiPage title="Animal Husbandry" lastModified="2026-09-24" intro="Raise livestock for milk, eggs, meat and materials. Claim your animals, keep them fed and clean, then breed successive generations for better genetics. You can own or co-own up to 15 animals.">
      <WikiSectionHeading id="getting-started">Claim your first animal</WikiSectionHeading>
      <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-[var(--tfmc-mist)]">
        <li>Get an Ownership Token, Universal Feed and a Glove.</li>
        <li>Rename the Ownership Token at an anvil to the name you want for your animal.</li>
        <li>Right-click the animal with the named token. Animals that need normal Minecraft taming must be tamed first. A successful claim uses the token.</li>
        <li>Sneak and right-click the animal with an empty hand to inspect its owners, care, genetics, products and growth progress.</li>
        <li>Return regularly. Use Universal Feed when it is Hungry and the Glove when it is Dirty.</li>
      </ol>
      <p className="mt-4 text-sm text-[var(--tfmc-mist)]">
        You can claim cows, pigs, sheep, chickens, goats, horses, donkeys, mules, camels and llamas. Bees follow normal Minecraft rules and do not count towards your animal limit.
      </p>
      <Callout title="Claim newborns before leaving" className="mt-4">
        Unclaimed livestock can disappear when the area unloads and loads again. Claim newborns while you are still at the pen. Ownership does not protect animals from players, mobs, fire or other damage.
      </Callout>

      <WikiSectionHeading id="ownership">Sharing and naming</WikiSectionHeading>
      <p className="mt-4 text-sm text-[var(--tfmc-mist)]">
        Right-click your animal with a Co-Ownership Token to link it, then right-click another player with that token to share ownership. A successful share consumes the token. Each shared animal counts towards every owner&apos;s limit of 15. Owners and co-owners can feed and clean the animal. Use another named Ownership Token to rename an animal you own.
      </p>

      <WikiSectionHeading id="care" intro="Happy means the animal is neither Hungry nor Dirty.">Daily care</WikiSectionHeading>
      <DataTable className="mt-4" columns={[{ header: "Situation" }, { header: "What happens" }]} rows={[
        ["Hungry", "Right-click with Universal Feed. One feed is used to clear hunger."],
        ["Dirty", "Right-click with a Glove. The glove is reusable."],
        ["Happy", "Care rises by 1 per hour, up to 200. Feeding and cleaning allow care to rise again; they do not instantly add care."],
        ["Time near the pen", "An animal becomes Hungry or Dirty after roughly 4 to 8 hours of loaded time, averaging 6 hours. Either state stops care gain."],
        ["Neglect", "After 24 hours with an uncleared negative state, care falls by 1 per hour. Leaving the area does not stop this loss."],
        ["Time away", "A happy animal can gain at most 8 hours of care while its area is unloaded. After more than 8 hours away, a negative state is added when the area loads again."],
      ]} />
      <p className="mt-4 text-sm text-[var(--tfmc-mist)]">
        These are real-world timings. What matters is whether the animal&apos;s area stays loaded, including by another player, rather than whether its owner is online. Hungry and Dirty appear beside the animal&apos;s name.
      </p>

      <WikiSectionHeading id="breeding">Breeding and growth</WikiSectionHeading>
      <p className="mt-4 text-sm text-[var(--tfmc-mist)]">
        Breed animals using their normal Minecraft breeding foods. Both parents must be grown, fed, clean and not neutered. Babies inherit a genetics roll based on their parents, with variation; care does not change inherited genetics. Newly claimed wild animals start with 0 to 20 genetics and 0 care. Genetics can reach 1,000 through breeding.
      </p>
      <p className="mt-4 text-sm text-[var(--tfmc-mist)]">
        Most babies take 1 hour to grow up; chickens take 45 minutes. They keep their baby appearance until that time is up. You can claim babies immediately, but they must mature before breeding, producing milk or eggs, or yielding slaughter goods.
      </p>
      <Callout title="Neutering is permanent" className="mt-4">
        Right-click an animal you own with the Neutering Tool to prevent it from breeding. This cannot be undone through normal animal care.
      </Callout>

      <WikiSectionHeading id="harvests">Collecting products</WikiSectionHeading>
      <DataTable className="mt-4" columns={[{ header: "Animal" }, { header: "Products and actions" }]} rows={[
        ["Cow", "Use an empty bucket for milk, with a 20-minute cooldown per animal. Slaughter yields a beef roast and leather drops."],
        ["Goat", "Use an empty bucket for milk, with a 20-minute cooldown per animal. Slaughter yields a goat roast and wool drops."],
        ["Sheep", "Shear for normal Minecraft wool. Slaughter yields a mutton roast and wool drops."],
        ["Chicken", "Mature, happy chickens lay an egg about every 10 minutes while the area stays loaded. They can also shed feathers. Slaughter yields a chicken roast and feather drops."],
        ["Pig", "Slaughter yields a pork roast, with a chance of Enchanted Dust at higher quality tiers."],
        ["Horse, donkey, mule and camel", "Slaughter yields a roast of that animal and leather drops."],
        ["Llama", "Slaughter yields a llama roast and feather drops."],
      ]} />
      <p className="mt-4 text-sm text-[var(--tfmc-mist)]">
        Slaughter goods come from the death of an owned, mature animal; no special slaughter tool is needed. Unowned livestock do not provide these goods. Chicken feather shedding has an 8-hour timer and a 15% chance per eligible check, so feathers are not guaranteed every 8 hours. Eggs and shedding are checked about once a minute while the animal is loaded, grown and happy.
      </p>

      <WikiSectionHeading id="quality" intro="Breeding raises potential; regular care helps you realise it.">Genetics, care and quality</WikiSectionHeading>
      <p className="mt-4 text-sm text-[var(--tfmc-mist)]">
        For amounts, effective genetics is genetics multiplied by care / 200, rounded down. At 100 care an animal uses half its genetics for yield; at 200 care it uses all of them. Roasts start at 1 carveable cut and gain another cut at each 125 effective genetics, up to 8, limited by the roast&apos;s own size.
      </p>
      <DataTable className="mt-4" columns={[{ header: "Genetics" }, { header: "Food quality ceiling" }]} rows={[
        ["0 to 199", "1 star"],
        ["200 to 399", "2 stars"],
        ["400 to 599", "3 stars"],
        ["600 to 799", "4 stars"],
        ["800 to 1,000", "5 stars"],
      ]} />
      <p className="mt-4 text-sm text-[var(--tfmc-mist)]">
        Food quality rolls between the star tier of effective genetics and the star tier of raw genetics. For example, 800 genetics and 100 care gives 400 effective genetics, so food can roll 3 to 5 stars. At 200 care, that animal produces 5-star food. Higher genetics also unlock better material drop tiers.
      </p>

      <WikiSectionHeading id="finding">Finding your animals</WikiSectionHeading>
      <p className="mt-4 text-sm text-[var(--tfmc-mist)]">
        <code>/animals</code> lists every animal you own or share, and the last place each one was seen. The count at the top is how many of your 15 slots are in use. Click a set of coordinates in chat to copy them. A shared animal is marked Co-owner. Visit an animal once if its place has not been recorded yet.
      </p>
      <CommandTable className="mt-4" commands={animalHusbandryCommands.commands} excludedStaffCommands={animalHusbandryCommands.excludedStaffCommands} />

      <WikiSectionHeading id="mounts">Caring for mounts</WikiSectionHeading>
      <p className="mt-4 text-sm text-[var(--tfmc-mist)]">
        Owned mounts can be ridden by their owners and co-owners. Inspect a mount to see its health, speed and jump stats. Genetics and care contribute to mount stats, so keep breeding stock healthy and check individual animals before choosing your mount.
      </p>
      <SeeAlso hrefs={["/wiki/cooking", "/wiki/farming", "/wiki/materials"]} />
    </WikiPage>
  );
}
