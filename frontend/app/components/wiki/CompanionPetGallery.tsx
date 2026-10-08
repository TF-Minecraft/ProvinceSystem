"use client";

import { useId, useState } from "react";
import { companionPetTypes } from "@/app/wiki/data/companion-pets";
import WikiModelViewer from "./WikiModelViewer";
import StationLink from "./StationLink";
import ItemChip from "./ItemChip";

export default function CompanionPetGallery() {
  const selectId = useId();
  const [selectedId, setSelectedId] = useState(companionPetTypes[0].id);
  const pet = companionPetTypes.find((candidate) => candidate.id === selectedId)!;

  return (
    <div className="my-5 rounded-md border border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] p-4">
      <label htmlFor={selectId} className="block text-sm font-semibold text-[var(--tfmc-cream)]">
        Meet the companions
      </label>
      <select
        id={selectId}
        value={selectedId}
        onChange={(event) => setSelectedId(event.target.value)}
        className="mt-2 mb-4 w-full rounded border border-[color-mix(in_srgb,var(--tfmc-cream)_18%,transparent)] bg-[var(--tfmc-forest-deep)] p-2 text-sm text-[var(--tfmc-cream)] focus-visible:outline-2 focus-visible:outline-[var(--tfmc-accent)]"
      >
        {companionPetTypes.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
        ))}
      </select>
      <p aria-live="polite" aria-atomic="true" className="mb-4 text-sm text-[var(--tfmc-mist)]">
        Hatch {pet.name} with a <ItemChip name={pet.egg} texture={pet.eggTexture} link={false} />. Craft it at the{" "}
        <StationLink name="Animal Station"><ItemChip name="Animal Station" texture="/wiki/thumbnails/stations/animal-station.webp" link={false} /></StationLink>.
      </p>
      <WikiModelViewer
        key={pet.id}
        modelUrl={pet.modelUrl}
        textures={pet.textures}
        label={pet.name}
        height="sm"
      />
    </div>
  );
}
