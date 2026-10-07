import { parseMcText } from "../../../../lib/admin/luckperms";

/** A prefix or suffix drawn with its Minecraft colour codes. */
export default function McText({ text, className = "" }: { text: string; className?: string }) {
  return (
    <span className={`font-semibold ${className}`}>
      {parseMcText(text).map((segment, index) => (
        <span
          key={index}
          style={{
            color: segment.colour ?? undefined,
            fontWeight: segment.bold ? 800 : undefined,
            fontStyle: segment.italic ? "italic" : undefined,
            textDecoration: [segment.underline ? "underline" : "", segment.strike ? "line-through" : ""].join(" ").trim() || undefined,
          }}
        >
          {segment.text}
        </span>
      ))}
    </span>
  );
}
