import { MapEngineProvider } from "../core/MapEngineContext";
import MapViewer from "../components/MapViewer";

/** The live `main` map. `/map/main` redirects here (see `next.config.ts`). */
export default function Page() {
  return (
    <MapEngineProvider>
      <MapViewer mapId="main" />
    </MapEngineProvider>
  );
}
