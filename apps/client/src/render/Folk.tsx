import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { HIP, SHOULDER, THIGH, TORSO, arm, looksFor, shin, thigh, torso } from "../features/character/characterParts";
import { useReducedMotion } from "./Ambient";
import { poseFor, turnToward, type Pose } from "./Characters";
import { folkLayout, walkerAt, type Folk as FolkSpec } from "./folkLayout";
import { KitMesh } from "./KitMesh";
import { playLayout, SWING_ARC, SWING_DROP, SWING_RATE } from "./sceneryLayout";

/**
 * Neighbours out in the countryside (see folkLayout): chatting and toasting marshmallows round the campfire,
 * swinging, sliding and digging at the playground, and walking the footpaths. Drawn with the same jointed
 * pencil bodies as the two of you, but only for show: they can't be clicked, never come onto the lot, and
 * move on each screen's own clock. With reduced motion they keep still.
 */

/** Beyond this distance from the camera they're too small to make out, so they're left out. */
const FAR = 80;

/** Where someone is this frame, and how they hold themselves. */
interface Place {
  x: number;
  y: number;
  z: number;
  ry: number;
  /** Tipped forward (+) or back about their own x, after turning (down the slide, on the swing). */
  rx: number;
  pose: Pose;
  /** Turn straight to `ry` rather than easing round to it. */
  snap: boolean;
}

const still = (hip: number, extra: Partial<Pose> = {}): Pose => ({ hip, lean: 0, thighs: [0, 0], knees: [0, 0], arms: [0.05, 0.05], spread: 0.1, roll: 0, ...extra });

const smooth = (a: number, b: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

type Play = ReturnType<typeof playLayout>;

/** The slide, as a loop of steps (seconds): up the ladder, across the platform, down the chute, back round. */
function sliding(f: FolkSpec, t: number, play: Play, place: Place) {
  const { x: px, z: pz } = play.slide;
  const back: [number, number][] = [
    [px, pz + 3.65],
    [px + 1.0, pz + 3.1],
    [px + 1.0, pz - 1.7],
    [px, pz - 1.7],
    [px, pz - 1.2],
  ];
  let walkLen = 0;
  for (let i = 1; i < back.length; i++) walkLen += Math.hypot(back[i]![0] - back[i - 1]![0], back[i]![1] - back[i - 1]![1]);
  const RUN = 1.3;
  const steps = { climb: 2.2, cross: 0.9, settle: 0.5, slide: 1.4, up: 0.7, run: walkLen / RUN, wait: 1.4 };
  const cycle = Object.values(steps).reduce((a, b) => a + b, 0);
  let u = (t + f.phase) % cycle;
  const s = u;
  const deck = 1.45;
  place.rx = 0;
  place.snap = false;
  place.ry = 0;
  place.x = px;
  if (u < steps.climb) {
    const k = u / steps.climb;
    place.y = k * deck;
    place.z = pz - 1.2 + k * 0.75;
    const c = Math.sin(s * Math.PI * 2 * 1.2);
    place.pose = { hip: HIP - 0.1, lean: -0.15, thighs: [-0.9 + c * 0.35, -0.9 - c * 0.35], knees: [1.0 - c * 0.3, 1.0 + c * 0.3], arms: [-2.3 - c * 0.3, -2.3 + c * 0.3], spread: 0.05, roll: 0 };
    return;
  }
  u -= steps.climb;
  if (u < steps.cross) {
    place.y = deck;
    place.z = pz - 0.45 + (u / steps.cross) * 0.85;
    place.pose = poseFor("walk", null, s * 1000, true);
    return;
  }
  u -= steps.cross;
  const ride: Pose = { hip: 0.09, lean: 0.2, thighs: [-1.45, -1.45], knees: [0.15, 0.15], arms: [0.5, 0.5], spread: 0.9, roll: 0 };
  if (u < steps.settle) {
    place.y = deck;
    place.z = pz + 0.45;
    place.pose = ride;
    return;
  }
  u -= steps.settle;
  if (u < steps.slide) {
    // gathering speed down the chute, tipped forward along it
    const k = Math.pow(u / steps.slide, 1.5);
    place.y = deck + 0.02 - k * 1.3;
    place.z = pz + 0.5 + k * 2.7;
    place.rx = Math.atan2(1.3, 2.6) * (1 - smooth(0.85, 1, k));
    place.pose = ride;
    return;
  }
  u -= steps.slide;
  if (u < steps.up) {
    place.y = 0.02;
    place.z = pz + 3.45 + (u / steps.up) * 0.2;
    place.pose = still(HIP);
    return;
  }
  u -= steps.up;
  // running back round to the foot of the ladder, then a moment's wait
  let left = Math.min(u, steps.run) * RUN;
  place.y = 0.02;
  for (let i = 1; i < back.length; i++) {
    const [ax, az] = back[i - 1]!;
    const [bx, bz] = back[i]!;
    const seg = Math.hypot(bx - ax, bz - az);
    if (left <= seg || i === back.length - 1) {
      const k = Math.min(1, left / seg);
      place.x = ax + (bx - ax) * k;
      place.z = az + (bz - az) * k;
      place.ry = u < steps.run ? Math.atan2(bx - ax, bz - az) : 0;
      break;
    }
    left -= seg;
  }
  place.pose = u < steps.run ? poseFor("walk", null, s * 1000 * 1.4, true) : still(HIP);
}

function move(f: FolkSpec, t: number, quiet: boolean, play: Play, place: Place) {
  place.x = f.x;
  place.y = 0;
  place.z = f.z;
  place.ry = f.ry;
  place.rx = 0;
  place.snap = true;
  const s = t + f.phase;
  switch (f.kind) {
    case "chat": {
      // taking turns to talk, a hand going as they do
      const talking = !quiet && Math.sin(s * 0.45) > 0.2;
      const pose = poseFor("sit", f.seat!, s * 1000, false);
      pose.lean = -0.04;
      pose.arms = [-0.45, talking ? -0.95 + Math.sin(s * 3.1) * 0.25 : -0.4];
      place.pose = pose;
      return;
    }
    case "roast": {
      const pose = poseFor("sit", f.seat!, s * 1000, false);
      pose.lean = -0.14 + Math.sin(s * 0.6) * 0.03;
      pose.arms = [-1.0, -1.12];
      pose.spread = -0.15;
      place.pose = pose;
      return;
    }
    case "swing": {
      // riding the same arc as the swing (see Yard), legs pumping with it
      const sw = play.swings[f.swing ?? 0]!;
      const a = quiet ? 0 : Math.sin(t * SWING_RATE + sw.phase) * SWING_ARC;
      const pump = quiet ? 0 : Math.cos(t * SWING_RATE + sw.phase);
      const drop = SWING_DROP - 0.03;
      place.x = sw.x + Math.sin(a) * drop;
      place.y = sw.y - Math.cos(a) * drop;
      place.z = sw.z;
      place.rx = -a;
      place.pose = { hip: 0.1, lean: 0.08 + pump * 0.12, thighs: [-1.35 - pump * 0.25, -1.35 - pump * 0.25], knees: [1.15 + pump * 0.4, 1.15 + pump * 0.4], arms: [-2.6, -2.6], spread: -0.04, roll: 0 };
      return;
    }
    case "push": {
      // reaching out as the swing comes back to them
      const sw = play.swings[f.swing ?? 0]!;
      const a = quiet ? 0 : Math.sin(t * SWING_RATE + sw.phase) * SWING_ARC;
      const reach = smooth(-0.04, -0.14, a);
      place.pose = still(HIP, { lean: -0.12 * reach, arms: [-0.35 - reach * 1.15, -0.35 - reach * 1.15], spread: -0.05 });
      return;
    }
    case "slide":
      if (quiet) {
        place.pose = still(HIP);
        return;
      }
      sliding(f, t, play, place);
      return;
    case "dig": {
      // kneeling in the sand, scooping into the bucket now and then
      const busy = !quiet && Math.sin(s * 0.5) > -0.3;
      const scoop = busy ? Math.sin(s * 4) * 0.3 : 0;
      place.y = 0.19;
      place.pose = { hip: 0.46, lean: -0.35, thighs: [0, 0], knees: [1.5, 1.5], arms: [-0.9 + scoop, -0.9 - scoop], spread: -0.1, roll: 0 };
      return;
    }
    case "walk": {
      const w = walkerAt(f, quiet ? 0 : t);
      place.x = w.x;
      place.z = w.z;
      place.ry = w.ry;
      place.snap = false;
      place.pose = w.moving && !quiet ? poseFor("walk", null, s * 1000 * (f.speed ?? 1), true) : poseFor("idle", null, s * 1000, true);
      return;
    }
  }
}

function Person({ f, quiet, play }: { f: FolkSpec; quiet: boolean; play: Play }) {
  const looks = useMemo(() => looksFor(f.id, f.sweater), [f.id, f.sweater]);
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const thighL = useRef<THREE.Group>(null);
  const thighR = useRef<THREE.Group>(null);
  const kneeL = useRef<THREE.Group>(null);
  const kneeR = useRef<THREE.Group>(null);
  const place = useMemo<Place>(() => ({ x: f.x, y: 0, z: f.z, ry: f.ry, rx: 0, pose: still(HIP), snap: true }), [f]);
  const first = useRef(true);

  useFrame(({ clock, camera }, dt) => {
    const g = root.current;
    const b = body.current;
    if (!g || !b) return;
    move(f, quiet ? 0 : clock.elapsedTime, quiet, play, place);
    g.visible = camera.position.distanceTo(g.position.set(place.x, place.y, place.z)) < FAR;
    if (!g.visible) return;
    const snap = first.current;
    first.current = false;
    const turned = place.snap || snap ? place.ry : turnToward(g.rotation.y, place.ry, 1 - Math.exp(-dt * 6));
    g.rotation.y = THREE.MathUtils.euclideanModulo(turned + Math.PI, Math.PI * 2) - Math.PI;
    g.rotation.x = place.rx;
    const { pose } = place;
    const j = snap ? 1 : 1 - Math.exp(-dt * 12);
    b.position.y += (pose.hip - b.position.y) * j;
    b.rotation.x += (-pose.lean - b.rotation.x) * j;
    const limbs: [React.RefObject<THREE.Group | null>, number][] = [
      [armL, pose.arms[0]],
      [armR, pose.arms[1]],
      [thighL, pose.thighs[0]],
      [thighR, pose.thighs[1]],
      [kneeL, pose.knees[0]],
      [kneeR, pose.knees[1]],
    ];
    for (const [r, a] of limbs) if (r.current) r.current.rotation.x += (a - r.current.rotation.x) * j;
    if (armL.current) armL.current.rotation.z += (-pose.spread - armL.current.rotation.z) * j;
    if (armR.current) armR.current.rotation.z += (pose.spread - armR.current.rotation.z) * j;
  });

  return (
    <group ref={root} position={[f.x, 0, f.z]} rotation={[0, f.ry, 0, "YXZ"]}>
      <group scale={f.scale}>
        <group ref={body} position={[0, HIP, 0]}>
          <KitMesh make={(k) => torso(k, looks)} deps={[looks]} />
          {([-1, 1] as const).map((sx) => (
            <group key={`arm${sx}`} ref={sx < 0 ? armL : armR} position={[sx * SHOULDER, TORSO - 0.06, 0]}>
              <KitMesh make={(k) => arm(k, looks)} deps={[looks]} />
            </group>
          ))}
          {([-1, 1] as const).map((sx) => (
            <group key={`leg${sx}`} ref={sx < 0 ? thighL : thighR} position={[sx * 0.09, 0, 0]}>
              <KitMesh make={(k) => thigh(k, looks, sx)} deps={[looks]} />
              <group ref={sx < 0 ? kneeL : kneeR} position={[0, -THIGH, 0]}>
                <KitMesh make={(k) => shin(k, looks)} deps={[looks]} />
              </group>
            </group>
          ))}
        </group>
      </group>
    </group>
  );
}

export function Folk({ w, d }: { w: number; d: number }) {
  const quiet = useReducedMotion();
  const folk = useMemo(() => folkLayout(w, d), [w, d]);
  const play = useMemo(() => playLayout(w, d), [w, d]);
  return (
    <group name="folk">
      {folk.map((f) => (
        <Person key={f.id} f={f} quiet={quiet} play={play} />
      ))}
    </group>
  );
}
