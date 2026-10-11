export type TextureAnimationMetadata = {
  animation: {
    frametime?: number;
    width?: number;
    height?: number;
    frames?: Array<number | { index: number; time?: number }>;
  };
};

/** Minecraft animation times are game ticks (50 ms), not browser frames. */
export function createStationTextureAnimation(
  imageWidth: number,
  imageHeight: number,
  metadata: TextureAnimationMetadata,
) {
  const animation = metadata.animation;
  const defaultSize = Math.min(imageWidth, imageHeight);
  const frameWidth = animation.width ?? defaultSize;
  const frameHeight = animation.height ?? defaultSize;
  const columns = imageWidth / frameWidth;
  const rows = imageHeight / frameHeight;
  if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 1 || rows < 1) {
    throw new Error("Invalid station animation frame dimensions.");
  }
  const frameTime = animation.frametime ?? 1;
  const frames = (animation.frames ?? Array.from({ length: columns * rows }, (_, i) => i)).map((frame) => ({
    index: typeof frame === "number" ? frame : frame.index,
    duration: (typeof frame === "number" ? frameTime : (frame.time ?? frameTime)) * 50,
  }));
  if (
    !frames.length ||
    frames.some(
      ({ index, duration }) =>
        !Number.isInteger(index) || index < 0 || index >= columns * rows || !Number.isFinite(duration) || duration <= 0,
    )
  ) {
    throw new Error("Invalid station animation frames.");
  }
  const duration = frames.reduce((total, frame) => total + frame.duration, 0);

  return (elapsedMs: number) => {
    let time = Math.max(0, elapsedMs) % duration;
    const frame = frames.find((candidate) => {
      if (time < candidate.duration) return true;
      time -= candidate.duration;
      return false;
    })!;
    return {
      repeatX: 1 / columns,
      repeatY: 1 / rows,
      offsetX: (frame.index % columns) / columns,
      // TextureLoader flips image Y: frame zero is at the top of the PNG.
      offsetY: 1 - (Math.floor(frame.index / columns) + 1) / rows,
    };
  };
}

/** Keep an atlas on its first frame when optional animation metadata is unavailable. */
export function createStationTextureAtlasFallback(
  imageWidth: number,
  imageHeight: number,
  textureSize: [number, number],
) {
  const [frameWidth, frameHeight] = textureSize;
  if (
    frameWidth <= 0 ||
    frameHeight <= 0 ||
    imageWidth !== frameWidth ||
    imageHeight <= frameHeight ||
    imageHeight % frameHeight !== 0
  ) {
    return undefined;
  }

  const rows = imageHeight / frameHeight;
  return () => ({ repeatX: 1, repeatY: 1 / rows, offsetX: 0, offsetY: 1 - 1 / rows });
}
