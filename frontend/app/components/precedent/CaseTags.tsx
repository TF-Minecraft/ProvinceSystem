import type { PrecedentCase } from "@/lib/precedent/api";
import { punishmentTone, rulingTone, visibleRuling } from "@/lib/precedent/filter";
import { playerChipClass, rulePillClass, toneClass } from "./caseFieldStyles";

/**
 * A case's rule, ruling, punishment and players. Each field gets its own shape
 * or colour so the row can be scanned without being read: rule is a bordered
 * pill, ruling and punishment are tinted by outcome and severity, players are
 * the only filled chips.
 */
export default function CaseTags({ row }: { row: Pick<PrecedentCase, "rule" | "ruling" | "punishment" | "players"> }) {
  const ruling = visibleRuling(row.ruling);
  if (!row.rule && !ruling && !row.punishment && !row.players?.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      {row.rule ? (
        <span className={rulePillClass} title={`Rule ${row.rule}`}>
          {row.rule}
        </span>
      ) : null}
      {ruling ? <span className={`font-medium ${toneClass[rulingTone(row.ruling)]}`}>{ruling}</span> : null}
      {row.punishment ? (
        <span className={`font-medium ${toneClass[punishmentTone(row.punishment)]}`}>{row.punishment}</span>
      ) : null}
      {(row.players || []).map((p) => (
        <span key={p} className={playerChipClass}>
          {p}
        </span>
      ))}
    </div>
  );
}
