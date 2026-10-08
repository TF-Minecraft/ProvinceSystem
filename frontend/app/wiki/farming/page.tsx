import Link from "next/link";

import {
  CropGallery,
  DataTable,
  SeeAlso,
  WikiPage,
  WikiSectionHeading,
} from "@/app/components/wiki";
import StationModelViewer from "@/app/components/wiki/StationModelViewer";
import { WikiItemLink } from "@/app/components/wiki";
import { cropPlantModels } from "../data/crop-plant-models";

const crops = [
  ["Apple", "Fruits", true], ["Banana", "Fruits", true], ["Cactus Fruit", "Fruits", true],
  ["Cherry", "Fruits", true], ["Grape", "Fruits", true], ["Lemon", "Fruits", true],
  ["Lime", "Fruits", true], ["Orange", "Fruits", true], ["Peach", "Fruits", true],
  ["Pineapple", "Fruits", false], ["Pistachio", "Fruits", true], ["Plum", "Fruits", true],
  ["Strawberry", "Fruits", true], ["Tomato", "Fruits", false], ["Corn", "Vegetables", false],
  ["Cucumber", "Vegetables", false], ["Garlic", "Vegetables", false], ["Lettuce", "Vegetables", false],
  ["Mustard Seeds", "Vegetables", false], ["Olive", "Vegetables", true], ["Onion", "Vegetables", false],
  ["Rhubarb", "Vegetables", false], ["Rice", "Vegetables", false], ["Yeast", "Vegetables", false],
  ["Basil", "Spices", false], ["Black Pepper", "Spices", false], ["Cinnamon", "Spices", false],
  ["Nutmeg", "Spices", false], ["Spice Leaf", "Spices", false], ["Vanilla", "Spices", false],
] as const;

const cropGalleryItems = crops.map(([name, profession, regrows]) => ({
  name,
  profession,
  regrows,
  image: `/wiki/textures/crops/${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`,
  plantModel: cropPlantModels[name.toLowerCase().replace(/[^a-z0-9]+/g, "-")],
}));

export default function FarmingPage() {
  return (
    <WikiPage
      lastModified="2026-09-27"
      title="Farming"
      width="lg"
      intro={
        <>
          30 crops grow in watered <WikiItemLink name="Pot">pots</WikiItemLink>. Each is a small model in a{" "}
          <WikiItemLink name="Pot">pot</WikiItemLink>, not a vanilla crop block, and only grows while that{" "}
          <WikiItemLink name="Pot">pot</WikiItemLink> is watered. Almost every fruit, vegetable and spice used by <Link href="/wiki/cooking" className="underline decoration-dotted">Cooking</Link>{" "}
          and <Link href="/wiki/drink-builder" className="underline decoration-dotted">Drink Builder</Link>{" "}
          comes from.
        </>
      }
    >
      <WikiSectionHeading id="loop">
        The basic loop
      </WikiSectionHeading>
      <ol className="mt-4 flex flex-col gap-2 text-sm text-[var(--tfmc-mist)]">
        <li>1. Till ground into farmland as normal: pots sit on top of vanilla farmland.</li>
        <li>2. Water the <WikiItemLink name="Pot">pot</WikiItemLink>: right-click it with a water bottle/potion, or fill a Watering Can at water and right-click <WikiItemLink name="Pot">pots</WikiItemLink> to soak a 3×3 area. <WikiItemLink name="Pot">Pots</WikiItemLink> also absorb rain and adjacent water on their own.</li>
        <li>3. Right-click the watered <WikiItemLink name="Pot">pot</WikiItemLink> holding the crop&apos;s seed item. You need the matching profession, or you&apos;re told you can&apos;t plant it.</li>
        <li>4. Wait. The crop advances a growth stage only while the <WikiItemLink name="Pot">pot</WikiItemLink>&apos;s water is above a threshold.</li>
        <li>5. Optionally speed things up with Bone Meal or a <WikiItemLink name="Fertilizer">fertiliser</WikiItemLink>.</li>
        <li>6. Right-click the fully grown crop with an empty hand (or break it) to harvest: you get 2–4 produce plus a seed back.</li>
      </ol>

      <WikiSectionHeading
        id="crops"
        intro="'Regrows' means harvesting rolls the plant back to an early stage instead of destroying it, so it keeps producing."
      >
        Every crop
      </WikiSectionHeading>
      <CropGallery crops={cropGalleryItems} />
      <p className="mt-2 text-sm text-[var(--tfmc-mist)]">
        The Fruits profession unlocks 14 crops, Vegetables 10, and Spices 6: without the
        matching profession you can neither plant nor harvest that crop.
      </p>

      <WikiSectionHeading id="watering" intro="Water is the one thing every crop needs: no water, no growth.">
        Watering Cans
      </WikiSectionHeading>
      <div className="mt-4 grid items-start gap-4 md:grid-cols-[minmax(0,1fr)_18rem]">
        <DataTable
          minWidth="24rem"
          columns={[{ header: "Item" }, { header: "Detail" }]}
          rows={[
            ["Watering Can", "Holds 20 water, uses 5 per click, waters a 3×3 area. Refill by right-clicking a water source (+5 per click)."],
          ]}
        />
        <div>
          <p className="mb-2 text-sm font-semibold text-[var(--tfmc-cream)]">Watering Can</p>
          <StationModelViewer
            modelUrl="/wiki/models/farming/watering_can.json"
            textureUrl="/wiki/textures/farming/watering_can.png"
          />
        </div>
      </div>

      <SeeAlso hrefs={["/wiki/animal-husbandry", "/wiki/cooking", "/wiki/harvesting", "/wiki/materials", "/wiki/commands"]} />
    </WikiPage>
  );
}
