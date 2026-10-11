import { recipeIconTransform } from "./recipeIconAlignment";

/** Centre the visible sprite, keeping authentic pixels, scale and aspect ratio. */
export default function RecipeItemIcon({ src, alt, enlarge = false }: { src: string; alt: string; enlarge?: boolean }) {
  return (
    <span
      className={
        enlarge
          ? "block h-8 w-8 shrink-0 transition-transform duration-150 will-change-transform group-hover:scale-125 group-focus-visible:scale-125 group-hover:drop-shadow-[0_4px_6px_rgba(0,0,0,0.5)] sm:h-10 sm:w-10"
          : "block h-8 w-8 shrink-0 sm:h-10 sm:w-10"
      }
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        className="block h-full w-full object-contain [image-rendering:pixelated]"
        style={{ transform: recipeIconTransform(src) }}
      />
    </span>
  );
}
