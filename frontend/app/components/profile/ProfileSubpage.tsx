import Link from "next/link";
import type { ReactNode } from "react";
import type { ProfileTab } from "../../../lib/profile/tabs";

/** A skin or drink page under Profile: back to its wardrobe tab, a title, and the page. */
export default function ProfileSubpage({
  tab,
  title,
  children,
}: {
  tab: ProfileTab;
  title: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-[calc(100dvh-var(--tfmc-header-h))] max-w-lg flex-col px-6 py-16">
      <Link
        href={`/profile?tab=${tab}`}
        className="self-start text-sm text-[var(--tfmc-mist)] underline-offset-2 hover:text-[var(--tfmc-cream)] hover:underline"
      >
        ← Profile
      </Link>
      <h1 className="mt-3 font-[family-name:var(--font-fraunces)] text-3xl text-[var(--tfmc-cream)] sm:text-4xl">
        {title}
      </h1>
      {children}
    </main>
  );
}
