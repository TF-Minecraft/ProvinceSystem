import {
  Callout,
  CompanionPetGallery,
  DataTable,
  SeeAlso,
  StationLink,
  WikiPage,
  WikiSectionHeading,
} from "@/app/components/wiki";

export default function CompanionPetsPage() {
  return (
    <WikiPage
      lastModified="2026-10-02"
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
        Get the egg for the companion you want at the <StationLink name="Animal Station" />.
        Right-click with it and follow the
        naming prompts in chat to welcome your new pet. Once it is beside you,
        sneak-right-click it with an empty hand to open its care sheet. This is where you
        can see how it feels, its personality and your growing bond.
      </p>
      <CompanionPetGallery />
      <p className="mt-3 text-sm text-[var(--tfmc-mist)]">
        Each companion has its own egg. Craft eggs and pet supplies at the{" "}
        <StationLink name="Animal Station" /> to prepare for your adventures together.
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
          ["Feed your pet", "Universal Feed", "Right-click your pet to give it food."],
          ["Clean and groom it", "Glove", "Right-click to groom your pet. You keep the glove."],
          ["Treat a sick pet", "Green Concoction or Red Concoction", "Right-click a sick or weakened pet to give it medicine."],
          ["Train and reward it", "Meat Treat or Fish Treat", "Hold a treat to begin training, then give treats as rewards."],
          ["Play fetch", "--- (toy names pending)", "Craft pet toys at the Animal Station and throw one for your pet to fetch."],
          ["Make a shelter", "Pet Shelter", "Craft it at the Animal Station, place it on the ground and right-click to open your shelter."],
          ["Give affection", "Empty hand", "Right-click your pet to check on it and give it attention."],
        ]}
      />
      <p className="mt-3 text-sm text-[var(--tfmc-mist)]">
        Get food, grooming supplies, medicine, treats and toys at the{" "}
        <StationLink name="Animal Station" />. These supplies work for all companions.
        Universal Feed is their meal; Meat Treat
        and Fish Treat are training rewards. Food, medicine and rewarded treats are used up.
        Keep your pet fed and rested before asking it to practise or play, and avoid feeding
        it more when it is already full.
      </p>
      <p className="mt-3 text-sm text-[var(--tfmc-mist)]">
        A neglected pet can become ill and too weak to stand. Medicine helps it recover,
        but it still needs food, rest and care. Other players can help feed, groom and heal
        your companion too.
      </p>

      <WikiSectionHeading id="play" intro="Make room for the small moments that give your companion its character.">
        Playing and spending time together
      </WikiSectionHeading>
      <p className="text-sm text-[var(--tfmc-mist)]">
        Craft a pet toy at the <StationLink name="Animal Station" /> and throw it for your
        pet to fetch. It chases the toy and brings it
        back to you. Play cheers it up, but a tired or sick companion needs a rest first.
        Between games, an empty-hand pet is a simple way to give it affection. Some pets
        roll onto their back for belly rubs; keep petting them to enjoy the moment together.
      </p>
      <p className="mt-3 text-sm text-[var(--tfmc-mist)]">
        While you linger in one place, a following pet may explore nearby, watch the people
        around you or get curious about another companion. Pets can sniff each other, play
        chase and sometimes dig up a little gift for their owner. If a protective pet starts
        barking, soothe it with a few empty-hand right-clicks.
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
        When your pet is healthy, fed and rested, hold a <strong>Meat Treat</strong> or
        <strong> Fish Treat</strong> and right-click it to begin a training session. Choose
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
        Craft a <strong>Pet Shelter</strong> at the <StationLink name="Animal Station" />
        {" "}and place it on the ground. Right-click your shelter to browse your companions
        and choose who comes along. Only you can open your shelter.
        From a pet&apos;s care sheet you can bring it out, call it to your side,
        send it back to the shelter or give it a new name. You can have several companions
        with you and choose who joins each outing.
      </p>
      <p className="mt-3 text-sm text-[var(--tfmc-mist)]">
        Moving or breaking your shelter does not remove the companions you have stored.
        Place a shelter again whenever you need to visit them.
      </p>
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
