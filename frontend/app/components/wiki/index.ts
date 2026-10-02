/**
 * Barrel for the shared wiki UI components. Page authors import from here:
 *
 *   import { Callout, CommandTable, SeeAlso, WikiPage } from "@/app/components/wiki";
 *
 * The 3D viewers and the keyboard are intentionally NOT re-exported. They pull
 * in three.js and are client components, so pages import those directly.
 */

export { default as Callout } from "./Callout";
export type { CalloutProps, CalloutVariant } from "./Callout";

export { default as CommandTable } from "./CommandTable";
export type { CommandAccess, CommandRow, CommandTableProps } from "./CommandTable";

export { default as CompanionPetGallery } from "./CompanionPetGallery";

export { default as CropGallery } from "./CropGallery";
export type { CropGalleryItem } from "./CropGallery";

export { default as DataTable } from "./DataTable";
export type { DataTableAlign, DataTableCell, DataTableColumn, DataTableProps } from "./DataTable";

export { default as FurnitureGallery } from "./FurnitureGallery";
export { default as WoodworkingGallery } from "./WoodworkingGallery";

export { default as ItemChip } from "./ItemChip";
export type { ItemChipProps } from "./ItemChip";
export { default as ItemGallery } from "./ItemGallery";
export type { ItemGalleryItem } from "./ItemGallery";

export { default as RankName } from "./RankName";
export type { DonorRank, RankNameProps } from "./RankName";

export { default as SeeAlso } from "./SeeAlso";
export type { SeeAlsoProps } from "./SeeAlso";

export { default as StatGrid } from "./StatGrid";
export type { StatGridItem, StatGridProps } from "./StatGrid";

export { default as StationLink } from "./StationLink";
export type { StationLinkProps } from "./StationLink";

export { default as WikiPage, WIKI_LAST_MODIFIED } from "./WikiPage";
export type { WikiPageProps, WikiPageWidth } from "./WikiPage";

export { default as WikiItemLink, WikiItemText } from "./WikiItemLink";
export type { WikiItemLinkProps, WikiItemTextProps } from "./WikiItemLink";

export { default as WikiSearch } from "./WikiSearch";

export { default as WikiSectionHeading } from "./WikiSectionHeading";
export type { WikiSectionHeadingProps } from "./WikiSectionHeading";

export * from "./wikiStyles";
