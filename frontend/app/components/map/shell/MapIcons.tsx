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

/* Map modes. Heraldic shapes for the political tiers, plain glyphs for the rest. */

export const RealmIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 4h14v7c0 4.5-3.2 7.6-7 9-3.8-1.4-7-4.5-7-9V4Z" />
    <path d="M5 9h14M12 4v16" />
  </Icon>
);

export const CountyIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M7 20V9l-1.5-1V5h2.5v1.5h2V5h4v1.5h2V5h2.5v3L17 9v11" />
    <path d="M5 20h14M10.5 20v-4a1.5 1.5 0 0 1 3 0v4" />
  </Icon>
);

export const DuchyIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 17h16l-1.5-8-3.5 3.5L12 7l-3 5.5L5.5 9 4 17Z" />
    <path d="M4 20h16" />
  </Icon>
);

export const KingdomIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3.5 18h17l1-10-5 4L12 5l-4.5 7-5-4 1 10Z" />
    <circle cx="12" cy="4" r="1" />
    <circle cx="2.5" cy="7.5" r="0.8" />
    <circle cx="21.5" cy="7.5" r="0.8" />
    <path d="M3.5 21h17" />
  </Icon>
);

export const EmpireIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="14" r="6" />
    <path d="M6 14h12M12 8V3M10 5h4" />
  </Icon>
);

export const ProvinceIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 5l6-2 5 3 5-1v14l-5 2-5-3-6 2V5Z" />
    <path d="M10 3v15M15 6v15" />
  </Icon>
);

export const TerrainIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2 19 9 7l4 6 2.5-3.5L22 19H2Z" />
    <path d="m7.5 9.5 1.5 1.5 1.5-1.5" />
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
    <path d="M12 3v18M8 21h8M4 7h16" />
    <path d="M6 7 3.5 13a2.5 2.5 0 0 0 5 0L6 7ZM18 7l-2.5 6a2.5 2.5 0 0 0 5 0L18 7Z" />
  </Icon>
);

export const ProsperityIcon = (props: IconProps) => (
  <Icon {...props}>
    <ellipse cx="12" cy="6" rx="7" ry="2.5" />
    <path d="M5 6v4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6" />
    <path d="M5 10v4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-4" />
    <path d="M5 14v4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-4" />
  </Icon>
);

export const InfestationIcon = (props: IconProps) => (
  <Icon {...props}>
    <ellipse cx="12" cy="13.5" rx="4" ry="5.5" />
    <path d="M12 8V5M10 5.5 8.5 3.5M14 5.5l1.5-2M8 11H4.5M8 15l-3.5 1.5M16 11h3.5M16 15l3.5 1.5M12 8v11" />
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
  infestation: InfestationIcon,
};
