import { PageSkeleton } from "@/app/components/shared/LoadingSkeleton";

export default function Loading() {
  return <PageSkeleton variant="form" label="Loading character creation…" className="max-w-lg py-8 sm:py-12" />;
}
