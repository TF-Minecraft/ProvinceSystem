"use client";

import { useEffect, useRef } from "react";

import {
  PAINT_COLORS,
  PAINT_MAX_TEXT_LENGTH,
  paintEffectiveSizes,
  paintMapPx,
  paintShapeRotation,
  paintSizesMapPx,
  paintTextBgColor,
  paintTextCss,
  paintTextStyleOf,
} from "../../lib/mapPaint";
import { boundsCentre, paintShapeBounds } from "../../lib/mapPaintGeometry";
import type { PaintTextEditorState } from "../../hooks/useMapPaint";

type PaintTextEditorProps = {
  editor: PaintTextEditorState;
  onChange: (next: string) => void;
  onCommit: () => void;
  onCancel: () => void;
};

/**
 * Inline editor for a text annotation. Lives inside the transformed map div and
 * is sized in map pixels, so — like everything else in the paint layer — it
 * keeps a constant on-screen size at any zoom level.
 */
export default function PaintTextEditor({ editor, onChange, onCommit, onCancel }: PaintTextEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { shape } = editor;

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [shape.id]);

  const fontSize = paintEffectiveSizes(shape).fontSize;
  const padding = fontSize * 0.25;

  // Edit the label at the angle it will be read at.
  const textStyle = paintTextStyleOf(shape);
  const css = paintTextCss(textStyle);
  const rotation = paintShapeRotation(shape);
  const centre = boundsCentre(paintShapeBounds(shape, paintSizesMapPx()));
  const left = shape.at.x - padding;
  const top = shape.at.y - fontSize;

  return (
    <input
      ref={inputRef}
      value={editor.value}
      maxLength={PAINT_MAX_TEXT_LENGTH}
      placeholder="Label…"
      onChange={(event) => onChange(event.target.value)}
      onBlur={onCommit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onCommit();
        } else if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
      // The layer above the paint SVG, so the caret is reachable while painting.
      className="absolute z-[22] outline-none"
      style={{
        left,
        top,
        transform: rotation ? `rotate(${rotation}deg)` : undefined,
        transformOrigin: rotation ? `${centre.x - left}px ${centre.y - top}px` : undefined,
        // Roughly track the label's own width so the editor doesn't sit in a
        // plate far wider than the text, with room left to keep typing.
        width: Math.max(fontSize * 4, (editor.value.length + 3) * fontSize * 0.58),
        textAlign: "center",
        fontSize,
        lineHeight: 1.2,
        padding,
        fontFamily: css.fontFamily,
        fontWeight: css.fontWeight,
        fontStyle: css.fontStyle,
        textDecoration: css.textDecoration,
        color: PAINT_COLORS[shape.color],
        background: "rgba(10, 21, 18, 0.85)",
        boxShadow: `inset 0 0 0 999px ${paintTextBgColor(textStyle.bgColor, shape.color)}${Math.round(
          textStyle.bgOpacity * 255,
        )
          .toString(16)
          .padStart(2, "0")}`,
        border: `${paintMapPx(1.5)}px dashed ${PAINT_COLORS[shape.color]}`,
        borderRadius: padding,
      }}
    />
  );
}
