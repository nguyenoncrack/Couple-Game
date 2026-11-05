import { normalizeAppearance, activityAt, arrivalTime, faceDir, floorOf, liftHeight, pingPongMoment, positionAt, STOREY, TOGETHER_MS, type Avatar, type MemberInfo } from "@cg/shared";
import { Html } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { roofVisible, serverNow, setFloor, useGame } from "../state/game";
import { cameraFollow, cameraGestureActive } from "./CameraRig";
import { FLOOR_Y } from "./House";
import { HIP, THIGH, TORSO, SHOULDER, ARM, torso, arm, thigh, shin, looksFor, customizedLooks } from "../features/character/characterParts";
import { KitMesh } from "./KitMesh";
import { controller, paddle } from "./entertainmentModels";
import { pencilMaterial } from "./pencil";
import { NeedThought } from "../ui/Needs";

/**
 * The two of you, drawn in pencil like the furniture. Each character is a few jointed parts (body, arms, thighs,
 * shins) so they can walk, sit, lie down, cook, bathe and swim. Where they are comes from the server's life state: a path and
 * the time they set off, so both screens work out the same position every frame without more messages. Things
 * you say float over your head for a few seconds; hearts float up while you hug, kiss or cuddle (notes while you
 * dance, a "ha" while you laugh).
 */

/** Joint angles (radians, about x; negative swings forward) and how the whole body sits. */
export interface Pose {
  /** Height of the hips, and how far the body leans back (lying down is π/2). */
  hip: number;
  lean: number;
  thighs: [number, number];
  knees: [number, number];
  arms: [number, number];
  /** Arms out to the sides a little (negative wraps them round in front). */
  spread: number;
  /** Turned about the spine before leaning back, to lie on one side (cuddling). */
  roll: number;
  /** Twisting at the waist (dancing, laughing). */
  twist?: number;
}

/** For things done with someone: how long since it started, and whether you're the one who started it. */
export interface WithSomeone {
  since: number;
  lead: boolean;
}

/** Laughing: bent over a little, shaking, arms going. */
function laugh(s: number): Pose {
  const shake = Math.sin(s * 9);
  return { hip: HIP + Math.abs(shake) * 0.025, lean: 0.12 + Math.sin(s * 7) * 0.08, thighs: [0, 0], knees: [0.06, 0.06], arms: [-0.5 + shake * 0.25, -0.7 - shake * 0.25], spread: 0.25, roll: 0, twist: Math.sin(s * 6) * 0.18 };
}

/** Standing and listening: a nod now and then. */
function listen(s: number): Pose {
  return { hip: HIP, lean: -0.03 + Math.max(0, Math.sin(s * 1.8)) * 0.05, thighs: [0, 0.04], knees: [0, 0.08], arms: [-0.15, -0.15], spread: 0.08, roll: 0 };
}

const ease = (from: number, to: number, k: number) => from + (to - from) * k;
/** Where the eyes are on the body: up the spine into the head, a little in front. */
const EYE = new THREE.Vector3(0, TORSO + 0.24, 0.05);
const eyeAt = new THREE.Vector3();

export function poseFor(activity: string, seatY: number | null, t: number, standingTarget: boolean, us: WithSomeone = { since: 0, lead: true }): Pose {
  const s = t / 1000;
  const since = us.since / 1000;
  switch (activity) {
    case "walk": {
      const w = Math.sin(s * Math.PI * 2 * 1.7);
      return {
        hip: HIP + Math.abs(w) * 0.03,
        lean: 0,
        thighs: [w * 0.55, -w * 0.55],
        knees: [Math.max(0, -w) * 0.7, Math.max(0, w) * 0.7],
        arms: [-w * 0.45, w * 0.45],
        spread: 0.08,
        roll: 0,
      };
    }
    case "sit":
      return {
        hip: (seatY ?? 0.45) + 0.05,
        lean: 0.08,
        thighs: [-1.5, -1.5],
        knees: [1.5, 1.5],
        arms: [-0.35, -0.35],
        spread: 0.1,
        roll: 0,
      };
    case "eat": {
      const bite = Math.max(0, Math.sin(s * 2.4));
      if (standingTarget)
        return {
          hip: HIP,
          lean: 0,
          thighs: [0, 0],
          knees: [0, 0],
          arms: [-0.9, -1.1 - bite * 1.2],
          spread: 0.1,
          roll: 0,
        };
      return {
        hip: (seatY ?? 0.45) + 0.05,
        lean: -0.05,
        thighs: [-1.5, -1.5],
        knees: [1.5, 1.5],
        arms: [-0.9, -1.1 - bite * 1.2],
        spread: 0.1,
        roll: 0,
      };
    }
    case "sleep":
      return {
        hip: (seatY ?? 0.5) + 0.12,
        lean: Math.PI / 2,
        thighs: [0, 0],
        knees: [0.05, 0.05],
        arms: [0, 0],
        spread: 0.18,
        roll: 0,
      };
    case "lounge":
      return {
        hip: (seatY ?? 0.36) + 0.12,
        lean: 1.0,
        thighs: [-0.62, -0.5],
        knees: [0.15, 0.05],
        arms: [-0.2, -2.6],
        spread: 0.25,
        roll: 0,
      };
    case "hug": {
      const sway = Math.sin(s * 1.4) * 0.05;
      return { hip: HIP, lean: -0.05, thighs: [0, 0], knees: [0.04, 0.04], arms: [-1.35 + sway, -1.35 - sway], spread: -0.6, roll: 0 };
    }
    case "kiss":
      return { hip: HIP + 0.02, lean: -0.09, thighs: [0, 0.05], knees: [0, 0.18], arms: [-0.85, -0.85], spread: -0.45, roll: 0 };
    case "highfive": {
      // hands up, a slap in the middle, then a little hop
      if (since < 0.7) return { hip: HIP, lean: 0.05, thighs: [0, 0], knees: [0, 0], arms: [0.05, -2.9 * Math.min(1, since / 0.5)], spread: 0.1, roll: 0 };
      if (since < 1.1) return { hip: HIP, lean: -0.14, thighs: [0, -0.15], knees: [0, 0.2], arms: [0.05, -2.35], spread: 0.12, roll: 0 };
      const hop = Math.max(0, Math.sin((since - 1.1) * 7)) * 0.05;
      return { hip: HIP + hop, lean: 0, thighs: [0, 0], knees: [hop * 2, hop * 2], arms: [-2.6, -2.6], spread: 0.35, roll: 0 };
    }
    case "dance": {
      const beat = s * Math.PI * 2 * 1.1;
      const bounce = Math.abs(Math.sin(beat)) * 0.05;
      return {
        hip: HIP - 0.03 + bounce,
        lean: Math.sin(beat / 2) * 0.05,
        thighs: [Math.sin(beat) * 0.25, -Math.sin(beat) * 0.25],
        knees: [0.15 + bounce * 3, 0.15 + bounce * 3],
        arms: [-1.6 + Math.sin(beat) * 1.1, -1.6 - Math.sin(beat) * 1.1],
        spread: 0.45,
        roll: 0,
        twist: Math.sin(beat / 2) * 0.35,
      };
    }
    case "slowdance": {
      const sway = Math.sin(s * 1.3);
      return { hip: HIP + Math.abs(sway) * 0.01, lean: -0.05, thighs: [sway * 0.08, -sway * 0.08], knees: [0.05, 0.05], arms: [-1.15, -1.25], spread: -0.55, roll: 0, twist: sway * 0.18 };
    }
    case "tickle": {
      if (!us.lead) return laugh(s);
      const wiggle = Math.sin(s * 18) * 0.25;
      return { hip: HIP - 0.02, lean: -0.16, thighs: [0, 0], knees: [0.1, 0.1], arms: [-1.3 + wiggle, -1.3 - wiggle], spread: -0.3, roll: 0, twist: Math.sin(s * 3) * 0.1 };
    }
    case "joke": {
      // the telling, then both of you crack up at the end
      if (us.since > TOGETHER_MS.joke - 2200) return laugh(s);
      if (!us.lead) return listen(s);
      return { hip: HIP, lean: -0.04, thighs: [0, 0], knees: [0, 0], arms: [-0.7 + Math.sin(s * 3.2) * 0.35, -1.0 - Math.sin(s * 2.5) * 0.4], spread: 0.3, roll: 0, twist: Math.sin(s * 1.6) * 0.08 };
    }
    case "talk": {
      // taking turns
      const speaking = (Math.floor(us.since / 2200) % 2 === 0) === us.lead;
      if (!speaking) return listen(s);
      return { hip: HIP, lean: -0.03, thighs: [0, 0], knees: [0, 0], arms: [-0.6 + Math.sin(s * 3) * 0.3, -0.85 - Math.sin(s * 2.4) * 0.35], spread: 0.2, roll: 0, twist: Math.sin(s * 1.3) * 0.06 };
    }
    case "backrub": {
      if (!us.lead) return { hip: HIP - 0.02, lean: 0.06, thighs: [0, 0], knees: [0.04, 0.04], arms: [0.05, 0.05], spread: 0.06, roll: 0, twist: Math.sin(s * 0.8) * 0.04 };
      const rub = Math.sin(s * 6) * 0.12;
      return { hip: HIP, lean: -0.08, thighs: [0, 0], knees: [0, 0], arms: [-1.45 + rub, -1.45 - rub], spread: -0.12, roll: 0 };
    }
    case "cuddle":
      return {
        hip: (seatY ?? 0.5) + 0.14,
        lean: Math.PI / 2 - 0.12,
        thighs: [-0.35, -0.2],
        knees: [0.45, 0.3],
        arms: [-1.25, -0.55],
        spread: 0.05,
        roll: 1.15,
      };
    case "cook": {
      const stir = Math.sin(s * 5);
      return {
        hip: HIP,
        lean: -0.08,
        thighs: [0, 0],
        knees: [0, 0],
        arms: [-1.0 + stir * 0.15, -1.15 - stir * 0.15],
        spread: 0.15,
        roll: 0,
      };
    }
    case "prep": {
      const chop = Math.max(0, Math.sin(s * 9));
      return {
        hip: HIP,
        lean: -0.1,
        thighs: [0, 0],
        knees: [0, 0],
        arms: [-1.05, -0.9 - chop * 0.45],
        spread: 0.1,
        roll: 0,
      };
    }
    case "pingpong":
      return { hip: HIP - 0.025, lean: -0.08, thighs: [-0.1, -0.1], knees: [0.16, 0.16], arms: [-0.3, -0.8], spread: 0.12, roll: 0 };
    case "blackjack":
      return { hip: HIP, lean: -0.12, thighs: [0, 0], knees: [0.03, 0.03], arms: [-0.75 + Math.sin(s * 2) * 0.08, -0.8 - Math.sin(s * 2) * 0.08], spread: -0.12, roll: 0 };
    case "play": {
      const floor = (seatY ?? 0) < 0.2;
      const press = Math.sin(s * 8) * 0.015;
      return {
        hip: floor ? 0.16 : (seatY ?? 0.45) + 0.05,
        lean: -0.04,
        thighs: floor ? [-2.0, -2.0] : [-1.45, -1.45],
        knees: floor ? [2.2, 2.2] : [1.45, 1.45],
        arms: [-1.02 + press, -1.02 - press],
        spread: -0.2,
        roll: 0,
      };
    }
    case "watch":
      // on the sofa, leaning back; on the floor, hugging your knees
      if ((seatY ?? 0) < 0.2)
        return { hip: 0.14, lean: -0.1, thighs: [-2.0, -2.0], knees: [2.2, 2.2], arms: [-0.95, -0.95], spread: -0.2, roll: 0 };
      return {
        hip: (seatY ?? 0.45) + 0.05,
        lean: 0.2 + Math.sin(s * 0.7) * 0.02,
        thighs: [-1.45, -1.45],
        knees: [1.45, 1.45],
        arms: [-0.55, -0.45],
        spread: 0.12,
        roll: 0,
      };
    case "toilet":
      return { hip: (seatY ?? 0.44) + 0.05, lean: -0.18, thighs: [-1.5, -1.5], knees: [1.5, 1.5], arms: [-0.85, -0.85], spread: 0.05, roll: 0 };
    case "wash": {
      const rub = Math.sin(s * 11) * 0.12;
      return { hip: HIP, lean: -0.1, thighs: [0, 0], knees: [0, 0], arms: [-0.95 + rub, -0.95 - rub], spread: -0.28, roll: 0 };
    }
    case "shower": {
      // standing under the water, washing your hair
      const rub = Math.sin(s * 7) * 0.18;
      return { hip: HIP, lean: 0.06, thighs: [0, 0], knees: [0, 0], arms: [-2.6 + rub, -2.6 - rub], spread: -0.05, roll: 0 };
    }
    case "bathe": {
      // lying back in the water, legs out, arms along the rim
      const sway = Math.sin(s * 0.9) * 0.03;
      return { hip: (seatY ?? 0.3) + 0.05, lean: 0.5 + sway, thighs: [-1.15, -1.1], knees: [0.45, 0.35], arms: [0.25, 0.25], spread: 1.0, roll: 0 };
    }
    case "swim": {
      // front crawl: face down, arms windmilling, legs kicking
      const stroke = Math.sin(s * 2.6);
      const kick = Math.sin(s * 9) * 0.25;
      return {
        hip: 0.16 + Math.sin(s * 5.2) * 0.015,
        lean: -1.45,
        thighs: [kick, -kick],
        knees: [0.12, 0.12],
        arms: [-1.6 - stroke * 1.4, -1.6 + stroke * 1.4],
        spread: 0.15,
        roll: 0,
      };
    }
    default: {
      const breathe = Math.sin(s * 1.6) * 0.012;
      return {
        hip: HIP + breathe,
        lean: 0,
        thighs: [0, 0],
        knees: [0, 0],
        arms: [0.05, 0.05],
        spread: 0.1,
        roll: 0,
      };
    }
  }
}

/** What floats up over your head while you're doing something together. */
const GLYPH: Record<string, string> = {
  hug: "♥",
  kiss: "♥",
  cuddle: "♥",
  slowdance: "♥",
  backrub: "♥",
  dance: "♪",
  tickle: "ha",
  joke: "ha",
  highfive: "✦",
};
/** Close enough that the two name tags would sit on top of each other. */
const CLOSE = new Set(["hug", "kiss", "cuddle", "slowdance", "backrub", "tickle"]);

/** Swimming laps: this far either side of the middle of your lane, at this speed (metres, metres a second). */
const LAP_HALF = 1.5;
const SWIM_SPEED = 0.7;

/** How far along the lane a swimmer is from its middle at time `t`, and whether they're on the way back. */
function lap(since: number) {
  const len = LAP_HALF * 2;
  const u = ((since / 1000) * SWIM_SPEED + LAP_HALF) % (len * 2);
  return u < len ? { along: u - LAP_HALF, back: false } : { along: len * 2 - u - LAP_HALF, back: true };
}

/** Shortest way round from one angle to another. */
export function turnToward(from: number, to: number, k: number) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return from + d * k;
}

/** How long something said stays over your head: longer for more words. */
const bubbleMs = (text: string) => Math.min(12_000, 3500 + text.length * 70);

/** The last thing this person said, while it's still fresh. */
function SpeechBubble({ memberId }: { memberId: string }) {
  const last = useGame((s) => s.chat.findLast((m) => m.by === memberId) ?? null);
  const [, redraw] = useState(0);
  const left = last ? last.at + bubbleMs(last.text) - serverNow() : 0;
  useEffect(() => {
    if (left <= 0) return;
    const t = window.setTimeout(() => redraw((n) => n + 1), left);
    return () => window.clearTimeout(t);
  }, [last?.id, left > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!last || left <= 0) return null;
  return (
    <div key={last.id} className="speech hand">
      {last.text}
    </div>
  );
}

function Character({ avatar, partner, member, mine }: { avatar: Avatar; partner: Avatar | null; member: MemberInfo; mine: boolean }) {
  const looks = useMemo(() => member.appearance ? customizedLooks(normalizeAppearance(member.appearance)) : looksFor(member.id, member.color), [member.id, member.color, member.appearance]);
  const live = useGame((s) => s.mode === "live");
  // in first person you're behind your own eyes, so your body is out of the way
  const unseen = useGame((s) => mine && s.mode === "live" && s.firstPerson);
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const thighL = useRef<THREE.Group>(null);
  const thighR = useRef<THREE.Group>(null);
  const kneeL = useRef<THREE.Group>(null);
  const kneeR = useRef<THREE.Group>(null);
  const zzz = useRef<HTMLDivElement>(null);
  const ripple = useRef<THREE.Mesh>(null);
  const hearts = useRef<HTMLDivElement>(null);
  const tag = useRef<HTMLDivElement>(null);
  const gamepad = useRef<THREE.Group>(null);
  const heldPaddle = useRef<THREE.Group>(null);
  const heldCard = useRef<THREE.Group>(null);
  const first = useRef(true);
  const myStorey = useRef<number | null>(null);
  // Html made in the scene's very first commit can lose its React root in development; add the tag a tick later.
  const [tagged, setTagged] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setTagged(true), 0);
    return () => window.clearTimeout(t);
  }, []);

  useFrame((_, dt) => {
    const g = root.current;
    if (!g || !body.current) return;
    const t = serverNow();
    const p = positionAt(avatar, t);
    const activity = activityAt(avatar, t);
    const posed = activity !== "walk" && activity !== "idle" && avatar.use?.pose;
    let tx = posed ? avatar.use!.pose!.x : p.x;
    let tz = posed ? avatar.use!.pose!.z : p.z;
    // how high: up or down the stairs, riding a lift, or on the floor they're on (a pose's own height is from there)
    const car = avatar.use?.ride?.on && activity !== "walk" ? useGame.getState().life?.lifts?.[avatar.use.ride.lift] : undefined;
    const ty = car ? liftHeight(car, t) : posed ? floorOf(avatar) * STOREY : p.y;
    const face = posed ? avatar.use!.pose!.face : avatar.face;
    let yaw = p.heading ?? (-face * Math.PI) / 2;
    if (activity === "swim") {
      const { along, back } = lap(t - arrivalTime(avatar));
      const [dx, dz] = faceDir(face);
      tx += dx * along;
      tz += dz * along;
      if (back) yaw += Math.PI;
    }
    // cuddling: shuffle over towards your partner and turn onto your side to face them
    let roll = 0;
    const near = activity === "cuddle" && partner?.use?.pose;
    if (near) {
      const dx = near.x - tx;
      const dz = near.z - tz;
      tx += dx * 0.25;
      tz += dz * 0.25;
      roll = Math.sign(dx * Math.cos(yaw) - dz * Math.sin(yaw) || 1);
    }
    const snap = first.current;
    first.current = false;
    const k = snap ? 1 : 1 - Math.exp(-dt * 14);
    g.position.x = ease(g.position.x, tx, k);
    g.position.z = ease(g.position.z, tz, k);
    g.position.y = ease(g.position.y, FLOOR_Y + ty, k);
    // on a floor above the one you're looking at, they're out of sight (name and all)
    const storey = Math.floor((g.position.y - FLOOR_Y) / STOREY + 0.02);
    const game = useGame.getState();
    const whole = roofVisible(game);
    g.visible = whole || storey <= game.floor;
    // and their name only shows on the floor you're looking at (not through the floor from downstairs)
    const half = Math.round((g.position.y - FLOOR_Y) / STOREY);
    if (tag.current) tag.current.style.visibility = whole || half === game.floor ? "" : "hidden";
    // my character going up or down the stairs takes the view with them, in Live mode
    if (mine && live && half !== myStorey.current) {
      myStorey.current = half;
      setFloor(half);
    }
    g.rotation.y = turnToward(g.rotation.y, yaw, snap ? 1 : 1 - Math.exp(-dt * 10));

    const u = avatar.use;
    const pose = poseFor(activity, posed ? u!.pose!.y : null, t, !posed, { since: t - (u?.startsAt ?? t), lead: Boolean(u?.lead) });
    if (activity === "pingpong" && avatar.use?.objectId) {
      const state = useGame.getState();
      const moment = state.life && pingPongMoment(state.life, avatar.use.objectId, t, new Set(state.members.filter((m) => m.online).map((m) => m.id)));
      if (moment?.visible) pose.arms[1] = -0.65 - (moment.swing[avatar.use.slot] ?? 0) * 0.6;
    }
    const j = 1 - Math.exp(-dt * 12);
    const b = body.current;
    b.position.y = ease(b.position.y, pose.hip, j);
    b.rotation.x = ease(b.rotation.x, -pose.lean, j);
    b.rotation.y = ease(b.rotation.y, pose.roll * roll + (pose.twist ?? 0), j);
    const limbs: [React.RefObject<THREE.Group | null>, number][] = [
      [armL, pose.arms[0]],
      [armR, pose.arms[1]],
      [thighL, pose.thighs[0]],
      [thighR, pose.thighs[1]],
      [kneeL, pose.knees[0]],
      [kneeR, pose.knees[1]],
    ];
    for (const [r, a] of limbs) if (r.current) r.current.rotation.x = ease(r.current.rotation.x, a, j);
    if (armL.current) armL.current.rotation.z = ease(armL.current.rotation.z, -pose.spread, j);
    if (armR.current) armR.current.rotation.z = ease(armR.current.rotation.z, pose.spread, j);
    if (gamepad.current) {
      gamepad.current.visible = activity === "play";
      gamepad.current.rotation.z = Math.sin(t * 0.004) * 0.025;
    }
    if (heldPaddle.current) heldPaddle.current.visible = activity === "pingpong";
    if (heldCard.current) heldCard.current.visible = activity === "blackjack";
    if (zzz.current) zzz.current.style.opacity = activity === "sleep" ? "1" : "0";
    if (ripple.current) {
      ripple.current.visible = activity === "swim";
      const r = (t / 900) % 1;
      ripple.current.scale.setScalar(0.6 + r * 0.9);
      (ripple.current.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - r);
    }
    // together: hearts (or notes, or a laugh) float up, and close up the name tags step aside so they don't pile up
    const glyph = GLYPH[activity];
    if (hearts.current) {
      hearts.current.style.display = glyph ? "" : "none";
      if (glyph && hearts.current.dataset.glyph !== glyph) {
        hearts.current.dataset.glyph = glyph;
        for (const span of hearts.current.children) span.textContent = glyph;
      }
    }
    if (tag.current) tag.current.dataset.close = CLOSE.has(activity) ? "1" : "";
    if (mine) {
      cameraFollow.target = { x: g.position.x, z: g.position.z, y: g.position.y - FLOOR_Y };
      g.updateMatrixWorld();
      eyeAt.copy(EYE);
      b.localToWorld(eyeAt);
      cameraFollow.eye = { x: eyeAt.x, y: eyeAt.y, z: eyeAt.z };
    }
  });

  // in Live mode, click your partner for what you can do together
  const clickable = live && !mine;
  const pick = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0 || cameraGestureActive() || !root.current) return;
    e.stopPropagation();
    const g = root.current.position;
    useGame.setState({ menu: { memberId: member.id, at: [g.x, g.y + 2.3, g.z] } });
  };

  return (
    <group ref={root} position={[avatar.path[0]![0], FLOOR_Y, avatar.path[0]![1]]} onPointerDown={clickable ? pick : undefined}>
      {clickable && (
        <mesh visible={false} position={[0, 0.9, 0]}>
          <cylinderGeometry args={[0.3, 0.3, 1.8, 8]} />
        </mesh>
      )}
      <mesh ref={ripple} visible={false} position={[0, 0.075, 0.2]} rotation-x={-Math.PI / 2} raycast={() => null}>
        <ringGeometry args={[0.42, 0.5, 32]} />
        <meshBasicMaterial color="#ffffff" transparent depthWrite={false} />
      </mesh>
      <group ref={body} position={[0, HIP, 0]} visible={!unseen}>
        <KitMesh make={(k) => torso(k, looks)} deps={[looks]} />
        <group ref={armL} position={[-SHOULDER, TORSO - 0.06, 0]}>
          <KitMesh make={(k) => arm(k, looks)} deps={[looks]} />
          <group ref={heldCard} visible={false} position={[0, -ARM + 0.02, 0.015]} rotation-x={0.5}>
            <KitMesh make={(k) => {
              k.box(pencilMaterial("#fff7e7"), [0, -0.055, 0], [0.105, 0.15, 0.006], { outline: 0.002 });
              k.box(pencilMaterial("#b7655a"), [0, -0.055, 0.004], [0.088, 0.13, 0.002], { outline: false });
            }} deps={[]} />
          </group>
        </group>
        <group ref={armR} position={[SHOULDER, TORSO - 0.06, 0]}>
          <KitMesh make={(k) => arm(k, looks)} deps={[looks]} />
          <group ref={heldPaddle} visible={false} position={[0, -ARM + 0.02, 0]} rotation-x={-Math.PI / 2}>
            <KitMesh make={(k) => paddle(k, (tone, finish, alpha) => pencilMaterial(tone, { finish, alpha }), [0, 0, -0.14], 0, "#b85248")} deps={[]} />
          </group>
        </group>
        <group ref={gamepad} visible={false} position={[0, 0.23, 0.405]} scale={1.45}>
          <KitMesh make={(k) => controller(k, (tone, finish, alpha) => pencilMaterial(tone, { finish, alpha }), [0, -0.05, 0], 0)} deps={[]} />
        </group>
        {([-1, 1] as const).map((sx) => (
          <group key={sx} ref={sx < 0 ? thighL : thighR} position={[sx * 0.09, 0, 0]}>
            <KitMesh make={(k) => thigh(k, looks, sx)} deps={[looks]} />
            <group ref={sx < 0 ? kneeL : kneeR} position={[0, -THIGH, 0]}>
              <KitMesh make={(k) => shin(k, looks)} deps={[looks]} />
            </group>
          </group>
        ))}
        {tagged && !unseen && (
          <Html position={[0, TORSO + 0.62, 0]} center distanceFactor={9} zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
            <div ref={tag} className={`pin-tag char-tag ${member.online ? "" : "away"}`} style={{ borderColor: member.color }}>
              <SpeechBubble memberId={member.id} />
              <div ref={hearts} className="hearts" style={{ display: "none" }}>
                <span>♥</span>
                <span>♥</span>
                <span>♥</span>
              </div>
              <span className="pin-dot" style={{ background: member.color }} />
              {live && member.online && <NeedThought avatar={avatar} />}
              {mine ? "You" : member.name}
              {!member.online && <span className="pin-tool"> · away</span>}
              <span ref={zzz} className="zzz">
                z z
              </span>
            </div>
          </Html>
        )}
      </group>
    </group>
  );
}

/** Everyone who's been in the house, where they are now. */
export function Characters() {
  const life = useGame((s) => s.life);
  const members = useGame((s) => s.members);
  const me = useGame((s) => s.me);
  if (!life) return null;
  return (
    <>
      {Object.values(life.avatars).map((a) => {
        const m = members.find((x) => x.id === a.memberId);
        const partner = Object.values(life.avatars).find((o) => o.memberId !== a.memberId) ?? null;
        return m ? <Character key={a.memberId} avatar={a} partner={partner} member={m} mine={a.memberId === me} /> : null;
      })}
    </>
  );
}
