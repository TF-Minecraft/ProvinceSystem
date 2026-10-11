/** Outline button for the secondary hub links. */
export const hubOutlineButtonClass =
  "inline-flex min-w-[8.5rem] items-center justify-center rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_35%,transparent)] bg-transparent px-6 py-3 text-sm font-semibold tracking-wide text-[var(--tfmc-cream)] transition-colors hover:border-[var(--tfmc-cream)] hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_8%,transparent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tfmc-cream)]";

/** Forest gradient and film-grain noise behind the hub and the gate. */
export default function HubAtmosphere() {
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_35%,color-mix(in_srgb,var(--tfmc-moss)_55%,transparent),transparent_70%),radial-gradient(ellipse_100%_80%_at_50%_100%,color-mix(in_srgb,var(--tfmc-forest)_80%,#000),transparent),linear-gradient(165deg,var(--tfmc-forest-deep)_0%,var(--tfmc-forest)_45%,#152820_100%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[url(data:image/svg+xml,%3Csvg%20viewBox=%270%200%20200%20200%27%20xmlns=%27http://www.w3.org/2000/svg%27%3E%3Cfilter%20id=%27n%27%3E%3CfeTurbulence%20type=%27fractalNoise%27%20baseFrequency=%270.85%27%20numOctaves=%274%27%20stitchTiles=%27stitch%27/%3E%3C/filter%3E%3Crect%20width=%27100%25%27%20height=%27100%25%27%20filter=%27url%28%23n%29%27/%3E%3C/svg%3E)] opacity-[0.07]"
      />
    </>
  );
}
