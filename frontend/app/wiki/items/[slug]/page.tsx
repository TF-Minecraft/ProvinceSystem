import Link from "next/link";
import { notFound } from "next/navigation";
import CraftingGrid from "../../../components/wiki/CraftingGrid";
import RecipeItemIcon from "../../../components/wiki/RecipeItemIcon";
import { WikiItemText, WikiPage } from "@/app/components/wiki";
import { getItemBySlug, itemDetails } from "../../data/items";

export function generateStaticParams() {
  return itemDetails.map(item => ({ slug: item.slug }));
}

export default async function ItemDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const item = getItemBySlug(slug);
  if (!item) notFound();
  return <WikiPage
    lastModified="2026-09-27"
    title={item.name}
    beforeTitle={<Link href="/wiki/materials" className="text-xs text-[var(--tfmc-mist)] hover:text-[var(--tfmc-cream)]">&larr; Materials and crafting</Link>}
    titleVisual={item.model ? undefined : item.texture ? <RecipeItemIcon src={item.texture} alt={item.name} /> : undefined}
    intro={item.description ? <WikiItemText text={item.description} excludeHref={item.href} /> : undefined}
  >
    {item.recipes.length ? <>
      <h2 id="acquisition" className="mt-8 font-[family-name:var(--font-fraunces)] text-xl text-[var(--tfmc-cream)]">How to craft</h2>
      <div className="mt-4 space-y-4">{item.recipes.map(recipe => <CraftingGrid key={recipe.key} recipe={recipe} />)}</div>
    </> : null}
    <h2 id="used-in" className="mt-8 font-[family-name:var(--font-fraunces)] text-xl text-[var(--tfmc-cream)]">What can be crafted from it</h2>
    {item.usedIn.length ? <div className="mt-4 space-y-4">{item.usedIn.map(recipe => <CraftingGrid key={recipe.key} recipe={recipe} />)}</div> : <p className="mt-2 text-sm text-[var(--tfmc-mist)]">No recipes in this guide use {item.name} as an ingredient.</p>}
  </WikiPage>;
}
