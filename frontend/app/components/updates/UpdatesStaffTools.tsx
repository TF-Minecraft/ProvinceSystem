"use client";

import StaffReviewLink from "@/app/components/updates/StaffReviewLink";
import StaffTestPreview from "@/app/components/updates/StaffTestPreview";
import { useSiteStaffAccess } from "@/app/hooks/useSiteStaffAccess";

/** Checks staff access once for the Updates page's staff-only extras. */
export default function UpdatesStaffTools() {
  const staff = useSiteStaffAccess().state === "staff";
  return (
    <>
      <StaffTestPreview staff={staff} />
      <StaffReviewLink staff={staff} />
    </>
  );
}
