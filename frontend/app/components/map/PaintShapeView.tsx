import { memo } from "react";

import {
  PAINT_COLORS,
  paintEffectiveSizes,
  paintShapeRotation,
  paintShapeScale,
  paintTextBgColor,
  paintTextCss,
  paintTextStyleOf,
  paintSizesMapPx,
  paintStampSrc,
  paintStrokeStyle,
  type PaintShape,
} from "../../lib/mapPaint";
import {
  arrowHeadPoints,
  boundsCentre,
  brushPathD,
  paintShapeBounds,
  paintTextBounds,
  pointsToPolygonAttr,
} from "../../lib/mapPaintGeometry";

type PaintShapeViewProps = {
  shape: PaintShape;
  selected?: boolean;
};

export default memo(PaintShapeWithRotation);

/**
 * Rotation is a render-time transform about the shape's own centre; the stored
 * geometry stays unrotated so hit-testing and resizing can work in a plain
 * axis-aligned frame.
 */
function PaintShapeWithRotation(props: PaintShapeViewProps) {
  const rotation = paintShapeRotation(props.shape);
  if (!rotation) return <PaintShapeView {...props} />;

  const centre = boundsCentre(paintShapeBounds(props.shape, paintSizesMapPx()));
  return (
    <g transform={`rotate(${rotation} ${centre.x} ${centre.y})`}>
      <PaintShapeView {...props} />
    </g>
  );
}

/**
 * Renders one painted shape.
 *
 * Drawn strokes go down twice — a dark backing, then dashed ink on top — so
 * they stay legible over both sea and land and never read as a real map line.
 * Placed objects carry no ring or outline: the selection box supplies the only
 * chrome they need, and anything more just clutters the icon.
 */
function PaintShapeView({ shape, selected = false }: PaintShapeViewProps) {
  const ink = PAINT_COLORS[shape.color];
  const sizes = paintEffectiveSizes(shape);
  const shapeScale = paintShapeScale(shape);

  switch (shape.type) {
    case "brush": {
      const style = paintStrokeStyle(shape.width, shape.color, shapeScale);
      const d = brushPathD(shape.points);
      return (
        <g opacity={selected ? 1 : 0.95}>
          <path
            d={d}
            fill="none"
            stroke={style.backing}
            strokeWidth={style.backingWidth}
            strokeOpacity={0.55}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d={d}
            fill="none"
            stroke={style.stroke}
            strokeWidth={style.strokeWidth}
            strokeDasharray={style.dashArray}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      );
    }

    case "arrow": {
      const style = paintStrokeStyle(shape.width, shape.color, shapeScale);
      const head = pointsToPolygonAttr(arrowHeadPoints(shape.from, shape.to, sizes.arrowHead));
      const d = `M ${shape.from.x} ${shape.from.y} L ${shape.to.x} ${shape.to.y}`;
      return (
        <g opacity={selected ? 1 : 0.95}>
          <path
            d={d}
            fill="none"
            stroke={style.backing}
            strokeWidth={style.backingWidth}
            strokeOpacity={0.55}
            strokeLinecap="round"
          />
          <path
            d={d}
            fill="none"
            stroke={style.stroke}
            strokeWidth={style.strokeWidth}
            strokeDasharray={style.dashArray}
            strokeLinecap="round"
          />
          <polygon
            points={head}
            fill={style.backing}
            fillOpacity={0.55}
            stroke={style.backing}
            strokeWidth={style.backingWidth}
            strokeOpacity={0.55}
            strokeLinejoin="round"
          />
          <polygon points={head} fill={ink} />
        </g>
      );
    }

    case "stamp": {
      const size = sizes.stamp;
      const half = size / 2;
      return (
        <g opacity={0.9}>
          <circle cx={shape.at.x} cy={shape.at.y} r={half * 1.05} fill={ink} fillOpacity={0.25} />
          <image
            href={paintStampSrc(shape.icon)}
            x={shape.at.x - half}
            y={shape.at.y - half}
            width={size}
            height={size}
            preserveAspectRatio="xMidYMid meet"
            // Mirror about the stamp's own centre, so a flipped icon stays put
            // instead of jumping to the other side of the map.
            transform={shape.flipX ? `translate(${shape.at.x * 2} 0) scale(-1 1)` : undefined}
            // The stamp assets are 16x16 Minecraft textures. Left to smooth
            // upscaling they turn to mush the moment a shape is resized up, so
            // scale them nearest-neighbour like every other texture in the app.
            className="[image-rendering:pixelated]"
          />
        </g>
      );
    }

    case "text": {
      const fontSize = sizes.fontSize;
      const bounds = paintTextBounds(shape, fontSize);
      const textStyle = paintTextStyleOf(shape);
      const css = paintTextCss(textStyle);
      const padX = fontSize * 0.3;
      const padY = fontSize * 0.14;
      return (
        <g opacity={0.95}>
          {textStyle.bgOpacity > 0 ? (
            <rect
              x={bounds.x - padX}
              y={bounds.y - padY}
              width={bounds.w + padX * 2}
              height={bounds.h + padY * 2}
              rx={padY * 1.6}
              fill={paintTextBgColor(textStyle.bgColor, shape.color)}
              fillOpacity={textStyle.bgOpacity}
            />
          ) : null}
          <text
            // Centred in the estimated box rather than started at its left
            // edge, so the glyphs sit centred in the plate whichever way the
            // width estimate is off.
            x={bounds.x + bounds.w / 2}
            y={shape.at.y}
            textAnchor="middle"
            fill={ink}
            fontSize={fontSize}
            fontFamily={css.fontFamily}
            fontWeight={css.fontWeight}
            fontStyle={css.fontStyle}
            textDecoration={css.textDecoration}
          >
            {shape.text}
          </text>
        </g>
      );
    }

    default:
      return null;
  }
}
