import { cookies } from "next/headers";
import ProfilePanel from "../components/profile/ProfilePanel";
import { ACCOUNT_SHAPE_COOKIE, decodeAccountShape } from "../../lib/account/shape";
import { profileTab } from "../../lib/profile/tabs";

type SearchParams = {
  tab?: string | string[];
  signin?: string | string[];
  minecraft?: string | string[];
};

function singleValue(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const shape = decodeAccountShape((await cookies()).get(ACCOUNT_SHAPE_COOKIE)?.value);

  return (
    <main className="relative mx-auto flex min-h-[calc(100dvh-var(--tfmc-header-h))] max-w-3xl flex-col px-6 py-16">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-80"
        style={{
          background: `
            radial-gradient(ellipse 70% 50% at 50% 0%, color-mix(in srgb, var(--tfmc-moss) 35%, transparent), transparent 65%)
          `,
        }}
      />
      <ProfilePanel
        tab={profileTab(singleValue(params.tab))}
        signin={singleValue(params.signin)}
        minecraft={singleValue(params.minecraft)}
        shape={shape}
      />
    </main>
  );
}
