import Link from "next/link";

import { WikiSearch } from "@/app/components/wiki";
import WikiNavigation from "@/app/components/wiki/WikiNavigation";
import { navItemsForCategory, overviewNavItem, populatedCategories } from "./data";

export default function WikiLayout({ children }: { children: React.ReactNode }) {
  const categories = populatedCategories();

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-var(--tfmc-header-h))] max-w-6xl flex-col gap-6 px-4 py-5 sm:px-6 lg:flex-row lg:py-10">
      <WikiNavigation>
        <p className="font-[family-name:var(--font-fraunces)] text-sm uppercase tracking-widest text-[var(--tfmc-mist)]">
          Gameplay Guide
        </p>
        <WikiSearch />
        <nav
          aria-label="Gameplay guide"
          className="mt-3 flex flex-col gap-1 lg:min-h-0 lg:flex-1 lg:gap-0 lg:overflow-y-auto lg:overscroll-contain lg:pr-2 lg:[scrollbar-gutter:stable]"
        >
          <Link
            href={overviewNavItem.href}
            className="flex min-h-11 items-center rounded px-2 py-1.5 text-sm text-[var(--tfmc-stone)] transition-colors hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_8%,transparent)] hover:text-[var(--tfmc-cream)] lg:min-h-0"
          >
            {overviewNavItem.label}
          </Link>

          {categories.map((category) => (
            <div key={category.key} className="mt-4 flex flex-col gap-1 lg:gap-0">
              <p className="px-2 py-1.5 font-[family-name:var(--font-fraunces)] text-[11px] uppercase tracking-widest text-[var(--tfmc-mist)]">
                {category.label}
              </p>
              {navItemsForCategory(category.key).map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex min-h-11 items-center gap-1.5 rounded px-2 py-1.5 text-sm text-[var(--tfmc-stone)] transition-colors hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_8%,transparent)] hover:text-[var(--tfmc-cream)] lg:min-h-0"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
      </WikiNavigation>

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
