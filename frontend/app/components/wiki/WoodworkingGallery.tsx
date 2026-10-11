"use client";

import { useState } from "react";
import StationModelViewer from "./StationModelViewer";

export interface WoodworkingGalleryItem {
  id: string;
  name: string;
  category: string;
  modelUrl: string;
  textureUrls: Record<string, string>;
  textureUrl?: string;
  textureAnimationUrl?: string;
}

const tab = (active: boolean) =>
  `rounded border px-3 py-1.5 text-sm transition-colors ${
    active
      ? "border-[var(--tfmc-accent)] bg-[color-mix(in_srgb,var(--tfmc-accent)_12%,transparent)] text-[var(--tfmc-cream)]"
      : "border-[color-mix(in_srgb,var(--tfmc-cream)_14%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_45%,transparent)] text-[var(--tfmc-mist)] hover:border-[color-mix(in_srgb,var(--tfmc-accent)_55%,transparent)] hover:text-[var(--tfmc-cream)]"
  }`;

/** Style tabs read as a heading-level tab bar, so they are not mistaken for the piece buttons below. */
const styleTab = (active: boolean) =>
  `-mb-px border-b-2 px-1 pb-2 font-[family-name:var(--font-fraunces)] text-lg transition-colors ${
    active
      ? "border-[var(--tfmc-accent)] text-[var(--tfmc-cream)]"
      : "border-transparent text-[var(--tfmc-stone)] hover:text-[var(--tfmc-cream)]"
  }`;

export default function WoodworkingGallery({
  categories,
  projects,
}: {
  categories: { id: string; name: string }[];
  projects: WoodworkingGalleryItem[];
}) {
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [selectedId, setSelectedId] = useState("");
  const visible = projects.filter((project) => project.category === categoryId);
  const selected = visible.find((project) => project.id === selectedId) ?? visible[0];
  if (!selected) return null;

  return (
    <div className="mt-4">
      <div
        role="tablist"
        aria-label="Furniture style"
        className="flex flex-wrap gap-x-6 gap-y-1 border-b border-[color-mix(in_srgb,var(--tfmc-cream)_14%,transparent)]"
      >
        {categories.map((category) => (
          <button
            key={category.id}
            type="button"
            role="tab"
            aria-selected={category.id === categoryId}
            onClick={() => setCategoryId(category.id)}
            className={styleTab(category.id === categoryId)}
          >
            {category.name}
          </button>
        ))}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <ul className="grid grid-cols-2 content-start gap-2 sm:grid-cols-3">
          {visible.map((project) => (
            <li key={project.id}>
              <button
                type="button"
                aria-pressed={project.id === selected.id}
                onClick={() => setSelectedId(project.id)}
                className={`h-full w-full text-left ${tab(project.id === selected.id)}`}
              >
                {project.name}
              </button>
            </li>
          ))}
        </ul>
        <div className="flex flex-col rounded-md border border-[color-mix(in_srgb,var(--tfmc-cream)_14%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_45%,transparent)] p-5">
          <div className="w-full" aria-label={`3D preview of ${selected.name}`}>
            <StationModelViewer
              key={selected.id}
              modelUrl={selected.modelUrl}
              textureUrl={selected.textureUrl}
              textureUrls={selected.textureUrl ? undefined : selected.textureUrls}
              textureAnimationUrl={selected.textureAnimationUrl}
            />
          </div>
          <h3 className="mt-4 text-center font-[family-name:var(--font-fraunces)] text-xl text-[var(--tfmc-cream)]">
            {selected.name}
          </h3>
        </div>
      </div>
    </div>
  );
}
