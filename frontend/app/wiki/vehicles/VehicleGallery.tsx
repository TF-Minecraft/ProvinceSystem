"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import WikiModelViewer from "@/app/components/wiki/WikiModelViewer";
import type { VehicleInfo } from "../data/vehicles";

export default function VehicleGallery({ vehicles }: { vehicles: VehicleInfo[] }) {
  const [selectedId, setSelectedId] = useState(vehicles[0]?.id ?? "");
  const selected = vehicles.find((vehicle) => vehicle.id === selectedId) ?? vehicles[0];
  const [skinId, setSkinId] = useState(selected?.skins[0]?.id ?? "");

  useEffect(() => {
    const selectFromUrl = () => {
      const requested = new URL(window.location.href).searchParams.get("vehicle");
      const match = vehicles.find((vehicle) => vehicle.slug === requested || vehicle.id === requested);
      const next = match ?? vehicles[0];
      setSelectedId(next?.id ?? "");
      setSkinId(next?.skins[0]?.id ?? "");
    };
    selectFromUrl();
    window.addEventListener("popstate", selectFromUrl);
    return () => window.removeEventListener("popstate", selectFromUrl);
  }, [vehicles]);

  if (!selected) return null;
  // Skins without a model are not offered; a vehicle with no previewable skin keeps its fallback note.
  const previewable = selected.skins.filter((item) => item.modelUrl);
  const availableSkins = previewable.length ? previewable : selected.skins;
  const skin = availableSkins.find((item) => item.id === skinId) ?? availableSkins[0];

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {vehicles.map((vehicle) => (
          <li key={vehicle.id}>
            <button
              type="button"
              aria-pressed={vehicle.id === selected.id}
              onClick={() => {
                setSelectedId(vehicle.id);
                setSkinId(vehicle.skins[0]?.id ?? "");
                const url = new URL(window.location.href);
                url.searchParams.set("vehicle", vehicle.slug);
                url.hash = "catalogue";
                window.history.pushState({}, "", url);
              }}
              className={`h-full w-full rounded border px-3 py-2 text-left text-sm transition-colors ${vehicle.id === selected.id ? "border-[var(--tfmc-accent)] bg-[color-mix(in_srgb,var(--tfmc-accent)_12%,transparent)] text-[var(--tfmc-cream)]" : "border-[color-mix(in_srgb,var(--tfmc-cream)_14%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_45%,transparent)] text-[var(--tfmc-mist)] hover:border-[color-mix(in_srgb,var(--tfmc-accent)_55%,transparent)] hover:text-[var(--tfmc-cream)]"}`}
            >
              {vehicle.name}
            </button>
          </li>
        ))}
      </ul>
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <Link
            href={`/wiki/vehicles/${selected.slug}`}
            className="font-[family-name:var(--font-fraunces)] text-xl text-[var(--tfmc-accent)] underline underline-offset-2"
          >
            {selected.name}
          </Link>
        </div>
        {/* The skin control lives inside the fixed-height preview box so that vehicles
          with and without skins produce the exact same layout height. */}
        <div className="relative h-80 sm:h-[26rem]">
          {skin?.modelUrl ? (
            <WikiModelViewer
              key={`${selected.id}-${skin.id}`}
              modelUrl={skin.modelUrl}
              skinUvUrl={skin.skinUvUrl}
              textures={skin.textures}
              label={`${selected.name}: ${skin.name}`}
              height="lg"
            />
          ) : (
            <p className="flex h-full w-full items-center justify-center rounded-md border border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_60%,transparent)] px-4 text-center text-sm text-[var(--tfmc-mist)]">
              Preview unavailable for this skin.
            </p>
          )}
          {availableSkins.length > 1 ? (
            <select
              aria-label={`${selected.name} skin`}
              value={skin?.id}
              onChange={(event) => setSkinId(event.target.value)}
              className="absolute left-2 top-2 z-10 rounded border border-[var(--tfmc-border)] bg-[var(--tfmc-forest-deep)] px-1 py-0.5 text-xs text-[var(--tfmc-cream)] shadow-sm"
            >
              {availableSkins.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          ) : null}
        </div>
        <p className="mt-2 text-sm text-[var(--tfmc-mist)]">
          {selected.kind} · {selected.requirement} · {selected.buildTime}
        </p>
      </div>
    </div>
  );
}
