import Link from "next/link";
import { notFound } from "next/navigation";
import CraftingGrid from "../../../components/wiki/CraftingGrid";
import { WikiItemText, WikiPage } from "@/app/components/wiki";
import { getMaterialBySlug, materialCatalog } from "../../data";

export function generateStaticParams() {
  return Array.from(materialCatalog.values()).map((m) => ({ slug: m.slug }));
}

export default async function MaterialDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const material = getMaterialBySlug(slug);
  if (!material) notFound();

  return (
    <WikiPage
      lastModified="2026-09-27"
      title={material.name}
      beforeTitle={<Link href="/wiki/materials" className="text-xs text-[var(--tfmc-mist)] hover:text-[var(--tfmc-cream)]">
        &larr; Back to Materials
      </Link>}
      titleVisual={material.texture ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={material.texture}
            alt={material.name}
            className="h-16 w-16 [image-rendering:pixelated]"
          />
        ): undefined}
      intro={material.lore ? <em><WikiItemText text={material.lore} excludeHref={`/wiki/materials/${material.slug}`} /></em> : undefined}
    >

      <h2 id="acquisition" className="mt-8 font-[family-name:var(--font-fraunces)] text-xl text-[var(--tfmc-cream)]">
        How to acquire
      </h2>
      {material.acquisition?.length ? (
        <div className="mt-4 space-y-4">
          {material.acquisition.map((source) => (
            <section key={source.method} className="rounded-md border border-[color-mix(in_srgb,var(--tfmc-accent)_35%,transparent)] p-4">
              <h3 className="font-semibold text-[var(--tfmc-cream)]"><WikiItemText text={source.method} excludeHref={`/wiki/materials/${material.slug}`} /></h3>
              <p className="mt-1 text-sm text-[var(--tfmc-mist)]"><WikiItemText text={source.detail} excludeHref={`/wiki/materials/${material.slug}`} /></p>
            </section>
          ))}
        </div>
      ) : null}
      {material.recipes.length ? (
        <div className="mt-4 space-y-4">
          {material.recipes.map(recipe => <CraftingGrid key={recipe.key} recipe={recipe} />)}
        </div>
      ): !material.acquisition?.length ? (
        <p className="mt-1 text-sm text-[var(--tfmc-mist)]">
          Acquisition details have not yet been verified for this material.
        </p>
      ) : null}

      {material.unpackingRecipes.length ? (
        <section className="mt-8">
          <h2 className="font-[family-name:var(--font-fraunces)] text-xl text-[var(--tfmc-cream)]">Block unpacking</h2>
          <p className="mt-1 text-sm text-[var(--tfmc-mist)]">
            Recover material from a storage block you already own.
          </p>
          <div className="mt-4 space-y-4">
            {material.unpackingRecipes.map((recipe) => <CraftingGrid key={recipe.key} recipe={recipe} />)}
          </div>
        </section>
      ) : null}

      <h2 id="used-in" className="mt-8 font-[family-name:var(--font-fraunces)] text-xl text-[var(--tfmc-cream)]">
        What can be crafted from it
      </h2>
      {material.usedIn.length ? (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {material.usedIn.map((r) => (
            <CraftingGrid key={r.key} recipe={r} />
          ))}
        </div>
      ): (
        <p className="mt-1 text-sm text-[var(--tfmc-mist)]">
          Not used in any recipe here.
        </p>
      )}
    </WikiPage>
  );
}
