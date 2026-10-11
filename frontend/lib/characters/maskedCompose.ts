/** Client-side compose: base head+hat onto masked body template (64×64). */

function loadImage(src: string | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = typeof src === "string" ? src : URL.createObjectURL(src);
    img.onload = () => {
      if (typeof src !== "string") URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      if (typeof src !== "string") URL.revokeObjectURL(url);
      reject(new Error("Could not load skin image"));
    };
    img.src = url;
  });
}

/**
 * Paste base pixels y∈[0,16) onto the template body. Returns a PNG File.
 */
export async function composeMaskedFromBase(
  baseFile: File | Blob,
  templateBlob: Blob,
  filename = "masked.png",
): Promise<File> {
  const [base, templ] = await Promise.all([loadImage(baseFile), loadImage(templateBlob)]);
  if (
    base.naturalWidth !== 64 ||
    base.naturalHeight !== 64 ||
    templ.naturalWidth !== 64 ||
    templ.naturalHeight !== 64
  ) {
    throw new Error("Skin and template must be 64×64");
  }
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.clearRect(0, 0, 64, 64);
  ctx.drawImage(templ, 0, 0);
  ctx.drawImage(base, 0, 0, 64, 16, 0, 0, 64, 16);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encode failed"))), "image/png");
  });
  return new File([blob], filename, { type: "image/png" });
}
