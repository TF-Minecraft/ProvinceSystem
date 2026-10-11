"use client";

import type { LoreRun } from "../../../lib/characters/lorePreview";

type Props = {
  runs: LoreRun[];
};

/** Renders MC/TLibs colour runs from lorePreview.parseNameRuns / parseLoreRuns. */
export default function FormattedMcRuns({ runs }: Props) {
  return (
    <>
      {runs.map((r, i) => (
        <span
          key={`${i}-${r.text.slice(0, 8)}`}
          style={{
            color: r.color,
            fontWeight: r.bold ? 700 : undefined,
            fontStyle: r.italic ? "italic" : undefined,
            textDecoration:
              [r.underline ? "underline" : "", r.strike ? "line-through" : ""].filter(Boolean).join(" ") || undefined,
          }}
        >
          {r.text === " " ? "\u00a0" : r.text}
        </span>
      ))}
    </>
  );
}
