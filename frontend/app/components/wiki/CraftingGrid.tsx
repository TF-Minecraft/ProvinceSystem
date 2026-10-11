import Link from "next/link";
import StationModelViewer from "./StationModelViewer";
import RecipeVehiclePreview from "./RecipeVehiclePreview";
import RecipeItemIcon from "./RecipeItemIcon";
import StationOutputPreview from "./StationOutputPreview";
import { getStationAcquisitionVisual, stations, vehicles, type Slot as SlotData, type Recipe } from "../../wiki/data";
import { getRecipeItemHref } from "../../wiki/data/items";

function Slot({ name, qty, texture, model, sourceId, isOutput = false }: { name?: string; qty?: number; isOutput?: boolean } & Pick<SlotData, "texture" | "model" | "sourceId">) {
  const href = name ? getRecipeItemHref({ name, qty: qty ?? 1, texture, model, sourceId }) : undefined;
  const isMaterial = !!href;
  const vehicle = model ? vehicles.find((candidate) => candidate.skins.some((skin) => skin.modelUrl === model.url)) : undefined;
  const stationVisual = isOutput ? getStationAcquisitionVisual(sourceId) : undefined;
  const stationInfo = stationVisual ? stations.find((candidate) => candidate.slug === stationVisual.slug) : undefined;
  const visualModel = stationVisual ? undefined : model;
  const visualTexture = stationVisual?.thumbnail ?? texture;

  if (model && vehicle) {
    return <RecipeVehiclePreview name={name ?? vehicle.name} qty={qty} model={model} slug={vehicle.slug} />;
  }

  const box = (
    <div
      className={
        isMaterial
          ? "group relative z-0 flex h-12 w-12 shrink-0 items-center justify-center overflow-visible border border-[color-mix(in_srgb,var(--tfmc-accent)_45%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_75%,transparent)] transition-colors duration-150 hover:z-10 hover:border-[var(--tfmc-accent)] sm:h-14 sm:w-14"
         : visualModel || stationVisual
           ? "group relative z-0 flex h-12 w-12 shrink-0 items-center justify-center overflow-visible border border-[color-mix(in_srgb,var(--tfmc-cream)_18%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_70%,transparent)] outline-none hover:z-20 focus:z-20 focus:border-[var(--tfmc-accent)] sm:h-14 sm:w-14"
           : "relative flex h-12 w-12 shrink-0 items-center justify-center border border-[color-mix(in_srgb,var(--tfmc-cream)_18%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_70%,transparent)] sm:h-14 sm:w-14"
      }
      title={name}
      tabIndex={visualModel && !href ? 0 : undefined}
      aria-label={visualModel && name && !href ? `3D preview of ${name}. Hover or focus to enlarge.` : undefined}
    >
      {visualModel ? (
        <StationModelViewer
          modelUrl={visualModel.url}
          textureUrl={visualModel.texture}
          textureUrls={visualModel.textures}
          textureAnimationUrl={visualModel.textureAnimationUrl}
          variant="thumb"
        />
      ) : stationVisual ? (
        <StationOutputPreview thumbnail={stationVisual.thumbnail} alt={name ?? ""} model={stationInfo?.model ?? model} cubeFaces={stationInfo?.cubeFaces} />
      ): visualTexture ? (
        <RecipeItemIcon src={visualTexture} alt={name ?? ""} enlarge={isMaterial} />
      ): name ? (
        <span className="px-1 text-center text-[9px] leading-tight text-[var(--tfmc-stone)]">
          {name}
        </span>
      ): null}
      {name && qty && qty > 1 ? (
        <span
          className="absolute bottom-0 right-0.5 text-[10px] font-semibold text-[var(--tfmc-cream)] [text-shadow:1px_1px_0_#000]"
        >
          {qty}
        </span>
      ): null}
    </div>
  );

  if (isMaterial) {
    return (
      <Link href={href!} aria-label={`View ${name}`} className="group outline-none focus-visible:ring-2 focus-visible:ring-[var(--tfmc-accent)]">
        {box}
      </Link>
    );
  }
  return box;
}

export default function CraftingGrid({ recipe }: { recipe: Recipe }) {
  const slots = Array.from({ length: 9 }, (_, i) => recipe.ingredients[i]);
  const station = stations.find((s) => s.name === recipe.station);

  return (
    <div className="rounded-md border border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_55%,transparent)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-[family-name:var(--font-fraunces)] text-lg text-[var(--tfmc-cream)]">
          {recipe.title}
        </h3>
        {station ? (
          <Link
            href={`/wiki/stations/${station.slug}`}
            className="group flex items-center gap-1.5 rounded border border-transparent py-0.5 pl-1 pr-1.5 text-xs text-[var(--tfmc-mist)] transition-colors hover:border-[color-mix(in_srgb,var(--tfmc-accent)_35%,transparent)] hover:bg-[color-mix(in_srgb,var(--tfmc-accent)_10%,transparent)] hover:text-[var(--tfmc-accent)]"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={station.icon}
              alt=""
              className="h-4 w-4 [image-rendering:pixelated] transition-transform duration-150 group-hover:scale-125"
            />
            <span className="underline-offset-2 group-hover:underline">{recipe.station}</span>
          </Link>
        ): (
          <span className="text-xs text-[var(--tfmc-mist)]">{recipe.station}</span>
        )}
      </div>
      {recipe.requirement || recipe.time !== undefined ? (
        <p className="mt-1 text-xs text-[var(--tfmc-accent)]">
          {recipe.requirement ? `Requires: ${recipe.requirement}` : null}
          {recipe.requirement && recipe.time !== undefined ? " · " : null}
          {recipe.time !== undefined ? `Crafting time: ${recipe.time} seconds` : null}
        </p>
      ): null}

      <div className="mt-3 flex flex-wrap items-center gap-4">
        <div className="grid grid-cols-3 gap-1">
          {slots.map((slot, i) => (
            <Slot key={i} name={slot?.name} qty={slot?.qty} texture={slot?.texture} model={slot?.model} sourceId={slot?.sourceId} />
          ))}
        </div>

        <span className="text-xl text-[var(--tfmc-mist)]">&rarr;</span>

        <Slot
          isOutput
          name={recipe.output.name}
          qty={recipe.output.qty}
          texture={recipe.output.texture}
          model={recipe.output.model}
          sourceId={recipe.output.sourceId}
        />
      </div>

      {recipe.note ? <p className="mt-3 text-xs text-[var(--tfmc-mist)]">{recipe.note}</p>: null}
    </div>
  );
}
