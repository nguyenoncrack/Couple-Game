import { floorOf, positionAt } from "@cg/shared";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { serverNow, useGame } from "../../state/game";
import { useReducedMotion } from "../Ambient";
import type { BuiltMesh } from "../kit";
import { natureMaterial } from "../nature";
import { animate, buildSpecies, climbing, FISH_PARTS, SPECIES, type PartSpec } from "./wildlifeModels";
import { FISH, fishLeap, gardenCritters, makePatrol, patrolAt, wildlifeLayout, type Critter, type Species } from "./wildlifeLayout";

/**
 * The countryside's wildlife (see wildlifeLayout): deer grazing in the clearings, rabbits, squirrels, a fox on the
 * footpaths, a hedgehog in the garden, frogs on the lilies, sparrows on the fence and a fish leaping from the lake.
 * Where each one is depends only on the clock, so the two of you see the same animals in the same places, and
 * nothing is sent or saved. They notice people: a character coming near makes them look up, freeze or bolt for the
 * trees, then they drift back to what they were doing. Drawn as a handful of instanced meshes. People who ask for
 * less motion get them standing about instead.
 */

/** Past this distance from the camera they're too small to see, so they're not drawn. */
const FAR = 80;
const CAP = 8;
const RUN: Record<Species, number> = { deer: 4.6, buck: 4.8, fawn: 4.2, rabbit: 5.2, squirrel: 5.5, fox: 4.8, hedgehog: 0.6, frog: 1, sparrow: 6.5 };

/** One animal's state on this screen: where it is, which way it's facing, how far it has walked. */
interface Live {
  x: number;
  z: number;
  y: number;
  heading: number;
  dist: number;
  speed: number;
  alert: number;
  alarmUntil: number;
  seed: number;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

const base = new THREE.Matrix4();
const part = new THREE.Matrix4();
const tmpA = new THREE.Matrix4();
const tmpB = new THREE.Matrix4();
const quat = new THREE.Quaternion();
const euler = new THREE.Euler();
const v3 = new THREE.Vector3();
const scale = new THREE.Vector3();
const origin = new THREE.Vector3();

interface Built {
  specs: PartSpec[];
  meshes: Record<string, BuiltMesh[]>;
}

export function Wildlife({ w, d }: { w: number; d: number }) {
  const still = useReducedMotion();
  const bp = useGame((s) => s.view);
  const level = bp?.levels[0];
  const garden = useMemo(() => (bp ? gardenCritters(bp) : []), [bp?.lot.w, bp?.lot.d, level?.objects, level?.tiles, level?.roofs, level?.walls]); // eslint-disable-line react-hooks/exhaustive-deps
  const critters = useMemo(() => [...wildlifeLayout(w, d), ...garden], [w, d, garden]);
  const live = useRef(new Map<string, Live>());
  // a changed garden means new routes: the garden's animals start over from them (not from where the old ones were)
  useEffect(() => {
    for (const c of garden) live.current.delete(c.id);
  }, [garden]);
  const patrols = useMemo(() => new Map(critters.map((c) => [c.id, makePatrol(c.beats, c.speed)])), [critters]);
  const built = useMemo(() => {
    const out = {} as Record<Species | "fish", Built>;
    for (const [kind, specs] of Object.entries(SPECIES)) out[kind as Species] = { specs, meshes: buildSpecies(specs) };
    out.fish = { specs: FISH_PARTS, meshes: buildSpecies(FISH_PARTS) };
    return out;
  }, []);
  useEffect(() => () => Object.values(built).forEach((b) => Object.values(b.meshes).flat().forEach((m) => m.geometry.dispose())), [built]);

  const meshes = useRef(new Map<string, THREE.InstancedMesh>());
  // (a handle for looking at them from the browser's console while developing)
  if (import.meta.env.DEV) Object.assign(window, { __wild: { live: live.current, critters } });
  const camera = useThree((s) => s.camera);
  const ring = useMemo(() => ({ geometry: new THREE.RingGeometry(0.86, 1, 28).rotateX(-Math.PI / 2), material: natureMaterial("#d4eaea", { alpha: 0.45 }) }), []);
  const rings = useRef<THREE.InstancedMesh>(null);
  useEffect(
    () => () => {
      ring.geometry.dispose();
    },
    [ring],
  );

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const now = serverNow() / 1000;
    const t = still ? 0 : now;
    const state = useGame.getState();

    // who's about on the ground floor, to be startled by
    const threats: [number, number][] = [];
    if (!still && state.life) {
      const ms = serverNow();
      for (const a of Object.values(state.life.avatars)) {
        if (floorOf(a) !== 0) continue;
        const p = positionAt(a, ms);
        if (p.y < 0.5) threats.push([p.x, p.z]);
      }
    }

    const slots: Partial<Record<Species, number>> = {};
    const place = (kind: Species | "fish", model: Built, c: { x: number; y: number; z: number; heading: number; pitch: number; roll: number; scale: number; parts: Record<string, { rx?: number; ry?: number; rz?: number; sx?: number; sy?: number; sz?: number }> }) => {
      const slot = (slots[kind as Species] = (slots[kind as Species] ?? -1) + 1);
      if (slot >= CAP) return;
      quat.setFromEuler(euler.set(c.pitch, c.heading, c.roll, "YXZ"));
      base.compose(v3.set(c.x, c.y, c.z), quat, scale.setScalar(c.scale));
      for (const spec of model.specs) {
        const pp = c.parts[spec.id];
        const targets = model.meshes[spec.id]!;
        part.copy(base);
        if (pp) {
          // about the part's own pivot: out to the pivot, turn (and squash), back
          part.multiply(tmpA.makeTranslation(spec.pivot[0], spec.pivot[1], spec.pivot[2]));
          quat.setFromEuler(euler.set(pp.rx ?? 0, pp.ry ?? 0, pp.rz ?? 0, "XYZ"));
          part.multiply(tmpB.compose(origin.set(0, 0, 0), quat, scale.set(pp.sx ?? 1, pp.sy ?? 1, pp.sz ?? 1)));
          part.multiply(tmpA.makeTranslation(-spec.pivot[0], -spec.pivot[1], -spec.pivot[2]));
        }
        targets.forEach((_, i) => meshes.current.get(`${kind}:${spec.id}:${i}`)?.setMatrixAt(slot, part));
      }
    };

    for (const c of critters) {
      const patrol = patrols.get(c.id)!;
      const st = patrolAt(patrol, t, c.phase);
      let s = live.current.get(c.id);
      if (!s) live.current.set(c.id, (s = { x: st.x, z: st.z, y: st.y, heading: st.heading, dist: st.dist, speed: 0, alert: 0, alarmUntil: 0, seed: (c.id.length * 7.3 + c.phase) % 10 }));

      // is anyone near?
      let nearest = Infinity;
      let toward = st.heading;
      for (const [tx, tz] of threats) {
        const dd = Math.hypot(tx - s.x, tz - s.z);
        if (dd < nearest) [nearest, toward] = [dd, Math.atan2(tx - s.x, tz - s.z)];
      }
      const startled = nearest < c.skittish;
      if (startled && c.refuge && !c.garden) s.alarmUntil = now + 4.5;
      const fleeing = !still && now < s.alarmUntil && Boolean(c.refuge);
      const freeze = !still && Boolean(c.garden) && startled;

      const goal = fleeing ? { x: c.refuge!.x, y: c.refuge!.y ?? 0, z: c.refuge!.z } : { x: st.x, y: st.y, z: st.z };
      const dx = goal.x - s.x;
      const dz = goal.z - s.z;
      const gap = Math.hypot(dx, dz);
      let moved = 0;
      if (still || (gap > 14 && !fleeing)) {
        // (a long way off the schedule: after a pause in the tab, or a change to the garden)
        [s.x, s.z, s.y] = [goal.x, goal.z, goal.y];
        s.heading = st.heading;
        s.dist = st.dist;
      } else {
        const cap = fleeing ? RUN[c.kind] : freeze ? 0 : c.speed * 1.7 + 0.3;
        moved = Math.min(gap, cap * dt);
        if (gap > 1e-6) {
          s.x += (dx / gap) * moved;
          s.z += (dz / gap) * moved;
        }
        s.y += (goal.y - s.y) * Math.min(1, dt * (fleeing ? 6 : 4));
        s.dist += moved;
      }
      const speedNow = dt > 0 ? moved / dt : 0;
      s.speed += (speedNow - s.speed) * Math.min(1, dt * 6);
      const moving = s.speed > 0.1;

      // which way it's looking: where it's going, else at whoever startled it, else as it was
      s.alert += ((!still && nearest < c.skittish * 1.6 ? 1 : 0) - s.alert) * Math.min(1, dt * 4);
      const want = moving ? Math.atan2(dx, dz) : s.alert > 0.3 ? toward : st.heading;
      s.heading += wrap(want - s.heading) * Math.min(1, dt * (moving ? 8 : 4));

      // too far away to see: leave it out
      if (camera.position.distanceTo(v3.set(s.x, 0, s.z)) > FAR) continue;

      // a squirrel that's bolted to its tree sits up on a branch
      const treed = c.kind === "squirrel" && fleeing && gap < 0.3;
      const pose = animate(c.kind, {
        t,
        dist: s.dist,
        speed: s.speed,
        moving,
        act: moving ? null : fleeing ? "idle" : st.act,
        u: fleeing ? (now * 1.4) % 1 : st.u,
        alert: s.alert,
        fleeing: fleeing && moving,
        seed: s.seed,
      });
      const perched = treed ? climbing(0.5) : null;
      place(c.kind, built[c.kind], {
        x: s.x,
        y: s.y + (perched ? 0 : pose.dy),
        z: s.z,
        heading: s.heading,
        pitch: perched ? perched.pitch : pose.pitch,
        roll: pose.roll,
        scale: c.scale,
        parts: pose.parts,
      });
    }

    // fish leaping from the lake, and the rings they leave
    let ringCount = 0;
    if (!still) {
      for (let i = 0; i < FISH; i++) {
        const f = fishLeap(w, i, t);
        if (f.leap && camera.position.distanceTo(v3.set(f.leap.x, 0, f.leap.z)) < FAR) place("fish", built.fish, { x: f.leap.x, y: f.leap.y, z: f.leap.z, heading: f.leap.heading, pitch: f.leap.pitch, roll: 0, scale: 1, parts: {} });
        if (f.ring && rings.current) {
          const r = 0.12 + f.ring.k * 1.1;
          rings.current.setMatrixAt(ringCount++, tmpA.compose(v3.set(f.ring.x, 0.047, f.ring.z), quat.identity(), scale.set(r, 1, r)));
        }
      }
    }
    if (rings.current) {
      rings.current.count = ringCount;
      rings.current.instanceMatrix.needsUpdate = true;
    }

    // show only as many of each kind as there were placed
    for (const [key, mesh] of meshes.current) {
      const kind = key.split(":")[0] as Species | "fish";
      mesh.count = Math.min(CAP, (slots[kind as Species] ?? -1) + 1);
      mesh.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group name="wildlife">
      {Object.entries(built).flatMap(([kind, b]) =>
        b.specs.flatMap((spec) =>
          b.meshes[spec.id]!.map((mesh, i) => (
            <instancedMesh
              key={`${kind}:${spec.id}:${i}`}
              ref={(m) => {
                const k = `${kind}:${spec.id}:${i}`;
                if (m) {
                  m.count = 0;
                  meshes.current.set(k, m);
                } else meshes.current.delete(k);
              }}
              args={[mesh.geometry, mesh.material, CAP]}
              frustumCulled={false}
              userData={{ noShadow: true }}
              dispose={null}
              raycast={() => null}
            />
          )),
        ),
      )}
      <instancedMesh ref={rings} args={[ring.geometry, ring.material, FISH]} frustumCulled={false} userData={{ noShadow: true }} dispose={null} raycast={() => null} />
    </group>
  );
}

export type { Critter };
