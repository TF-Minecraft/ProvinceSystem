import Link from "next/link";
import { notFound } from "next/navigation";
import { WikiItemText, WikiPage, WikiSectionHeading } from "@/app/components/wiki";
import CraftingGrid from "@/app/components/wiki/CraftingGrid";
import StationModelViewer from "@/app/components/wiki/StationModelViewer";
import SimpleCubeViewer from "@/app/components/wiki/SimpleCubeViewer";
import { getRecipesForStation, getStationBySlug, stations, type Recipe } from "@/app/wiki/data";

export function generateStaticParams() {
  return stations.map((station) => ({ slug: station.slug }));
}

function RecipeCards({ recipes }: { recipes: readonly Recipe[] }) {
  const groups = new Map<string, Recipe[]>();
  for (const recipe of recipes) {
    const name = recipe.category ?? "Other";
    groups.set(name, [...(groups.get(name) ?? []), recipe]);
  }

  if (recipes.length >= 24 && groups.size > 1) {
    return (
      <div className="mt-4 space-y-3">
        {[...groups].map(([name, entries], index) => (
          <details
            key={name}
            open={index === 0}
            className="rounded-md border border-[color-mix(in_srgb,var(--tfmc-cream)_14%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_35%,transparent)]"
          >
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-[var(--tfmc-cream)]">
              {name} ({entries.length})
            </summary>
            <div className="grid gap-4 border-t border-[color-mix(in_srgb,var(--tfmc-cream)_10%,transparent)] p-4 md:grid-cols-2">
              {entries.map((recipe) => <CraftingGrid key={recipe.key} recipe={recipe} />)}
            </div>
          </details>
        ))}
      </div>
    );
  }

  return (
    <div className="mt-4 grid gap-4 md:grid-cols-2">
      {recipes.map((recipe) => <CraftingGrid key={recipe.key} recipe={recipe} />)}
    </div>
  );
}

export default async function StationDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const station = getStationBySlug(slug);
  if (!station) notFound();

  const recipes = getRecipesForStation(station.name);
  const acquisitionRecipe = station.craftRecipe ?? station.vanillaBlock?.recipe;

  return (
    <WikiPage lastModified="2026-09-27" title={station.name} intro={<WikiItemText text={station.blurb} excludeHref={`/wiki/stations/${station.slug}`} />} width="lg">
      <Link href="/wiki/stations" className="mt-3 inline-block text-xs text-[var(--tfmc-mist)] hover:text-[var(--tfmc-cream)]">
        &larr; Back to Stations
      </Link>

      {/* Recipe and rotating model side by side, as on the Resource Nodes page. */}
      <WikiSectionHeading id="obtaining">{acquisitionRecipe ? "How to obtain it" : "Preview"}</WikiSectionHeading>
      <div className={`mt-4 grid gap-4 ${acquisitionRecipe ? "lg:grid-cols-[minmax(0,1fr)_22rem]" : "max-w-sm"}`}>
        {acquisitionRecipe ? <CraftingGrid recipe={acquisitionRecipe} /> : null}
        <div aria-label={`3D preview of ${station.name}`}>
          {station.model ? (
            <StationModelViewer modelUrl={station.model.url} textureUrl={station.model.texture} textureUrls={station.model.textures} textureAnimationUrl={station.model.textureAnimationUrl} />
          ) : station.cubeFaces ? (
            <SimpleCubeViewer faces={station.cubeFaces} />
          ) : (
            <div className="flex h-40 items-center justify-center rounded-md border border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_60%,transparent)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={station.fallbackTexture ?? station.icon} alt="" className="h-16 w-16 object-contain [image-rendering:pixelated]" />
            </div>
          )}
        </div>
      </div>

      <WikiSectionHeading id="using">How to use it</WikiSectionHeading>
      <p className="mt-3 text-sm text-[var(--tfmc-mist)]">{station.interaction}</p>

      <WikiSectionHeading id="recipes" intro={recipes.length ? `${recipes.length} recipes use this station.` : station.guide ? "See its guide below." : undefined}>
        Recipes crafted here
      </WikiSectionHeading>
      {recipes.length ? <RecipeCards recipes={recipes} /> : station.guide ? (
        <p className="mt-3 text-sm text-[var(--tfmc-mist)]">
          See the <Link href={station.guide.href} className="text-[var(--tfmc-accent)] underline underline-offset-2">{station.guide.label}</Link> for its recipes and full workflow.
        </p>
      ) : null}
    </WikiPage>
  );
}
