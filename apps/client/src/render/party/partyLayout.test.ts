import { catalog, edgesBetween, emptyBlueprint, applyOp, Op, type Blueprint } from "@cg/shared";
import { describe, expect, it } from "vitest";
import { ballSpots, collectFixtures, DYNAMIC_KINDS, headBeams, laserBeams, LASER_BEAMS, RAY_MAX, RoomRays, SPOTS, type Fixture } from "./partyLayout";

const place = (bp: Blueprint, id: string, catalogId: string, x: number, z: number, rot = 0) => {
  const r = applyOp(bp, Op.parse({ t: "object.place", level: 0, id, catalogId, x, z, rot }));
  if (!r.ok) throw new Error(r.reason);
  return r.blueprint;
};
/** A 6 × 6 room with its walls round x 4–10, z 4–10, in a 24 × 20 lot. */
const room = () => {
  let bp = emptyBlueprint(24, 20);
  for (const [a, b, c, d] of [[4, 4, 10, 4], [4, 10, 10, 10], [4, 4, 4, 10], [10, 4, 10, 10]] as const) {
    const r = applyOp(bp, Op.parse({ t: "walls.add", level: 0, edges: edgesBetween(a, b, c, d), style: "plaster_cream" }));
    if (!r.ok) throw new Error(r.reason);
    bp = r.blueprint;
  }
  return bp;
};
const inside = (x: number, z: number, margin = 0) => x > 4 + margin && x < 10 - margin && z > 4 + margin && z < 10 - margin;
const times = Array.from({ length: 200 }, (_, i) => i * 7.3);

describe("light fixtures", () => {
  it("finds each fixture with where it stands and faces", () => {
    let bp = emptyBlueprint(24, 20);
    bp = place(bp, "las0000001", "laser_light", 5, 5, 1);
    bp = place(bp, "mov0000001", "moving_head_white", 7, 5);
    bp = place(bp, "bal0000001", "disco_ball_gold", 8, 8);
    bp = place(bp, "tile000001", "dance_tile", 2, 2);
    const found = collectFixtures(bp);
    expect(found.map((f) => f.kind).sort()).toEqual(["discoball", "laser", "movinghead"]);
    const laser = found.find((f) => f.kind === "laser")!;
    expect(laser).toMatchObject({ x: 5.5, z: 5.5, level: 0 });
    expect(laser.yaw).toBeCloseTo(-Math.PI / 2);
    expect(found.find((f) => f.kind === "discoball")!.tint).toBe("#e6c35c");
    expect(DYNAMIC_KINDS.has("movinghead") && DYNAMIC_KINDS.has("discoball") && !DYNAMIC_KINDS.has("laser")).toBe(true);
  });
});

describe("how far light can go", () => {
  it("stops at the walls of the room it's in", () => {
    const rays = new RoomRays(room().levels[0], { w: 24, d: 20 }, 7, 7);
    for (let a = 0; a < Math.PI * 2; a += 0.05) {
      const d = rays.at(a);
      expect(d).toBeGreaterThan(0.5);
      expect(inside(7 + Math.sin(a) * d, 7 + Math.cos(a) * d, 0.05), `angle ${a.toFixed(2)}`).toBe(true);
    }
    // straight at a wall it's about three metres, to a corner about four
    expect(rays.at(0)).toBeCloseTo(3 - 0.12 - 0.12, 0);
    expect(rays.at(Math.PI / 4)).toBeLessThan(4.4);
  });

  it("stops at the edge of the lot, and goes no further than the longest beam", () => {
    const bp = emptyBlueprint(24, 20);
    const near = new RoomRays(bp.levels[0], { w: 24, d: 20 }, 22.5, 10);
    expect(near.at(Math.PI / 2)).toBeLessThan(1.5);
    expect(near.at(-Math.PI / 2)).toBeLessThanOrEqual(RAY_MAX);
    const open = new RoomRays(bp.levels[0], { w: 24, d: 20 }, 12, 10);
    expect(open.at(0)).toBe(RAY_MAX);
  });

  it("stops at the edge of an upstairs floor, where there's nothing to light beyond", () => {
    const tiles: Record<string, { material: string }> = {};
    for (let x = 4; x < 10; x++) for (let z = 4; z < 10; z++) tiles[`${x}:${z}`] = { material: "oak" };
    const up = { walls: {}, tiles } as never;
    const rays = new RoomRays(up, { w: 24, d: 20 }, 7, 7, RAY_MAX, true);
    for (let a = 0; a < Math.PI * 2; a += 0.05) {
      const d = rays.at(a);
      expect(inside(7 + Math.sin(a) * d, 7 + Math.cos(a) * d, 0.05), `angle ${a.toFixed(2)}`).toBe(true);
    }
    // the ground floor has no such edge
    expect(new RoomRays(up, { w: 24, d: 20 }, 7, 7, RAY_MAX, false).at(0)).toBe(RAY_MAX);
  });

  it("treats a door as wall: light stays in the room", () => {
    let bp = room();
    const r = applyOp(bp, Op.parse({ t: "opening.place", level: 0, id: "door000001", catalogId: "door_wood", dir: "h", x: 6, z: 10, flip: false }));
    if (!r.ok) throw new Error(r.reason);
    bp = r.blueprint;
    const rays = new RoomRays(bp.levels[0], { w: 24, d: 20 }, 6.5, 8);
    expect(inside(6.5 + Math.sin(0) * rays.at(0), 8 + rays.at(0), 0)).toBe(true);
  });
});

function fixture(kind: Fixture["kind"], over: Partial<Fixture> = {}): Fixture {
  return { id: "fix0000001", level: 0, kind, x: 7, z: 7, yaw: 0, seed: 0.37, tint: "#cfd3da", ...over };
}

describe("where beams and spots go", () => {
  const bp = room();
  const rays = (f: Fixture) => new RoomRays(bp.levels[0], { w: 24, d: 20 }, f.x, f.z);

  it("keeps every moving-head beam on the floor of its own room", () => {
    for (const yaw of [0, 1, 2.5, -1.2]) {
      const f = fixture("movinghead", { yaw });
      const r = rays(f);
      for (const t of times) for (const steady of [false, true]) for (const b of headBeams(f, r, t, steady, 0.6)) {
        expect(inside(b.to[0], b.to[2], 0.05), `t ${t} yaw ${yaw}`).toBe(true);
        expect(b.to[1]).toBeLessThan(0.1);
        expect(b.from[1]).toBeGreaterThan(0.8);
      }
    }
  });

  it("keeps every laser inside the room, however wide the fan", () => {
    for (const spread of [0.2, 0.6, 1]) {
      const f = fixture("laser", { yaw: 0.8 });
      const r = rays(f);
      for (const t of times) {
        const beams = laserBeams(f, r, t, false, spread);
        expect(beams).toHaveLength(LASER_BEAMS);
        for (const b of beams) {
          expect(inside(b.to[0], b.to[2], 0.02), `t ${t}`).toBe(true);
          expect(b.to[1]).toBeGreaterThan(0.2);
          expect(b.to[1]).toBeLessThan(2.4);
        }
      }
    }
  });

  it("opens the fan wider as the spread goes up", () => {
    const f = fixture("laser");
    const width = (spread: number) => {
      const beams = laserBeams(f, new RoomRays(emptyBlueprint(40, 40).levels[0], { w: 40, d: 40 }, 20, 20), 0, true, spread);
      return Math.abs(beams[0]!.to[0] - beams[LASER_BEAMS - 1]!.to[0]);
    };
    expect(width(1)).toBeGreaterThan(width(0.4));
    expect(width(0.4)).toBeGreaterThan(width(0.2));
  });

  it("puts every mirror-ball spot inside the room, and leaves out those that won't fit", () => {
    const f = fixture("discoball");
    for (const t of times) {
      const spots = ballSpots(f, rays(f), t, false);
      expect(spots.length).toBeGreaterThan(3);
      expect(spots.length).toBeLessThanOrEqual(SPOTS);
      for (const s of spots) expect(inside(s.x, s.z, 0.1), `t ${t}`).toBe(true);
    }
    const tight = new RoomRays(bp.levels[0], { w: 24, d: 20 }, 4.4, 4.4);
    for (const s of ballSpots({ ...f, x: 4.4, z: 4.4 }, tight, 11, false)) expect(inside(s.x, s.z, 0.05)).toBe(true);
  });

  it("moves slowly and smoothly, the same for everyone, and holds still when steady", () => {
    const f = fixture("movinghead");
    const r = rays(f);
    // a tenth of a second at a time, no beam end jumps more than a few centimetres
    for (let t = 0; t < 120; t += 0.1) {
      const [a, b] = [headBeams(f, r, t, false, 1), headBeams(f, r, t + 0.1, false, 1)];
      a.forEach((beam, i) => expect(Math.hypot(beam.to[0] - b[i]!.to[0], beam.to[2] - b[i]!.to[2])).toBeLessThan(0.45));
    }
    expect(JSON.stringify(headBeams(f, r, 33, false, 0.6))).toBe(JSON.stringify(headBeams(f, r, 33, false, 0.6)));
    expect(JSON.stringify(headBeams(f, r, 1, true, 0.6))).toBe(JSON.stringify(headBeams(f, r, 500, true, 0.6)));
    expect(JSON.stringify(laserBeams(fixture("laser"), r, 1, true, 0.6))).toBe(JSON.stringify(laserBeams(fixture("laser"), r, 77, true, 0.6)));
    expect(JSON.stringify(ballSpots(fixture("discoball"), r, 1, true))).toBe(JSON.stringify(ballSpots(fixture("discoball"), r, 90, true)));
  });

  it("only knows the fixtures the catalog has", () => {
    for (const kind of ["laser", "movinghead", "discoball"]) expect([...catalog.furniture.values()].some((i) => i.model.kind === kind)).toBe(true);
  });
});
