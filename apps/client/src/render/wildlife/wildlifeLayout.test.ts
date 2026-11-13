import { applyOp, cellKey, emptyBlueprint, starterHouseOp, type Blueprint } from "@cg/shared";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { lakeShape } from "../sceneryLayout";
import { shoreLayout } from "../shoreLayout";
import { animate, buildSpecies, climbing, FISH_PARTS, SPECIES } from "./wildlifeModels";
import { fishLeap, gardenCritters, lawnNav, makePatrol, patrolAt, wildlifeLayout, type Critter, type Species } from "./wildlifeLayout";

const W = 24;
const D = 20;

function house(): Blueprint {
  const r = applyOp(emptyBlueprint(W, D), starterHouseOp(), undefined, { accepted: true });
  if (!r.ok) throw Error(r.reason);
  return r.blueprint;
}

describe("a patrol", () => {
  const beats = [
    { x: 0, z: 0, stay: 2, act: "graze" as const },
    { x: 4, z: 0, stay: 1, act: "idle" as const },
    { x: 4, z: 3, stay: 0 },
  ];
  const p = makePatrol(beats, 2);

  it("walks between the beats at its own pace and stays where it should", () => {
    // the loop: 0→(4,0) walk 2 s, stay 1; →(4,3) walk 1.5 s; →(0,0) walk 2.5 s, stay 2
    expect(p.cycle).toBeCloseTo(2 + 1 + 1.5 + 2.5 + 2, 5);
    // it starts the loop on the way into the first beat (2.5 s from the last), then stays there
    const arriving = patrolAt(p, 1);
    expect(arriving.moving).toBe(true);
    const a = patrolAt(p, 2.6);
    expect(a.act).toBe("graze");
    expect([a.x, a.z]).toEqual([0, 0]);
    // 2 s into the stay, 1 s of the way along to the next beat: half way, facing +x
    const walking = patrolAt(p, 2.5 + 2 + 1.0);
    expect(walking.moving).toBe(true);
    expect(walking.x).toBeCloseTo(2, 5);
    expect(walking.heading).toBeCloseTo(Math.PI / 2, 5);
  });

  it("is smooth: it never jumps further than it could walk", () => {
    let last = patrolAt(p, 0);
    for (let t = 0.05; t < p.cycle * 2; t += 0.05) {
      const s = patrolAt(p, t);
      // (eased ends of a walk are up to 1.65x as fast)
      expect(Math.hypot(s.x - last.x, s.z - last.z)).toBeLessThan(2 * 1.7 * 0.05 + 1e-6);
      last = s;
    }
  });

  it("repeats, whatever the clock or the offset", () => {
    const a = patrolAt(p, 3.3, 1.2);
    const b = patrolAt(p, 3.3 + p.cycle * 5, 1.2);
    expect([a.x, a.z, a.moving]).toEqual([b.x, b.z, b.moving]);
    const c = patrolAt(p, -5, 0);
    expect(Number.isFinite(c.x)).toBe(true);
  });
});

describe("the wildlife outdoors", () => {
  const critters = wildlifeLayout(W, D);
  const lake = lakeShape(W);
  const by = (k: Species) => critters.filter((c) => c.kind === k);

  it("has deer with a fawn, rabbits, squirrels, a fox, frogs and sparrows, each with its own id", () => {
    expect(by("deer").length).toBeGreaterThanOrEqual(1);
    expect(by("buck")).toHaveLength(1);
    expect(by("fawn")).toHaveLength(1);
    expect(by("rabbit").length).toBeGreaterThanOrEqual(1);
    expect(by("squirrel").length).toBeGreaterThanOrEqual(1);
    expect(by("fox")).toHaveLength(1);
    expect(by("frog")).toHaveLength(3);
    expect(by("sparrow")).toHaveLength(5);
    expect(new Set(critters.map((c) => c.id)).size).toBe(critters.length);
  });

  it("is the same every time and for any lot of the same size", () => {
    expect(wildlifeLayout(W, D)).toBe(critters);
    expect(JSON.stringify(wildlifeLayout(30, 24))).toBe(JSON.stringify(wildlifeLayout(30, 24)));
  });

  it("keeps land animals on dry land and out of the lot, and the frogs on the lilies and sparrows on the fence", () => {
    const lilies = shoreLayout(W, D).lilies;
    for (const c of critters) {
      for (const b of c.beats) {
        expect(Number.isFinite(b.x) && Number.isFinite(b.z)).toBe(true);
        if (c.kind === "frog") expect(lilies.some((l) => Math.hypot(l.x - b.x, l.z - b.z) < 0.5)).toBe(true);
        else if (c.kind === "sparrow") {
          expect(b.y).toBeGreaterThan(0.9);
          const onFence = Math.abs(b.z + 0.6) < 1e-6 || Math.abs(b.x + 0.6) < 1e-6 || Math.abs(b.x - (W + 0.6)) < 1e-6;
          expect(onFence).toBe(true);
        } else {
          expect(lake.inside(b.x, b.z, 0.5)).toBe(false);
          expect(b.x > -1.5 && b.x < W + 1.5 && b.z > -1.5 && b.z < D + 1.5).toBe(false);
        }
      }
    }
  });

  it("gives every skittish land animal somewhere to bolt to, outside the lot", () => {
    for (const c of critters.filter((c) => !c.garden && c.kind !== "sparrow")) {
      expect(c.refuge, c.id).toBeDefined();
      expect(c.refuge!.x > -1 && c.refuge!.x < W + 1 && c.refuge!.z > -1 && c.refuge!.z < D + 1).toBe(false);
    }
  });

  it("sends them to their trees over dry land and round the lot, never through the lake or the garden", () => {
    for (const c of critters.filter((c) => c.refuge && !["sparrow", "squirrel", "rabbit"].includes(c.kind))) {
      for (const b of c.beats) {
        for (let i = 0; i <= 40; i++) {
          const x = b.x + ((c.refuge!.x - b.x) * i) / 40;
          const z = b.z + ((c.refuge!.z - b.z) * i) / 40;
          expect(lake.inside(x, z, 0), `${c.id} run passes through the lake at ${x.toFixed(1)},${z.toFixed(1)}`).toBe(false);
          expect(x > 0 && x < W && z > 0 && z < D, `${c.id} run crosses the lot at ${x.toFixed(1)},${z.toFixed(1)}`).toBe(false);
        }
      }
    }
  });

  it("has squirrels climb trunks (they stay a while on a climb beat), and the fox sniff along its way", () => {
    for (const c of by("squirrel")) expect(c.beats.some((b) => b.act === "climb" && b.stay >= 6)).toBe(true);
    expect(by("fox")[0]!.beats.some((b) => b.act === "sniff" && b.stay > 0)).toBe(true);
  });
});

describe("the garden's animals", () => {
  const bp = house();
  const level = bp.levels[0]!;
  const nav = lawnNav(bp);
  const onLawn = (x: number, z: number) => {
    const [cx, cz] = [Math.floor(x), Math.floor(z)];
    return cx >= 0 && cz >= 0 && cx < W && cz < D && !nav.blocked[cz * W + cx] && !level.tiles[cellKey(cx, cz)] && !level.roofs[cellKey(cx, cz)];
  };

  it("exist when there's lawn, and only ever stand on it", () => {
    const garden = gardenCritters(bp);
    expect(garden.length).toBeGreaterThanOrEqual(2);
    expect(garden.every((c) => c.garden)).toBe(true);
    for (const c of garden) for (const b of c.beats) expect(onLawn(b.x, b.z), `${c.id} at ${b.x},${b.z}`).toBe(true);
  });

  it("walk round the house, never through it: every step between two spots stays on the lawn", () => {
    for (const c of gardenCritters(bp)) {
      const p = makePatrol(c.beats, c.speed);
      for (let t = 0; t < p.cycle; t += 0.1) {
        const s = patrolAt(p, t);
        expect(onLawn(s.x, s.z), `${c.id} at t=${t.toFixed(1)}: ${s.x.toFixed(2)},${s.z.toFixed(2)}`).toBe(true);
      }
    }
  });

  it("are left out when there's no lawn at all, and don't depend on the clock", () => {
    const everywhere: Blueprint = { ...bp, levels: [{ ...level, tiles: Object.fromEntries(Array.from({ length: W * D }, (_, i) => [cellKey(i % W, Math.floor(i / W)), { material: "oak" }])) }] };
    expect(gardenCritters(everywhere)).toEqual([]);
    expect(JSON.stringify(gardenCritters(bp))).toBe(JSON.stringify(gardenCritters(bp)));
    expect(gardenCritters(emptyBlueprint(W, D)).length).toBeGreaterThan(0);
  });
});

describe("fish leaping from the lake", () => {
  it("come up now and then, arc over the water and leave a ring that spreads and then goes", () => {
    const lake = lakeShape(W);
    let leaps = 0;
    let rings = 0;
    for (let i = 0; i < 3; i++) {
      for (let t = 0; t < 120; t += 0.05) {
        const f = fishLeap(W, i, t);
        if (f.leap) {
          leaps++;
          expect(f.leap.y).toBeGreaterThanOrEqual(0.04 - 1e-9);
          expect(f.leap.y).toBeLessThan(0.8);
          expect(lake.inside(f.leap.x, f.leap.z, -0.5)).toBe(true);
        }
        if (f.ring) {
          rings++;
          expect(f.ring.k).toBeGreaterThanOrEqual(0);
          expect(f.ring.k).toBeLessThanOrEqual(1);
        }
      }
    }
    expect(leaps).toBeGreaterThan(30);
    expect(rings).toBeGreaterThan(leaps);
    // but not all the time
    let under = 0;
    for (let t = 0; t < 120; t += 0.05) if (!fishLeap(W, 0, t).leap) under++;
    expect(under).toBeGreaterThan(1500);
  });
});

describe("the models", () => {
  const kinds = Object.keys(SPECIES) as Species[];
  const box = (meshes: { geometry: THREE.BufferGeometry }[]) => {
    const b = new THREE.Box3();
    for (const m of meshes) {
      m.geometry.computeBoundingBox();
      b.union(m.geometry.boundingBox!);
    }
    return b;
  };

  it.each(kinds)("%s builds, is a sensible size and stands on the ground", (kind) => {
    const meshes = buildSpecies(SPECIES[kind]);
    const all = Object.values(meshes).flat();
    expect(all.length).toBeGreaterThan(0);
    for (const m of all) expect(Number.isFinite(m.geometry.attributes.position!.array[0])).toBe(true);
    const b = box(all);
    const limit: Record<Species, [number, number]> = { deer: [1.1, 1.6], buck: [1.2, 1.8], fawn: [1.1, 1.6], rabbit: [0.25, 0.6], squirrel: [0.3, 0.7], fox: [0.6, 0.9], hedgehog: [0.1, 0.25], frog: [0.08, 0.14], sparrow: [0.1, 0.2] };
    expect(b.max.y).toBeGreaterThan(limit[kind][0]);
    expect(b.max.y).toBeLessThan(limit[kind][1]);
    expect(b.min.y).toBeGreaterThan(-0.02);
    expect(b.min.y).toBeLessThan(0.05);
    // every part named in the spec was built
    for (const p of SPECIES[kind]) expect(meshes[p.id]!.length).toBeGreaterThan(0);
  });

  it("includes the leaping fish", () => {
    expect(Object.values(buildSpecies(FISH_PARTS)).flat().length).toBeGreaterThan(0);
  });

  it.each(kinds)("%s moves with finite numbers in every state, and its legs swing only while it walks", (kind) => {
    for (const moving of [false, true]) {
      for (const act of ["graze", "sniff", "climb", "idle", "preen", null] as const) {
        for (const alert of [0, 1]) {
          for (let t = 0; t < 12; t += 0.37) {
            const p = animate(kind, { t, dist: t * 0.9, speed: moving ? 0.9 : 0, moving, act, u: (t / 12) % 1, alert, fleeing: moving && alert === 1, seed: 3 });
            for (const v of [p.dy, p.pitch, p.roll, ...Object.values(p.parts).flatMap((q) => Object.values(q))]) expect(Number.isFinite(v)).toBe(true);
            expect(Math.abs(p.pitch)).toBeLessThan(2);
            if (!moving && p.parts.legsA) expect(p.parts.legsA.rx ?? 0).toBeCloseTo(0, 6);
          }
        }
      }
    }
  });

  it("has a squirrel climb up and back down, landing level on the ground", () => {
    expect(climbing(0).height).toBeCloseTo(0, 5);
    expect(climbing(1).height).toBeCloseTo(0, 5);
    expect(climbing(0.5).height).toBeGreaterThan(1.5);
    expect(climbing(0.999).pitch).toBe(0);
    let last = climbing(0).height;
    for (let u = 0.01; u <= 1; u += 0.01) {
      const h = climbing(u).height;
      expect(Math.abs(h - last)).toBeLessThan(0.15);
      last = h;
    }
  });
});

export type { Critter };
