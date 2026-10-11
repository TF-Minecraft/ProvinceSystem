import type { ReactNode } from "react";

export type DonorRank = "Commoner" | "Noble" | "Gilded" | "Ascended" | "Legacy";

export interface RankNameProps {
  rank: DonorRank;
}

const PATREON_URL = "https://patreon.com/c/tfmcrp";

const RANK_STYLES: Record<DonorRank, { colours: string[]; bold: boolean }> = {
  Commoner: {
    colours: ["#AAAAAA", "#AAAAAA", "#AAAAAA", "#AAAAAA", "#AAAAAA", "#AAAAAA", "#AAAAAA", "#AAAAAA"],
    bold: false,
  },
  Noble: { colours: ["#2981C4", "#276EC1", "#265CBE", "#2549BB", "#2337B8"], bold: false },
  Gilded: { colours: ["#FDAA17", "#FB9C14", "#F98E12", "#F67F10", "#F4710E", "#F2630B"], bold: false },
  Ascended: {
    colours: ["#8939EE", "#9033DD", "#972DCC", "#9E27BB", "#A620AB", "#AD1A9A", "#B41489", "#BB0E78"],
    bold: true,
  },
  Legacy: { colours: ["#3AE38C", "#33CB7C", "#2CB36C", "#259C5D", "#1E844D", "#176C3D"], bold: true },
};

export default function RankName({ rank }: RankNameProps): ReactNode {
  const style = RANK_STYLES[rank];
  const name = (
    <span aria-hidden="true">
      {[...rank].map((letter, index) => (
        <span key={`${rank}-${index}`} style={{ color: style.colours[index] }}>
          {letter}
        </span>
      ))}
    </span>
  );
  const className = style.bold ? "font-bold" : undefined;
  if (rank === "Noble" || rank === "Gilded" || rank === "Ascended") {
    return (
      <a href={PATREON_URL} target="_blank" rel="noopener noreferrer" aria-label={rank} className={className}>
        {name}
      </a>
    );
  }
  return (
    <span aria-label={rank} className={className}>
      {name}
    </span>
  );
}
