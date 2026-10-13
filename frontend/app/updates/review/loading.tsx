import { PageSkeleton } from "@/app/components/shared/LoadingSkeleton";

export default function Loading() {
  return <PageSkeleton variant="form" label="Loading update review…" className="max-w-5xl py-8 sm:py-12" />;
}
