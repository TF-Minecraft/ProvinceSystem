import { Suspense } from "react";
import AdminNav from "../../components/admin/AdminNav";
import EveryoneMovement from "../../components/admin/EveryoneMovement";

export default function AdminMovementPage() {
  return (
    <main className="relative mx-auto flex min-h-[calc(100dvh-var(--tfmc-header-h))] max-w-[110rem] flex-col px-4 py-10 sm:px-6">
      <h1 className="font-[family-name:var(--font-fraunces)] text-3xl text-[var(--tfmc-cream)] sm:text-4xl">
        Staff panel
      </h1>
      <AdminNav current="movement" />
      {/* The view lives in the URL's query, which needs a Suspense boundary. */}
      <Suspense fallback={<p className="mt-6 text-[var(--tfmc-mist)]">Loading…</p>}>
        <EveryoneMovement />
      </Suspense>
    </main>
  );
}
