import type { Metadata } from "next";

import UpdatesPageView from "@/app/components/updates/UpdatesPageView";
import { loadPublishedNotes } from "@/lib/patchnotes/api";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Updates · TFMC",
  description: "Weekly patch notes for TFMC.",
};

export default async function UpdatesPage() {
  const notes = await loadPublishedNotes({ limit: 1 });
  if (!notes.ok) {
    return <UpdatesPageView weeks={[]} unavailable />;
  }
  return <UpdatesPageView weeks={notes.weeks} hasMore={notes.hasMore} />;
}
