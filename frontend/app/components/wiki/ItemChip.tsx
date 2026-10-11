import Link from "next/link";

import { materialCatalog, slugify } from "@/app/wiki/data";

import { cx, wikiPixelIcon } from "./wikiStyles";

export interface ItemChipProps {
  /**
   * Display name. If it matches a catalogue entry exactly, the icon and the
   * `/wiki/materials/<slug>` link are filled in for you.
   */
  name: string;
  /**
   * Texture URL, built with `T()` / `V()`. Only needed for items that are not in
   * the material catalogue, or to override the catalogue icon.
   */
  texture?: string;
  /**
   * Force linking on or off. Default: link when the name is in the catalogue.
   * Pass `false` inside a cell that is already a link.
   */
  link?: boolean;
  className?: string;
}

/**
 * An inline item reference: pixel icon + name, linking to the item's material
 * page when there is one. Safe inside prose, table cells and list items.
 */
export default function ItemChip({ name, texture, link, className }: ItemChipProps) {
  const entry = materialCatalog.get(name);
  const icon = texture ?? entry?.texture;
  const shouldLink = link ?? Boolean(entry);

  const body = (
    <span className={cx("inline-flex items-center gap-1.5 align-middle", className)}>
      {icon ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={icon} alt="" aria-hidden="true" className={cx("h-4 w-4 shrink-0", wikiPixelIcon)} />
      ) : null}
      <span className="text-[var(--tfmc-cream)]">{name}</span>
    </span>
  );

  if (!shouldLink) return body;

  return (
    <Link
      href={`/wiki/materials/${slugify(name)}`}
      className="underline-offset-2 hover:text-[var(--tfmc-accent)] hover:underline"
    >
      {body}
    </Link>
  );
}
