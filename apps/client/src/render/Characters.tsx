import { activityAt, positionAt, type Avatar, type MemberInfo } from "@cg/shared";
import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import type * as THREE from "three";
import { serverNow, useGame } from "../state/game";
import { cameraFollow } from "./CameraRig";
import { FLOOR_Y } from "./House";
import type { Kit } from "./kit";
import { KitMesh } from "./KitMesh";
import { shade } from "./models";
import { pencilMaterial } from "./pencil";

/**
 * The two of you, drawn in pencil like the furniture. Each character is a few jointed parts (body, arms, thighs,
 * shins) so they can walk, sit, lie down and cook. Where they are comes from the server's life state: a path and
 * the time they set off, so both screens work out the same position every frame without more messages.
 */

const SKIN = ["#f1d2b6", "#e2b48f", "#c68d63", "#9a6644", "#6e4630"];
const HAIR = ["#3b2b22", "#6b4630", "#b9874f", "#2a2522", "#8a3f2a", "#d8c28e"];
type HairStyle = "short" | "bun" | "long" | "curly";
const STYLES: HairStyle[] = ["short", "bun", "long", "curly"];

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Looks picked from the member ID, so each person always looks the same on both screens. */
function looksFor(id: string, color: string) {
  const h = hash(id);
  return {
    skin: SKIN[h % SKIN.length]!,
    hair: HAIR[(h >>> 4) % HAIR.length]!,
    style: STYLES[(h >>> 8) % STYLES.length]!,
    sweater: color,
    trousers: ["#4d5866", "#5e5246", "#3f4a3c"][(h >>> 12) % 3]!,
  };
}

/** Body measurements in metres. */
const HIP = 0.8;
const THIGH = 0.4;
const SHIN = 0.38;
const TORSO = 0.56;
const ARM = 0.52;
const SHOULDER = 0.19;

type Looks = ReturnType<typeof looksFor>;

function torso(k: Kit, l: Looks) {
  const sweater = pencilMaterial(l.sweater, { finish: "fabric" });
  const cuff = pencilMaterial(shade(l.sweater, 0.82), { finish: "fabric" });
  const skin = pencilMaterial(l.skin);
  const hair = pencilMaterial(l.hair, { finish: "fabric" });
  const ink = pencilMaterial("#3a3631");
  // hips and sweater
  k.add("soft", pencilMaterial(l.trousers, { finish: "fabric" }), [0, 0.02, 0], [0.34, 0.16, 0.22]);
  k.add("soft", sweater, [0, TORSO / 2 + 0.02, 0], [0.38, TORSO, 0.24]);
  k.add("cyl", cuff, [0, 0.09, 0], [0.37, 0.07, 0.23], { outline: 0.006 });
  // neck and head
  k.add("cyl", skin, [0, TORSO + 0.06, 0], [0.09, 0.1, 0.09], {
    outline: false,
  });
  const hy = TORSO + 0.22;
  k.add("sphere", skin, [0, hy, 0], [0.26, 0.28, 0.25]);
  for (const sx of [-1, 1])
    k.add("sphere", ink, [sx * 0.055, hy + 0.01, 0.118], 0.026, {
      outline: false,
    });
  k.add("sphere", pencilMaterial(shade(l.skin, 0.85)), [0, hy - 0.035, 0.125], [0.04, 0.03, 0.03], { outline: false });
  // hair
  k.add("half", hair, [0, hy + 0.02, -0.01], [0.285, 0.26, 0.275]);
  if (l.style === "bun") k.add("sphere", hair, [0, hy + 0.13, -0.09], 0.12);
  if (l.style === "long") k.add("soft", hair, [0, hy - 0.1, -0.08], [0.27, 0.3, 0.1]);
  if (l.style === "curly")
    for (let i = 0; i < 7; i++) k.add("sphere", hair, [Math.cos(i * 0.9) * 0.12, hy + 0.08 + (i % 2) * 0.04, Math.sin(i * 0.9) * 0.1 - 0.02], 0.1);
  if (l.style === "short")
    k.add("soft", hair, [0, hy + 0.08, 0.06], [0.24, 0.07, 0.12], {
      rot: [0.3, 0, 0],
    });
}

function arm(k: Kit, l: Looks) {
  k.add("soft", pencilMaterial(l.sweater, { finish: "fabric" }), [0, -ARM / 2 + 0.04, 0], [0.11, ARM - 0.06, 0.11]);
  k.add("sphere", pencilMaterial(l.skin), [0, -ARM + 0.02, 0], 0.085);
}

function thigh(k: Kit, l: Looks) {
  k.add("soft", pencilMaterial(l.trousers, { finish: "fabric" }), [0, -THIGH / 2, 0], [0.14, THIGH + 0.04, 0.15]);
}

function shin(k: Kit, l: Looks) {
  k.add("soft", pencilMaterial(l.trousers, { finish: "fabric" }), [0, -SHIN / 2 + 0.02, 0], [0.12, SHIN, 0.13]);
  k.add("soft", pencilMaterial("#3d3833", { finish: "stone" }), [0, -SHIN + 0.03, 0.05], [0.13, 0.08, 0.24]);
}

/** Joint angles (radians, about x; negative swings forward) and how the whole body sits. */
interface Pose {
  /** Height of the hips, and how far the body leans back (lying down is π/2). */
  hip: number;
  lean: number;
  thighs: [number, number];
  knees: [number, number];
  arms: [number, number];
  /** Arms out to the sides a little. */
  spread: number;
}

const ease = (from: number, to: number, k: number) => from + (to - from) * k;

function poseFor(activity: string, seatY: number | null, t: number, standingTarget: boolean): Pose {
  const s = t / 1000;
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
        };
      return {
        hip: (seatY ?? 0.45) + 0.05,
        lean: -0.05,
        thighs: [-1.5, -1.5],
        knees: [1.5, 1.5],
        arms: [-0.9, -1.1 - bite * 1.2],
        spread: 0.1,
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
      };
    case "lounge":
      return {
        hip: (seatY ?? 0.36) + 0.12,
        lean: 1.0,
        thighs: [-0.62, -0.5],
        knees: [0.15, 0.05],
        arms: [-0.2, -2.6],
        spread: 0.25,
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
      };
    }
  }
}

/** Shortest way round from one angle to another. */
function turnToward(from: number, to: number, k: number) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return from + d * k;
}

function Character({ avatar, member, mine }: { avatar: Avatar; member: MemberInfo; mine: boolean }) {
  const looks = useMemo(() => looksFor(member.id, member.color), [member.id, member.color]);
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const thighL = useRef<THREE.Group>(null);
  const thighR = useRef<THREE.Group>(null);
  const kneeL = useRef<THREE.Group>(null);
  const kneeR = useRef<THREE.Group>(null);
  const zzz = useRef<HTMLDivElement>(null);
  const first = useRef(true);
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
    const tx = posed ? avatar.use!.pose!.x : p.x;
    const tz = posed ? avatar.use!.pose!.z : p.z;
    const face = posed ? avatar.use!.pose!.face : avatar.face;
    const yaw = p.heading ?? (-face * Math.PI) / 2;
    const snap = first.current;
    first.current = false;
    const k = snap ? 1 : 1 - Math.exp(-dt * 14);
    g.position.x = ease(g.position.x, tx, k);
    g.position.z = ease(g.position.z, tz, k);
    g.rotation.y = turnToward(g.rotation.y, yaw, snap ? 1 : 1 - Math.exp(-dt * 10));

    const pose = poseFor(activity, posed ? avatar.use!.pose!.y : null, t, !posed);
    const j = 1 - Math.exp(-dt * 12);
    const b = body.current;
    b.position.y = ease(b.position.y, pose.hip, j);
    b.rotation.x = ease(b.rotation.x, -pose.lean, j);
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
    if (zzz.current) zzz.current.style.opacity = activity === "sleep" ? "1" : "0";
    if (mine) cameraFollow.target = { x: g.position.x, z: g.position.z };
  });

  return (
    <group ref={root} position={[avatar.path[0]![0], FLOOR_Y, avatar.path[0]![1]]}>
      <group ref={body} position={[0, HIP, 0]}>
        <KitMesh make={(k) => torso(k, looks)} deps={[looks]} />
        <group ref={armL} position={[-SHOULDER, TORSO - 0.06, 0]}>
          <KitMesh make={(k) => arm(k, looks)} deps={[looks]} />
        </group>
        <group ref={armR} position={[SHOULDER, TORSO - 0.06, 0]}>
          <KitMesh make={(k) => arm(k, looks)} deps={[looks]} />
        </group>
        {([-1, 1] as const).map((sx) => (
          <group key={sx} ref={sx < 0 ? thighL : thighR} position={[sx * 0.09, 0, 0]}>
            <KitMesh make={(k) => thigh(k, looks)} deps={[looks]} />
            <group ref={sx < 0 ? kneeL : kneeR} position={[0, -THIGH, 0]}>
              <KitMesh make={(k) => shin(k, looks)} deps={[looks]} />
            </group>
          </group>
        ))}
        {tagged && (
          <Html position={[0, TORSO + 0.62, 0]} center distanceFactor={9} zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
            <div className={`pin-tag char-tag ${member.online ? "" : "away"}`} style={{ borderColor: member.color }}>
              <span className="pin-dot" style={{ background: member.color }} />
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
        return m ? <Character key={a.memberId} avatar={a} member={m} mine={a.memberId === me} /> : null;
      })}
    </>
  );
}
