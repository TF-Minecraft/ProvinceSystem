import { cookies } from "next/headers";
import AccountPanel from "../components/account/AccountPanel";
import { ACCOUNT_SHAPE_COOKIE, decodeAccountShape } from "../../lib/account/shape";

type SearchParams = {
  signin?: string | string[];
  minecraft?: string | string[];
};

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const signin = typeof params.signin === "string" ? params.signin : null;
  const minecraft = typeof params.minecraft === "string" ? params.minecraft : null;
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
      <AccountPanel signin={signin} minecraft={minecraft} shape={shape} />
    </main>
  );
}
