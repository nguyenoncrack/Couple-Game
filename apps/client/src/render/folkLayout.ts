import { campLayout, playLayout } from "./sceneryLayout";
import { trailCurve, trailNetwork } from "./trailLayout";

/**
 * Who's about in the countryside round the lot (see Folk): a few people round the campfire, children and a
 * parent at the playground, and walkers out on the footpaths. Worked out from the lot's size alone, all outside
 * the lot, and nothing they do reaches the house, its navigation or the server.
 */

type XZ = [number, number];

/** What someone is doing, which decides how they move (see Folk). */
export type FolkKind = "chat" | "roast" | "swing" | "push" | "slide" | "dig" | "walk";

export interface Folk {
  kind: FolkKind;
  /** Seeds their looks (skin, hair, style), with the sweater colour on top. */
  id: string;
  sweater: string;
  /** Children are drawn smaller. */
  scale: number;
  /** Where they are and which way they face (radians about y, 0 facing +z); walkers start here. */
  x: number;
  z: number;
  ry: number;
  /** Height of the seat under them, if they're sitting. */
  seat?: number;
  /** Offset into their movements, seconds, so neighbours don't move together. */
  phase: number;
  /** For walkers: the path (evenly spaced points), metres a second, and how far to its left they keep. */
  route?: XZ[];
  speed?: number;
  side?: number;
  /** For the swinging child and the parent pushing: which swing. */
  swing?: number;
}

export const MAX_FOLK = 12;
export const CHILD = 0.62;
/** Seat heights: the log benches and the stumps round the fire. */
export const BENCH_SEAT = 0.55;
export const STUMP_SEAT = 0.44;

const made = new Map<string, Folk[]>();

export function folkLayout(w: number, d: number): Folk[] {
  const key = `${w}:${d}`;
  let f = made.get(key);
  if (!f) made.set(key, (f = makeFolk(w, d)));
  return f;
}

/** Facing from one point toward another. */
const facing = (from: XZ, to: XZ) => Math.atan2(to[0] - from[0], to[1] - from[1]);

function makeFolk(w: number, d: number): Folk[] {
  const { fire } = campLayout(d);
  const fc: XZ = [fire[0], fire[2]];
  const play = playLayout(w, d);
  const net = trailNetwork(w, d);
  const folk: Folk[] = [];

  // two friends on the log bench nearest the house (see Yard's fire circle: a bench at 2.15 m, along the circle)
  const a = 0.1;
  const bench: XZ = [fc[0] + Math.cos(a) * 2.15, fc[1] + Math.sin(a) * 2.15];
  [-0.42, 0.42].forEach((t, i) => {
    const at: XZ = [bench[0] - Math.sin(a) * t, bench[1] + Math.cos(a) * t];
    folk.push({ kind: "chat", id: `camper-${i}`, sweater: ["#c9643f", "#5f7f9e"][i]!, scale: 1, x: at[0], z: at[1], ry: facing(at, fc), seat: BENCH_SEAT, phase: i * 3.7 });
  });
  // and one on the stump with the marshmallow stick
  const s = 3.35;
  const stump: XZ = [fc[0] + Math.cos(s) * 1.95, fc[1] + Math.sin(s) * 1.95];
  folk.push({ kind: "roast", id: "camper-2", sweater: "#7a9a5a", scale: 1, x: stump[0], z: stump[1], ry: facing(stump, fc), seat: STUMP_SEAT, phase: 1.3 });

  // a child on the near swing, facing along the way it swings, and a parent behind giving pushes
  const sw = play.swings[0]!;
  folk.push({ kind: "swing", id: "kid-0", sweater: "#e8a33f", scale: CHILD, x: sw.x, z: sw.z, ry: Math.PI / 2, phase: 0, swing: 0 });
  folk.push({ kind: "push", id: "parent-0", sweater: "#8a6aa8", scale: 1, x: sw.x - 0.9, z: sw.z, ry: Math.PI / 2, phase: 0, swing: 0 });
  // one going round and round: up the ladder, down the slide, back round to the ladder
  folk.push({ kind: "slide", id: "kid-1", sweater: "#d9534f", scale: CHILD, x: play.slide.x, z: play.slide.z - 1.15, ry: 0, phase: 2.5 });
  // and one digging in the sandbox, toward the bucket
  const dig: XZ = [play.sandbox.x - 0.15, play.sandbox.z + 0.05];
  folk.push({ kind: "dig", id: "kid-2", sweater: "#4f9fd6", scale: CHILD, x: dig[0], z: dig[1], ry: facing(dig, [play.sandbox.x + 0.3, play.sandbox.z - 0.2]), phase: 0.7 });

  // walkers: one on the lake trail, a couple side by side on the meadow trail; each goes to the end and back
  const walk = (trail: string, id: string, sweater: string, speed: number, phase: number, side = 0) => {
    const t = net.trails.find((x) => x.name === trail);
    if (!t) return;
    const c = trailCurve(t.points);
    const route = c.getSpacedPoints(Math.max(8, Math.ceil(c.getLength() * 2))).map((p): XZ => [p.x, p.z]);
    folk.push({ kind: "walk", id, sweater, scale: 1, x: route[0]![0], z: route[0]![1], ry: facing(route[0]!, route[1]!), phase, route, speed, side });
  };
  walk("lake", "walker-0", "#b35a7a", 1.0, 0);
  walk("meadow", "walker-1", "#3f7a72", 0.85, 9, 0.27);
  walk("meadow", "walker-2", "#d4a24c", 0.85, 9, -0.27);

  return folk.slice(0, MAX_FOLK);
}

/** Where a walker is at `t` seconds: along the path to its end, a pause, back again, a pause. */
export function walkerAt(f: Folk, t: number, pause = 3) {
  const route = f.route!;
  const speed = f.speed ?? 1;
  let len = 0;
  for (let i = 1; i < route.length; i++) len += Math.hypot(route[i]![0] - route[i - 1]![0], route[i]![1] - route[i - 1]![1]);
  const leg = len / speed;
  const cycle = (leg + pause) * 2;
  const u = (((t + f.phase) % cycle) + cycle) % cycle;
  const back = u >= leg + pause;
  const v = back ? u - leg - pause : u;
  const moving = v < leg;
  const s = (moving ? v / leg : 1) * len;
  // along the path, `s` metres from the start (or from the end on the way back)
  let left = back ? len - s : s;
  for (let i = 1; i < route.length; i++) {
    const [ax, az] = route[i - 1]!;
    const [bx, bz] = route[i]!;
    const seg = Math.hypot(bx - ax, bz - az);
    if (left <= seg || i === route.length - 1) {
      const k = seg > 0 ? Math.min(1, left / seg) : 0;
      const tx = (bx - ax) / (seg || 1);
      const tz = (bz - az) / (seg || 1);
      const side = f.side ?? 0;
      return {
        x: ax + (bx - ax) * k - tz * side,
        z: az + (bz - az) * k + tx * side,
        ry: back ? Math.atan2(-tx, -tz) : Math.atan2(tx, tz),
        moving,
      };
    }
    left -= seg;
  }
  return { x: route[0]![0], z: route[0]![1], ry: f.ry, moving: false };
}
