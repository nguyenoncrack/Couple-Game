import { catalog, cellKey, edgeBetween, type Blueprint, type Level } from "@cg/shared";

/**
 * Where the party's moving lights go. Pure arithmetic from the blueprint and the clock (no drawing), so it's easy
 * to test: each fixture knows how far it can see in every direction before a wall (or the edge of the lot), and
 * every beam, spot and sparkle is kept inside that. All motion is slow, smooth and a function of the server clock,
 * so both screens agree.
 */

export type FixtureKind = "laser" | "movinghead" | "discoball";
export const FIXTURE_KINDS: readonly FixtureKind[] = ["laser", "movinghead", "discoball"];
/** Kinds whose moving parts are drawn live while the lights are on (their model leaves those parts out then). */
export const DYNAMIC_KINDS: ReadonlySet<string> = new Set(["movinghead", "discoball"]);
/** Most of each kind drawn at once, to keep the effects light. */
export const MAX_FIXTURES: Record<FixtureKind, number> = { laser: 6, movinghead: 6, discoball: 3 };

export interface Fixture {
  id: string;
  level: number;
  kind: FixtureKind;
  /** The middle of its footprint, lot metres. */
  x: number;
  z: number;
  /** The model's turn about y: where its front (+z) points. */
  yaw: number;
  seed: number;
  /** The body or ball colour from its catalog item. */
  tint: string;
}

const hashSeed = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
};

/** Every light fixture in the house, by the model kind of its catalog item. */
export function collectFixtures(bp: Blueprint): Fixture[] {
  const out: Fixture[] = [];
  bp.levels.forEach((level, index) => {
    for (const o of Object.values(level.objects)) {
      const item = catalog.furniture.get(o.catalogId);
      const kind = item?.model.kind as FixtureKind | undefined;
      if (!item || !kind || !FIXTURE_KINDS.includes(kind)) continue;
      const [w, d] = o.rot % 2 ? [item.footprint[1], item.footprint[0]] : item.footprint;
      out.push({ id: o.id, level: index, kind, x: o.x + w / 2, z: o.z + d / 2, yaw: (-o.rot * Math.PI) / 2, seed: hashSeed(o.id), tint: String(item.model.ball ?? item.model.body ?? "#cfd3da") });
    }
  });
  return out;
}

const STEP = 0.12;
export const RAY_MAX = 9;
const SAMPLES = 96;
/** Keep this far off the wall itself. */
const MARGIN = 0.12;

/**
 * How far a beam can run from a point in each direction before it meets a wall (a door counts as wall: light stays
 * in the room) or the edge of the lot, up to `max` metres. Worked out once, when the house changes.
 */
export class RoomRays {
  private dist = new Float32Array(SAMPLES);

  /**
   * `floorOnly`: upstairs, where there's nothing to light past the edge of the floor, so light stops at it (on the
   * ground floor the whole lot is floor).
   */
  constructor(level: Pick<Level, "walls" | "tiles"> | undefined, lot: { w: number; d: number }, readonly x: number, readonly z: number, readonly max = RAY_MAX, floorOnly = false) {
    const tiles = floorOnly ? (level?.tiles ?? {}) : null;
    for (let i = 0; i < SAMPLES; i++) this.dist[i] = cast(level?.walls ?? {}, tiles, lot, x, z, (i / SAMPLES) * Math.PI * 2, max);
  }

  /** The clear distance along `angle` (radians: 0 is +z, as a model's yaw), blended between the sampled directions. */
  at(angle: number): number {
    const t = (((angle / (Math.PI * 2)) % 1) + 1) % 1 * SAMPLES;
    const i = Math.floor(t);
    // the shorter of the two neighbours, so a beam angled between samples never pokes through a corner
    return Math.min(this.dist[i % SAMPLES]!, this.dist[(i + 1) % SAMPLES]!);
  }
}

function cast(walls: Record<string, unknown>, tiles: Record<string, unknown> | null, lot: { w: number; d: number }, x: number, z: number, angle: number, max: number): number {
  const dx = Math.sin(angle);
  const dz = Math.cos(angle);
  let cell: [number, number] = [Math.floor(x), Math.floor(z)];
  for (let s = STEP; s <= max; s += STEP) {
    const px = x + dx * s;
    const pz = z + dz * s;
    const next: [number, number] = [Math.floor(px), Math.floor(pz)];
    if (px < 0 || pz < 0 || px >= lot.w || pz >= lot.d) return Math.max(0, s - STEP - MARGIN);
    if (next[0] !== cell[0] || next[1] !== cell[1]) {
      if (tiles && !tiles[cellKey(next[0], next[1])]) return Math.max(0, s - STEP - MARGIN);
      // crossing a wall edge (or, going diagonally, either edge on the way): the light stops here
      const sideways: [number, number] = [next[0], cell[1]];
      const along: [number, number] = [cell[0], next[1]];
      const blocked =
        next[0] !== cell[0] && next[1] !== cell[1]
          ? walls[edgeBetween(cell, sideways)] || walls[edgeBetween(sideways, next)] || walls[edgeBetween(cell, along)] || walls[edgeBetween(along, next)]
          : walls[edgeBetween(cell, next)];
      if (blocked) return Math.max(0, s - STEP - MARGIN);
      cell = next;
    }
  }
  return max;
}

/** Smooth, slow side-to-side value in -1 to 1 whose period divides the party clock's wrap. */
export const slow = (t: number, period: number, phase = 0) => Math.sin((t / period + phase) * Math.PI * 2);

export interface Beam {
  /** From (the lens) and to (where it lands), world metres relative to the floor of its level. */
  from: [number, number, number];
  to: [number, number, number];
  /** Where along the palette this beam's colour is. */
  hue: number;
  /** 0 to 1. */
  glow: number;
}

/** Where a moving head's two lamps start (relative to the fixture's middle, in its own frame: x across, z forward) and how high. */
export const HEAD_AT: readonly [number, number][] = [[-0.27, 0], [0.27, 0]];
export const HEAD_Y = 1.1;
export const LASER_Y = 1.12;
const BALL_Y = 1.98;
export { BALL_Y };

const turn = (f: Fixture, lx: number, lz: number): [number, number] => {
  const c = Math.cos(f.yaw);
  const s = Math.sin(f.yaw);
  // rotation about y by yaw takes local (lx, lz) to world (lx*cos + lz*sin, -lx*sin + lz*cos)
  return [f.x + lx * c + lz * s, f.z - lx * s + lz * c];
};

/**
 * One moving head's beam: it wanders over the floor of its room on two slow, unrelated swings, kept short of the
 * walls. Steady light holds it pointing at the middle of the area in front of it.
 */
export function headBeams(f: Fixture, rays: RoomRays, t: number, steady: boolean, spread: number): Beam[] {
  return HEAD_AT.map(([lx, lz], i) => {
    const [ox, oz] = turn(f, lx, lz);
    const phase = f.seed + i * 0.37;
    const a = steady ? f.yaw + (i ? 0.35 : -0.35) : f.yaw + slow(t, 14, phase) * (0.9 + spread * 0.6) + (i ? 0.5 : -0.5);
    const reach = steady ? 0.55 : 0.55 + 0.4 * (0.5 + 0.5 * slow(t, 9, phase + 0.3));
    // measured from the middle of the fixture, where the room's rays were cast from
    const dist = Math.max(0.2, Math.min(reach * 4.5, rays.at(a) - 0.1));
    return {
      from: [ox, HEAD_Y, oz],
      to: [f.x + Math.sin(a) * dist, 0.02, f.z + Math.cos(a) * dist],
      hue: f.seed + i * 0.25 + (steady ? 0 : t / 40),
      glow: 0.85,
    };
  });
}

export const LASER_BEAMS = 7;

/**
 * A laser's fan: seven thin beams spread across the front of the fixture, rocking gently, each running out to
 * whichever wall (or lot edge) it meets first. `spread` (0.2 to 1) is how wide the fan opens.
 */
export function laserBeams(f: Fixture, rays: RoomRays, t: number, steady: boolean, spread: number): Beam[] {
  const [ox, oz] = turn(f, 0, 0.1);
  const out: Beam[] = [];
  const rock = steady ? 0 : slow(t, 12, f.seed) * 0.35;
  for (let i = 0; i < LASER_BEAMS; i++) {
    const k = i / (LASER_BEAMS - 1) - 0.5;
    const a = f.yaw + k * spread * 2.4 + rock;
    const lift = steady ? 0.1 : 0.12 * slow(t, 8, f.seed + k);
    const len = Math.max(0.4, rays.at(a) - 0.1);
    out.push({ from: [ox, LASER_Y, oz], to: [ox + Math.sin(a) * len, Math.min(2.3, Math.max(0.3, LASER_Y + 0.15 + lift + len * 0.04)), oz + Math.cos(a) * len], hue: f.seed + k * 0.5 + (steady ? 0 : t / 30), glow: 0.9 });
  }
  return out;
}

export interface Spot {
  x: number;
  z: number;
  hue: number;
  size: number;
}

export const SPOTS = 22;

/** The mirror ball's light on the floor and walls: spots circling slowly, each only where the room really is. */
export function ballSpots(f: Fixture, rays: RoomRays, t: number, steady: boolean): Spot[] {
  const out: Spot[] = [];
  const turnBy = steady ? 0 : (t / 36) * Math.PI * 2;
  for (let i = 0; i < SPOTS; i++) {
    const ring = 1 + (i % 4);
    const a = (i / SPOTS) * Math.PI * 2 * 3.1 + turnBy * (i % 2 ? 1 : -0.7);
    const want = ring * 1.15 + 0.4 * Math.sin(i * 1.7);
    const room = rays.at(a) - 0.15;
    // a spot that wouldn't fit before the wall is left out, not squashed against it
    if (room < want) continue;
    out.push({ x: f.x + Math.sin(a) * want, z: f.z + Math.cos(a) * want, hue: f.seed + i * 0.11, size: 0.16 + 0.05 * (i % 3) });
  }
  return out;
}
