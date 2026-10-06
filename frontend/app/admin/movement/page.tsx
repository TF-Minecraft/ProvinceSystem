import AdminNav from "../../components/admin/AdminNav";
import EveryoneMovement from "../../components/admin/EveryoneMovement";

export default function AdminMovementPage() {
  return (
    <main className="relative mx-auto flex min-h-[calc(100dvh-var(--tfmc-header-h))] max-w-7xl flex-col px-6 py-16">
      <h1 className="font-[family-name:var(--font-fraunces)] text-3xl text-[var(--tfmc-cream)] sm:text-4xl">
        Staff panel
      </h1>
      <AdminNav current="movement" />
      <EveryoneMovement />
    </main>
  );
}
