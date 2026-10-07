import AdminNav from "../../components/admin/AdminNav";
import RailOverview from "../../components/admin/RailOverview";

export default function AdminRailPage() {
  return (
    <main className="relative mx-auto flex min-h-[calc(100dvh-var(--tfmc-header-h))] max-w-[110rem] flex-col px-4 py-10 sm:px-6">
      <h1 className="font-[family-name:var(--font-fraunces)] text-3xl text-[var(--tfmc-cream)] sm:text-4xl">
        Staff panel
      </h1>
      <AdminNav current="rail" />
      <RailOverview />
    </main>
  );
}
