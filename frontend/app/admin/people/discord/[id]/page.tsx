import AdminColumn from "@/app/components/admin/AdminColumn";
import PersonCases from "@/app/components/admin/PersonCases";

export default async function DiscordPersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AdminColumn>
      <PersonCases key={id} subject={{ discordId: id }} standalone />
    </AdminColumn>
  );
}
