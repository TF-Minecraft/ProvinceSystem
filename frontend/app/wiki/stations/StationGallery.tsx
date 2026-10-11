"use client";

import Link from "next/link";
import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import SimpleCubeViewer from "../../components/wiki/SimpleCubeViewer";
import StationModelViewer from "../../components/wiki/StationModelViewer";
import { wikiBlockPreviewHeight } from "../../components/wiki/wikiStyles";
import type { StationInfo } from "../data/types";

export default function StationGallery({
  stations,
  blurbs,
}: {
  stations: StationInfo[];
  blurbs?: Record<string, ReactNode>;
}) {
  const [selectedSlug, setSelectedSlug] = useState(stations[0]?.slug ?? "");

  useEffect(() => {
    const selectFromUrl = () => {
      const requested = new URL(window.location.href).searchParams.get("station");
      setSelectedSlug(stations.some((station) => station.slug === requested) ? requested! : (stations[0]?.slug ?? ""));
    };
    selectFromUrl();
    window.addEventListener("popstate", selectFromUrl);
    return () => window.removeEventListener("popstate", selectFromUrl);
  }, [stations]);

  const selected = stations.find((station) => station.slug === selectedSlug) ?? stations[0];
  if (!selected) return null;

  const choose = (slug: string) => {
    setSelectedSlug(slug);
    const url = new URL(window.location.href);
    url.searchParams.set("station", slug);
    url.hash = "catalogue";
    window.history.pushState({}, "", url);
  };
  const chooseWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number | undefined;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % stations.length;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + stations.length) % stations.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = stations.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    choose(stations[next].slug);
    event.currentTarget.closest("ul")?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
  };

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
      <ul className="grid auto-rows-fr grid-cols-2 gap-2 self-start sm:grid-cols-3">
        {stations.map((station, index) => (
          <li key={station.slug}>
            <button
              type="button"
              aria-pressed={station.slug === selected.slug}
              onClick={() => choose(station.slug)}
              onKeyDown={(event) => chooseWithKeyboard(event, index)}
              className={`h-full min-h-12 w-full rounded border px-3 py-2 text-left text-sm transition-colors ${station.slug === selected.slug ? "border-[var(--tfmc-accent)] bg-[color-mix(in_srgb,var(--tfmc-accent)_12%,transparent)] text-[var(--tfmc-cream)]" : "border-[color-mix(in_srgb,var(--tfmc-cream)_14%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_45%,transparent)] text-[var(--tfmc-mist)] hover:border-[color-mix(in_srgb,var(--tfmc-accent)_55%,transparent)] hover:text-[var(--tfmc-cream)]"}`}
            >
              {station.name}
            </button>
          </li>
        ))}
      </ul>
      <div className="min-w-0">
        {/* Name and blurb sit directly above the 3D preview, so any height change
          here shoves the preview (and the link under it) up or down when you
          pick a different station. Both reserve a fixed height instead, so the
          column is the same height for every station. Short blurbs leave the
          spare lines blank.

          Name: `text-xl` is a 1.75rem line box. The widest name at the 18rem
          minimum column width ("Ingredient Converter") still fits one line, so
          one line is reserved.
          Blurb: `leading-5` is a 1.25rem line box. The longest blurb (Bird
          Mailbox, 100 characters) wraps to 3 lines at 18rem, hence
          3 x 1.25rem = 3.75rem. */}
        <div className="min-h-7 leading-7">
          <Link
            href={`/wiki/stations/${selected.slug}`}
            className="font-[family-name:var(--font-fraunces)] text-xl text-[var(--tfmc-accent)] underline underline-offset-2"
          >
            {selected.name}
          </Link>
        </div>
        <p className="mb-3 mt-1 min-h-[3.75rem] text-sm leading-5 text-[var(--tfmc-mist)]">
          {blurbs?.[selected.slug] ?? selected.blurb}
        </p>
        <div aria-label={`3D preview of ${selected.name}`}>
          {selected.model ? (
            <StationModelViewer
              key={selected.slug}
              modelUrl={selected.model.url}
              textureUrl={selected.model.texture}
              textureUrls={selected.model.textures}
              textureAnimationUrl={selected.model.textureAnimationUrl}
            />
          ) : selected.cubeFaces ? (
            <SimpleCubeViewer key={selected.slug} faces={selected.cubeFaces} />
          ) : (
            // Same reserved height as the two viewers, via the shared constant, so
            // a station without a model does not resize the column either.
            <div
              className={`flex items-center justify-center rounded-md border border-[var(--tfmc-border)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_60%,transparent)] p-5 ${wikiBlockPreviewHeight}`}
            >
              <img
                src={selected.fallbackTexture ?? selected.icon}
                alt=""
                className="h-20 w-20 [image-rendering:pixelated]"
              />
            </div>
          )}
        </div>
        <Link
          href={`/wiki/stations/${selected.slug}`}
          className="mt-3 inline-block text-sm text-[var(--tfmc-accent)] underline underline-offset-2"
        >
          View station details
        </Link>
      </div>
    </div>
  );
}
