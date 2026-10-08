import { adminRequest } from "./api";

/** x, z in blocks. */
export type RailPoint = [number, number];

export type RailStretch = {
  /** Distance along the track, in blocks. */
  from: number;
  to: number;
  points: RailPoint[];
};

export type RailTrack = {
  id: string;
  line: number;
  length: number;
  loop: boolean;
  points: RailPoint[];
  broken: RailStretch[];
  damaged: RailStretch[];
};

export type RailLine = { id: number; name: string; length: number; tracks: string[] };

export type RailJunction = { id: string; stem: string; branch: string; at: RailPoint; thrown: boolean };

export type RailStop = {
  name: string;
  kind: string;
  faction_id: string | null;
  /** The settlement's centre. */
  settlement: RailPoint;
  track: string;
  line: number;
  along: number;
  /** Where the track comes closest to the settlement, inside its provinces. */
  at: RailPoint;
  /** Blocks from `at` to the settlement's centre. */
  distance: number;
};

export type RailStatus = "ok" | "not_configured" | "missing";

export type RailNetwork = {
  status: RailStatus;
  world: string;
  /** When VehicleFramework last saved any of the files, in Unix seconds. */
  updated_at: number | null;
  unreadable_files: number;
  lines: RailLine[];
  tracks: RailTrack[];
  junctions: RailJunction[];
  stops: RailStop[];
};

export function getRailNetwork(mapId: string): Promise<RailNetwork> {
  return adminRequest(`/admin/rail?map=${encodeURIComponent(mapId)}`);
}

const LINE_COLOURS = ["#e8473b", "#3fae5a", "#4aa3f0", "#f2b632", "#c86dd7", "#ff8c42", "#43c5b8"];
const UNNAMED_COLOUR = "#b9b6aa";

/** A line's colour: the first two match the hand-drawn Vardera rail map (red, then green). */
export function lineColour(line: RailLine | undefined): string {
  if (!line) return UNNAMED_COLOUR;
  return line.name === "Unnamed line" ? UNNAMED_COLOUR : LINE_COLOURS[line.id % LINE_COLOURS.length];
}

export function statusMessage(status: RailStatus): string | null {
  if (status === "not_configured") return "Rail data isn’t available on this site.";
  if (status === "missing") return "Rail data isn’t available right now.";
  return null;
}

/** `1,234 blocks`, or `1 block`. */
export function blocks(n: number): string {
  const rounded = Math.round(n);
  return `${rounded.toLocaleString("en-GB")} ${rounded === 1 ? "block" : "blocks"}`;
}

export type Bounds = { x: number; y: number; w: number; h: number };

/** The box around some points, at least `min` blocks across. */
export function boundsOfPoints(points: RailPoint[], min = 0): Bounds | null {
  if (!points.length) return null;
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const [x, z] of points) {
    x0 = Math.min(x0, x);
    z0 = Math.min(z0, z);
    x1 = Math.max(x1, x);
    z1 = Math.max(z1, z);
  }
  const w = x1 - x0;
  const h = z1 - z0;
  const padW = Math.max(min, w) - w;
  const padH = Math.max(min, h) - h;
  return { x: x0 - padW / 2, y: z0 - padH / 2, w: w + padW, h: h + padH };
}

/** Track ends that are not a junction: where the line stops. */
export function terminals(network: RailNetwork, near = 3): { at: RailPoint; towards: RailPoint; line: number }[] {
  const joins = network.junctions.map((j) => j.at);
  const out: { at: RailPoint; towards: RailPoint; line: number }[] = [];
  for (const track of network.tracks) {
    if (track.loop || track.points.length < 2) continue;
    const ends: [RailPoint, RailPoint][] = [
      [track.points[0], track.points[1]],
      [track.points[track.points.length - 1], track.points[track.points.length - 2]],
    ];
    for (const [at, towards] of ends) {
      if (joins.some(([x, z]) => Math.hypot(x - at[0], z - at[1]) <= near)) continue;
      out.push({ at, towards, line: track.line });
    }
  }
  return out;
}
