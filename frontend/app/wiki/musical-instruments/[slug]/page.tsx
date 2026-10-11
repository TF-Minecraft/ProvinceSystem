import Link from "next/link";
import { notFound } from "next/navigation";
import CraftingGrid from "../../../components/wiki/CraftingGrid";
import InstrumentKeyboard from "../../../components/wiki/InstrumentKeyboard";
import { WikiPage, WikiSectionHeading } from "@/app/components/wiki";
import { getInstrumentBySlug, getInstrumentRecipe, instruments } from "../../data";

export function generateStaticParams() {
  return instruments.map((i) => ({ slug: i.slug }));
}

export default async function InstrumentDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const instrument = getInstrumentBySlug(slug);
  if (!instrument) notFound();

  const recipe = getInstrumentRecipe(slug);

  return (
    <WikiPage
      lastModified="2026-09-12"
      title={instrument.name}
      beforeTitle={
        <Link
          href="/wiki/musical-instruments"
          className="text-xs text-[var(--tfmc-mist)] hover:text-[var(--tfmc-cream)]"
        >
          &larr; Back to Musical Instruments
        </Link>
      }
      titleVisual={
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={instrument.icon} alt={instrument.name} className="h-16 w-16 [image-rendering:pixelated]" />
        </>
      }
      intro={
        instrument.mode === "chord"
          ? "Keys 1-8 play a single note; hold Shift for the same eight notes as full chords."
          : "Keys 1-8 play the base octave; hold Shift for the same eight notes one octave higher: sixteen notes total."
      }
    >
      <WikiSectionHeading id="keyboard">Try it</WikiSectionHeading>
      <div className="mt-4">
        <InstrumentKeyboard instrument={instrument} />
      </div>

      <WikiSectionHeading id="crafting">How to craft</WikiSectionHeading>
      {recipe ? (
        <div className="mt-4 max-w-sm">
          <CraftingGrid recipe={recipe} />
        </div>
      ) : (
        <p className="mt-1 text-sm text-[var(--tfmc-mist)]">Not documented yet.</p>
      )}
    </WikiPage>
  );
}
