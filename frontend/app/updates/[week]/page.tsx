import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { WeekPageView } from "@/app/components/updates/UpdatesPageView";
import { loadPublishedWeek } from "@/lib/patchnotes/api";
import { isWeekKey, weekLabel } from "@/lib/patchnotes/notes";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ week: string }>;
}): Promise<Metadata> {
  const { week } = await params;
  if (!isWeekKey(week)) {
    return { title: "Updates · TFMC" };
  }
  const label = weekLabel(week);
  return {
    title: `${label} · TFMC`,
    description: `Patch notes for ${label}.`,
  };
}

export default async function UpdateWeekPage({ params }: { params: Promise<{ week: string }> }) {
  const { week } = await params;
  if (!isWeekKey(week)) notFound();
  const notes = await loadPublishedWeek(week);
  if (!notes.ok) {
    if (notes.missing) notFound();
    return <WeekPageView notes={null} unavailable />;
  }
  return <WeekPageView notes={notes.week} />;
}
