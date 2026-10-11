"use client";

import { useState } from "react";
import WikiModelViewer from "@/app/components/wiki/WikiModelViewer";
import type { VehicleSkin } from "../data/vehicles";

/** Only the selected skin owns a renderer; the index never mounts previews. */
export default function VehiclePreview({ skins: allSkins }: { skins: VehicleSkin[] }) {
  // Skins without a model are not offered; a vehicle with no previewable skin keeps its fallback note.
  const previewable = allSkins.filter((item) => item.modelUrl);
  const skins = previewable.length ? previewable : allSkins;
  const [selected, setSelected] = useState(skins[0].id);
  const skin = skins.find((item) => item.id === selected) ?? skins[0];
  return (
    <section className="mt-6" aria-label="Vehicle model">
      {skins.length > 1 ? (
        <label className="mb-3 flex flex-wrap items-center gap-3 text-sm text-[var(--tfmc-cream)]">
          Preview skin
          <select
            value={skin.id}
            onChange={(event) => setSelected(event.target.value)}
            className="rounded border border-[var(--tfmc-stone)] bg-[var(--tfmc-forest-deep)] px-3 py-2"
          >
            {skins.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {skin.modelUrl ? (
        <WikiModelViewer
          key={skin.id}
          modelUrl={skin.modelUrl}
          skinUvUrl={skin.skinUvUrl}
          textures={skin.textures}
          label={skin.name}
          height="lg"
        />
      ) : (
        <div
          role="note"
          className="flex min-h-64 items-center justify-center rounded border border-dashed border-[var(--tfmc-accent)] p-8 text-center text-[var(--tfmc-cream)]"
        >
          {skin.name}: preview unavailable.
        </div>
      )}
      <p className="mt-2 text-xs text-[var(--tfmc-mist)]">
        Drag to rotate; scroll to zoom. Choose a skin to see it on this vehicle.
      </p>
    </section>
  );
}
