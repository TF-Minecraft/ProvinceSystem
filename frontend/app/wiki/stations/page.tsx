import { WikiItemText, WikiPage } from "@/app/components/wiki";
import { stations } from "@/app/wiki/data";
import StationGallery from "./StationGallery";

export default function StationsPage() {
  const blurbs = Object.fromEntries(stations.map((station) => [
    station.slug,
    <WikiItemText key={station.slug} text={station.blurb} excludeHref={`/wiki/stations/${station.slug}`} />,
  ]));

  return (
    <WikiPage
      lastModified="2026-09-27"
      title="Crafting Stations"
      intro="Browse every station, learn which block opens it, and follow its link for recipes and requirements. Select a station to preview it."
      width="lg"
    >
      <h2 id="catalogue" className="sr-only">Station catalogue</h2>
      <StationGallery stations={stations} blurbs={blurbs} />
    </WikiPage>
  );
}
