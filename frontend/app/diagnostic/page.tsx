import type { Metadata } from "next";

import DiagnosticRunner from "@/app/components/diagnostic/DiagnosticRunner";

// Unlisted: staff send the link in tickets, so keep it out of search results.
export const metadata: Metadata = {
  title: "Diagnostic · TFMC",
  robots: { index: false, follow: false },
};

export default function DiagnosticPage() {
  return (
    <main className="mx-auto min-h-[calc(100dvh-var(--tfmc-header-h))] max-w-3xl px-6 py-16">
      <h1 className="font-[family-name:var(--font-fraunces)] text-4xl text-[var(--tfmc-cream)]">Diagnostic</h1>
      <p className="mt-3 text-[var(--tfmc-stone)]">
        Checks your connection to TFMC, the resource pack and your computer. Run it on the computer you play on. Nothing
        reaches staff unless you press Send.
      </p>
      <p className="mt-2 text-sm text-[var(--tfmc-mist)]">
        To check them, this page looks up our address through Cloudflare and Google DNS and contacts Mojang and
        Microsoft.
      </p>
      <DiagnosticRunner />
    </main>
  );
}
