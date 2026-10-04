import type { ReactNode, SVGProps } from "react";

import type { MapMode } from "../types";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 20, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      {children}
    </svg>
  );
}

/* Map modes. A shield for realms, crowns for the title tiers, a thing each for the world modes. */

export const RealmIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 4h14v7c0 4.5-3.2 7.6-7 9-3.8-1.4-7-4.5-7-9V4Z" />
    <path d="M5 9h14M12 4v16" />
  </Icon>
);

/*
 * The title tiers, as one family of crowns that grows with rank, the way CK3
 * marks them: a county's low coronet of pearls, a duchy's taller one of leaves,
 * a kingdom's crown with an arch and cross, an empire's double-arched crown
 * with an orb. Each reads from its silhouette alone at bar size.
 */
export const CountyIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 21h14v-3H5v3Z" />
    <path d="M5 18l1.2-3.6L9 16.2l3-3.4 3 3.4 2.8-1.8L19 18" />
    <circle cx="6.2" cy="13.5" r="0.9" />
    <circle cx="12" cy="11.9" r="0.9" />
    <circle cx="17.8" cy="13.5" r="0.9" />
  </Icon>
);

export const DuchyIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 21h14v-3H5v3Z" />
    <path d="M5 18 4.4 11.8 8 14.6l4-5.4 4 5.4 3.6-2.8L19 18" />
    <path d="M12 9.2c-1.3-.7-1.6-2.6 0-3.6 1.6 1 1.3 2.9 0 3.6ZM4.4 11.8c-1.2-.4-1.6-2.1-.3-2.9 1.2.6 1.3 2.2.3 2.9ZM19.6 11.8c1.2-.4 1.6-2.1.3-2.9-1.2.6-1.3 2.2-.3 2.9Z" />
  </Icon>
);

export const KingdomIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 21h14v-3H5v3Z" />
    <path d="M5 18 4.4 12.4 8 15l4-5 4 5 3.6-2.6L19 18" />
    <path d="M4.4 12.4C5.4 8.8 8.4 7.2 12 7.2s6.6 1.6 7.6 5.2" />
    <path d="M12 7.2V3.4M10.7 4.6h2.6" />
  </Icon>
);

export const EmpireIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3.5 21h17v-3.5h-17V21Z" />
    <path d="M3.5 17.5C3.5 11 7.5 7.6 12 7.6s8.5 3.4 8.5 9.9" />
    <path d="M8 17.5c0-5 1.8-8.4 4-9.9 2.2 1.5 4 4.9 4 9.9" />
    <circle cx="12" cy="5.6" r="1.6" />
    <path d="M12 4V1.3M10.8 2.4h2.4" />
    <circle cx="7" cy="19.25" r="0.45" fill="currentColor" />
    <circle cx="12" cy="19.25" r="0.45" fill="currentColor" />
    <circle cx="17" cy="19.25" r="0.45" fill="currentColor" />
  </Icon>
);

/*
 * The world modes: each a thing the mode is about, not a chart. Provinces is
 * land cut into territories, trade a merchant's cog, prosperity a full purse,
 * infrastructure a bridge, infestation the monsters' skull.
 */
export const ProvinceIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3.5 8 8.5 4 14 5.5l5.5-1.7 1.1 6.2-1.6 4.5 1.2 4.5-6.2 1.4-4-1.8-5.4 1.4-1-5.2L5 11 3.5 8Z" />
    <path d="M8.5 4 10 10.5 5 11M10 10.5l5-1 5.6.5M15 9.5l-1 6.4-4 2.7M14 15.9l5-1.4" />
  </Icon>
);

export const TerrainIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2.5 19.5 9 8l3.3 5.6L15.2 9.5l6.3 10H2.5Z" />
    <path d="M7 11.6 9 13l1.9-1.6" />
    <path d="m15.2 9.5-1.6 2.6" />
  </Icon>
);

export const FertilityIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 21V8" />
    <path d="M12 12c-2.5 0-4-1.5-4-4 2.5 0 4 1.5 4 4ZM12 12c2.5 0 4-1.5 4-4-2.5 0-4 1.5-4 4ZM12 17c-2.5 0-4-1.5-4-4 2.5 0 4 1.5 4 4ZM12 17c2.5 0 4-1.5 4-4-2.5 0-4 1.5-4 4ZM12 8c-1.2-1-1.2-3 0-5 1.2 2 1.2 4 0 5Z" />
  </Icon>
);

export const TradeIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2.8 13.6c2.4.9 5 1.2 9.2 1.2s6.8-.3 9.2-1.2l-2.3 5.6c-1.9.5-4.1.7-6.9.7s-5-.2-6.9-.7l-2.3-5.6Z" />
    <path d="M12 14.8V2.8" />
    <path d="M7.2 4.8h9.6c.6 2.6.4 5.4-.8 7.8H8c-1.2-2.4-1.4-5.2-.8-7.8Z" />
    <path d="m12 2.8 3 1-3 1" />
  </Icon>
);

export const ProsperityIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M9 8h6c3.2 2.4 5 5.4 5 8.3 0 2.9-2.7 4.4-8 4.4s-8-1.5-8-4.4C4 13.4 5.8 10.4 9 8Z" />
    <path d="M9 8 7.4 4.6c1.6.6 3 .4 4.6-.6 1.6 1 3 1.2 4.6.6L15 8" />
    <circle cx="12" cy="15.2" r="2.4" />
  </Icon>
);

export const InfrastructureIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2.5 9.5h19" />
    <path d="M4.5 20v-5.5a7.5 7.5 0 0 1 15 0V20" />
    <path d="M2.5 20h19M8 9.5V7M12 9.5V7M16 9.5V7" />
  </Icon>
);

export const InfestationIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 3.5c-4.3 0-7.5 3-7.5 7.3 0 2.3 1.1 4.1 3 5.2v3.8h9V16c1.9-1.1 3-2.9 3-5.2 0-4.3-3.2-7.3-7.5-7.3Z" />
    <circle cx="9.1" cy="11" r="1.7" />
    <circle cx="14.9" cy="11" r="1.7" />
    <path d="m12 13.6-1 1.7h2l-1-1.7ZM10.5 19.8v-2M13.5 19.8v-2" />
  </Icon>
);

/* Controls. */

export const PlusIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const MinusIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 12h14" />
  </Icon>
);

export const FitIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </Icon>
);

export const LayersIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m12 3 9 5-9 5-9-5 9-5Z" />
    <path d="m3 12.5 9 5 9-5M3 16.5l9 5 9-5" />
  </Icon>
);

export const SearchIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </Icon>
);

export const CloseIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);

export const HistoryIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 7v5l3.5 2M3.5 12a8.5 8.5 0 1 0 2.7-6.2M3.5 4v4.5H8" />
  </Icon>
);

export const FocusIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
  </Icon>
);

export const SubjectsIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M9 3h6v4.5c0 2-1.3 3.4-3 4-1.7-.6-3-2-3-4V3ZM3 13h6v4.5c0 2-1.3 3.4-3 4-1.7-.6-3-2-3-4V13ZM15 13h6v4.5c0 2-1.3 3.4-3 4-1.7-.6-3-2-3-4V13Z" />
  </Icon>
);

export const PinIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11Z" />
    <circle cx="12" cy="10" r="2.3" />
  </Icon>
);

export const BrushIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M14.5 4.5 19.5 9.5 11 18l-5-5 8.5-8.5Z" />
    <path d="M6 13c-2 0-3 1.5-3 3.5S2 20 2 20s3.5 0 5-1 2-2.5 2-3.5" />
  </Icon>
);

/* Map details: the overlays the layers panel switches on and off. */

export const FortIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 21V8h3v2h2.5V8h5v2H17V8h3v13H4Z" />
    <path d="M10 21v-4a2 2 0 0 1 4 0v4M12 8V3l3.5 1.5L12 6" />
  </Icon>
);

export const RouteIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="5.5" cy="18" r="2.2" />
    <circle cx="18.5" cy="6" r="2.2" />
    <path d="M7.5 17c3-1 2.5-5 5-6.5s3.5-1 4.5-2.8" strokeDasharray="2 2.4" />
  </Icon>
);

export const ChevronIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m9 6 6 6-6 6" />
  </Icon>
);

export const MAP_MODE_ICONS: Record<MapMode, (props: IconProps) => ReactNode> = {
  nation: RealmIcon,
  county: CountyIcon,
  duchy: DuchyIcon,
  kingdom: KingdomIcon,
  empire: EmpireIcon,
  province: ProvinceIcon,
  terrain: TerrainIcon,
  fertility: FertilityIcon,
  trade: TradeIcon,
  prosperity: ProsperityIcon,
  infrastructure: InfrastructureIcon,
  infestation: InfestationIcon,
};
