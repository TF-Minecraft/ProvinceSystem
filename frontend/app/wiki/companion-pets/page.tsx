import {
  Callout,
  CompanionPetGallery,
  DataTable,
  ItemChip,
  SeeAlso,
  StationLink,
  WikiPage,
  WikiSectionHeading,
} from "@/app/components/wiki";
import WikiModelViewer from "@/app/components/wiki/WikiModelViewer";
import { companionPetItems, companionPetTypes, petHousePreview } from "@/app/wiki/data/companion-pets";

function PetItem({ id }: { id: keyof typeof companionPetItems }) {
  return <ItemChip {...companionPetItems[id]} link={false} />;
}

function AnimalStation() {
  return <StationLink name="Animal Station"><ItemChip name="Animal Station" texture="/wiki/thumbnails/stations/animal-station.webp" link={false} /></StationLink>;
}

function MedicineStation() {
  return <StationLink name="Medicine Station"><ItemChip name="Medicine Station" texture="/wiki/thumbnails/stations/medicine-station.webp" link={false} /></StationLink>;
}

export default function CompanionPetsPage() {
  return (
    <WikiPage
      lastModified="2026-10-10"
      title="Companion Pets"
      intro="A companion is a little personality to share your adventures with. Give it a name, look after it, play together and teach it tricks. The more time you spend together, the stronger your bond becomes."
    >
      <WikiSectionHeading id="hatching" intro="Choose a companion you would like to spend time with.">
        Meet your companion
      </WikiSectionHeading>
      <p className="text-sm text-[var(--tfmc-mist)]">
        You can have dogs, cats, foxes and even a frog. Each pet has its own personality:
        some are friendly and eager to play, while others are shy or protective of their space.
        They keep their name, preferences and learned tricks as you spend time together.
      </p>
      <p className="mt-3 text-sm text-[var(--tfmc-mist)]">
        Craft companion eggs at the <AnimalStation />. Most require the Pet Master perk in
        the Forager profession; eight companions require a donator rank instead.
        Their recipes appear in the station once you meet the requirement below.
        Right-click with an egg and follow the
        naming prompts in chat to welcome your new pet. Once it is beside you,
        sneak-right-click it with an empty hand to open its care sheet. This is where you
        can see how it feels, its personality and your growing bond.
      </p>
      <CompanionPetGallery />
      <DataTable
        caption="Companion egg crafting requirements"
        columns={[{ header: "Companion" }, { header: "Unlock" }]}
        rows={companionPetTypes.map((pet) => [
          pet.name,
          pet.unlock === "Pet Master" ? "Pet Master perk" : `${pet.unlock} donator rank or higher`,
        ])}
      />
      <p className="mt-3 text-sm text-[var(--tfmc-mist)]">
        Donator ranks inherit the egg recipes from lower ranks: Noble, Gilded, Ascended,
        then Legacy. Donator eggs require the rank in place of Pet Master.
      </p>
      <p className="mt-3 text-sm text-[var(--tfmc-mist)]">
        Ordinary wolves and cats are also supported as companions. They hatch from
        Wolf Spawn Eggs and Cat Spawn Eggs, whose separate Animal Station recipes
        use the Breeder I perk.
      </p>
      <p className="mt-3 text-sm text-[var(--tfmc-mist)]">
        Each companion has its own egg. Craft eggs, food, grooming supplies, treats and toys at the{" "}
        <AnimalStation /> to prepare for your adventures together.
      </p>

      <WikiSectionHeading id="care" intro="A happy companion needs food, attention, rest and a little grooming.">
        Looking after your pet
      </WikiSectionHeading>
      <p className="text-sm text-[var(--tfmc-mist)]">
        Watch how your pet behaves and check its care sheet when something seems wrong.
        Hunger, mood, energy, cleanliness and health all matter. Petting it with an empty
        hand lets you check in: it may show that it is hungry, tired, dirty or feeling unwell.
        Food helps with hunger, play and affection lift its spirits, and sleep gives it energy
        for another outing.
      </p>
      <DataTable
        caption="Care supplies for every companion, including frogs"
        columns={[{ header: "What you want to do" }, { header: "Item you need" }, { header: "How to use it" }]}
        rows={[
          ["Feed your pet", <><PetItem id="meatMeal" /> or <PetItem id="fishMeal" /></>, "Right-click your pet to give it food."],
          ["Clean and groom it", <PetItem id="brush" />, "Right-click to groom your pet. You keep the brush."],
          ["Treat a sick pet", <PetItem id="medicine" />, <>A Physician crafts it at the <MedicineStation />. Right-click a sick or weakened pet to give it medicine.</>],
          ["Train and reward it", <><PetItem id="fishSnack" /> or <PetItem id="biscuit" /></>, "Hold a treat to begin training, then give treats as rewards."],
          ["Play fetch", <><PetItem id="ball" />, <PetItem id="bone" />, <PetItem id="rope" />, <PetItem id="mouse" /> or <PetItem id="teddy" /></>, <>Craft a toy at the <AnimalStation /> and throw it for your pet to fetch.</>],
          ["Make a shelter", <PetItem id="house" />, <>Craft it at the <AnimalStation />, place it on the ground and right-click to open your shelter.</>],
          ["Give affection", "Empty hand", "Right-click your pet to check on it and give it attention."],
        ]}
      />
      <p className="mt-3 text-sm text-[var(--tfmc-mist)]">
        Get food, grooming supplies, treats and toys at the{" "}
        <AnimalStation />. For a sick companion, get <PetItem id="medicine" />,
        crafted by a Physician at the <MedicineStation />. These supplies work for all companions.
        <PetItem id="meatMeal" /> and <PetItem id="fishMeal" /> are their meals;
        {" "}<PetItem id="fishSnack" /> and <PetItem id="biscuit" /> are training rewards.
        Food, medicine and rewarded treats are used up.
        Keep your pet fed and rested before asking it to practise or play, and avoid feeding
        it more when it is already full.
      </p>
      <p className="mt-3 text-sm text-[var(--tfmc-mist)]">
        A neglected pet can become ill and too weak to stand. Medicine helps it recover,
        but it still needs food, rest and care. Other players can help feed, groom and heal
        your companion too.
      </p>

      <WikiSectionHeading id="play">
        Playing
      </WikiSectionHeading>
      <p className="text-sm text-[var(--tfmc-mist)]">
        Choose a <PetItem id="ball" />, <PetItem id="bone" />, <PetItem id="rope" />,
        {" "}<PetItem id="mouse" /> or <PetItem id="teddy" /> at the{" "}
        <AnimalStation /> and throw it for your pet to fetch.
        It chases the toy and brings it
        back to you. Play cheers it up, but a tired or sick companion needs a rest first.
      </p>

      <WikiSectionHeading id="training" intro="Learning takes patience, encouragement and treats.">
        Teaching tricks
      </WikiSectionHeading>
      <p className="text-sm text-[var(--tfmc-mist)]">
        Your companion already knows how to follow you. You can teach it more, from sitting
        and staying in place to jumping, offering a paw or lying down to rest. Frogs have
        their own gestures, including sticking out their tongue and croaking. Open the
        pet&apos;s <strong>Tricks</strong> menu to see what it can learn and how it is progressing.
      </p>
      <p className="mt-3 text-sm text-[var(--tfmc-mist)]">
        When your pet is healthy, fed and rested, hold a <PetItem id="fishSnack" /> or
        {" "}<PetItem id="biscuit" /> and right-click it to begin a training session. Choose
        a word or short phrase in chat, then pick the trick you want it to mean. Practise
        together and give a treat promptly after each attempt. Early efforts can be clumsy;
        encouragement helps, and rewarded successes teach it more quickly.
      </p>
      <p className="mt-3 text-sm text-[var(--tfmc-mist)]">
        Keep sessions relaxed and give your pet a break when it stops listening. Once it
        has learned a trick, you can ask for it using the word you taught, without needing
        a treat every time. Look at your pet as you speak, or include its name, such as
        <em> Toby sit</em>, to address it nearby. Coming over to you and following you are
        different tricks: one calls it close, while the other asks it to accompany you.
      </p>

      <WikiSectionHeading id="shelter" intro="A place to keep your companions between adventures.">
        Giving your pets a home
      </WikiSectionHeading>
      <p className="text-sm text-[var(--tfmc-mist)]">
        Craft a <PetItem id="house" /> at the <AnimalStation />,
        place it on the ground and right-click it to browse your companions.
        Only you can open your house. Moving or breaking it leaves your stored companions
        safe: place a house again whenever you want to visit them.
      </p>
      <div className="my-5">
        <WikiModelViewer {...petHousePreview} label="Pet House" height="sm" />
      </div>
      <p className="mt-3 text-sm text-[var(--tfmc-mist)]">
        Sheltered pets keep their needs as they are, ready for your next visit. Their needs
        also pause while you are offline. When you are playing, companions left outside
        still need looking after, so make the shelter part of your routine.
      </p>
      <Callout variant="warning">
        Keep your companion away from danger: a pet that dies is lost. Releasing a pet
        through <strong>Release forever</strong> also means saying goodbye permanently.
      </Callout>

      <SeeAlso hrefs={["/wiki/animal-husbandry", "/wiki/characters", "/wiki/server-features"]} />
    </WikiPage>
  );
}
