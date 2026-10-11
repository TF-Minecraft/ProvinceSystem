"use client";

import { useState } from "react";
import StationModelViewer from "./StationModelViewer";

export interface CropGalleryItem {
  name: string;
  profession: string;
  regrows: boolean;
  image: string;
  plantModel?: { modelUrl: string; textureUrls: Record<string, string> };
}

export default function CropGallery({ crops }: { crops: CropGalleryItem[] }) {
  const [selectedName, setSelectedName] = useState(crops[0]?.name ?? "");
  const selected = crops.find((crop) => crop.name === selectedName) ?? crops[0];
  if (!selected) return null;

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {crops.map((crop) => (
          <li key={crop.name}>
            <button
              type="button"
              aria-pressed={crop.name === selected.name}
              onClick={() => setSelectedName(crop.name)}
              className={`h-full w-full rounded border px-3 py-2 text-left text-sm transition-colors ${
                crop.name === selected.name
                  ? "border-[var(--tfmc-accent)] bg-[color-mix(in_srgb,var(--tfmc-accent)_12%,transparent)] text-[var(--tfmc-cream)]"
                  : "border-[color-mix(in_srgb,var(--tfmc-cream)_14%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_45%,transparent)] text-[var(--tfmc-mist)] hover:border-[color-mix(in_srgb,var(--tfmc-accent)_55%,transparent)] hover:text-[var(--tfmc-cream)]"
              }`}
            >
              {crop.name}
            </button>
          </li>
        ))}
      </ul>
      <div className="flex min-h-64 flex-col items-center justify-center rounded-md border border-[color-mix(in_srgb,var(--tfmc-cream)_14%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_45%,transparent)] p-5 text-center">
        {selected.plantModel ? (
          <div className="w-full" aria-label={`3D preview of a mature ${selected.name} plant`}>
            <StationModelViewer
              key={selected.plantModel.modelUrl}
              modelUrl={selected.plantModel.modelUrl}
              textureUrls={selected.plantModel.textureUrls}
            />
          </div>
        ) : null}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={selected.image}
          src={selected.image}
          alt={selected.name}
          className="mt-3 h-20 w-20 [image-rendering:pixelated]"
        />
        <h3 className="mt-4 font-[family-name:var(--font-fraunces)] text-xl text-[var(--tfmc-cream)]">
          {selected.name}
        </h3>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 text-sm">
          <dt className="text-[var(--tfmc-stone)]">Profession</dt>
          <dd className="text-[var(--tfmc-mist)]">{selected.profession}</dd>
          <dt className="text-[var(--tfmc-stone)]">Regrows</dt>
          <dd className="text-[var(--tfmc-mist)]">{selected.regrows ? "Yes" : "No"}</dd>
        </dl>
      </div>
    </div>
  );
}
