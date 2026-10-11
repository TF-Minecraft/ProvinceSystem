import Link from "next/link";
import type { Slot } from "../../wiki/data/types";

type Props = { name: string; qty?: number; model: NonNullable<Slot["model"]>; slug: string };

/** A light recipe thumbnail that opens the matching entry in the vehicle catalogue. */
export default function RecipeVehiclePreview({ name, qty, model, slug }: Props) {
  const thumbnail = model.url.replace("/models/vehicles/", "/thumbnails/vehicles/").replace(/\.json$/, ".webp");
  const href = `/wiki/vehicles?vehicle=${encodeURIComponent(slug)}#catalogue`;

  return (
    <Link
      href={href}
      aria-label={`View ${name} in vehicle catalogue`}
      title={`View ${name} in vehicle catalogue`}
      className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden border border-[color-mix(in_srgb,var(--tfmc-cream)_18%,transparent)] bg-[var(--tfmc-forest)] hover:border-[var(--tfmc-accent)] focus-visible:outline focus-visible:outline-[var(--tfmc-accent)] sm:h-14 sm:w-14"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={thumbnail} alt="" loading="lazy" width={56} height={56} className="h-full w-full object-cover" />
      {qty && qty > 1 ? (
        <span className="absolute bottom-0 right-0.5 text-[10px] text-[var(--tfmc-cream)]">{qty}</span>
      ) : null}
    </Link>
  );
}
