import Link from "next/link";

import { WikiPage } from "@/app/components/wiki";
import { navItemsForCategory, populatedCategories } from "./data";

export default function WikiOverviewPage() {
  return (
    <WikiPage
      lastModified="2026-10-02"
      title="Gameplay Guide"
      intro="Crafting, recipes and mechanics for Season 5."
      width="sm"
    >
      {populatedCategories().map((category) => (
        <section key={category.key} className="mt-8">
          <h2 className="font-[family-name:var(--font-fraunces)] text-xl text-[var(--tfmc-cream)]">
            {category.label}
          </h2>
          <p className="mt-1 text-sm text-[var(--tfmc-mist)]">{category.blurb}</p>

          <div className="mt-4 flex flex-col gap-3">
            {navItemsForCategory(category.key).map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md border border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_45%,transparent)] p-4 transition-colors hover:border-[var(--tfmc-accent)]"
              >
                <p className="flex items-center gap-2 font-[family-name:var(--font-fraunces)] text-lg text-[var(--tfmc-cream)]">
                  {item.label}
                </p>
                <p className="mt-1 text-sm text-[var(--tfmc-mist)]">{item.blurb}</p>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </WikiPage>
  );
}
