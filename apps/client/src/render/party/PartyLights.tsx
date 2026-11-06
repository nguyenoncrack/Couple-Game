import { DEFAULT_LIGHTS, STOREY } from "@cg/shared";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { serverNow, useGame } from "../../state/game";
import { FLOOR_Y } from "../House";
import { Kit } from "../kit";
import { Meshes } from "../KitMesh";
import { pencilMaterial, type Finish } from "../pencil";
import { topShown } from "../Storeys";
import { ballSpots, collectFixtures, headBeams, HEAD_AT, HEAD_Y, laserBeams, MAX_FIXTURES, RoomRays, BALL_Y, type Beam, type Fixture } from "./partyLayout";
import { glowMaterial, mirrorBallMaterial, paletteAt, partyTime, partyUniforms, steadyFor, stepParty } from "./partyMaterials";
import { headBody, headYoke } from "./partyModels";

/**
 * The party's moving light, drawn live: laser fans, moving-head beams with their pools of light, the mirror ball
 * and its spots. It's all additive glow (no real lights, no shadows), each kind of thing one instanced mesh, and the
 * counts are capped, so a big party costs a few draw calls. Everything follows the server clock and stays inside
 * its room. It also steps the shared shader clock that the dance floor and LED strips read.
 */

const BEAMS = 96;
const POOLS = 128;
const up = new THREE.Vector3(0, 1, 0);

/** A unit tube from y = 0 to 1, for a laser beam. */
const tube = new THREE.CylinderGeometry(0.5, 0.5, 1, 6, 1, true).translate(0, 0.5, 0);
/** A unit cone, narrow at y = 0 (the lens) and opening to y = 1, for a moving head's light. */
const cone = new THREE.CylinderGeometry(0.5, 0.012, 1, 20, 1, true).translate(0, 0.5, 0);
const disc = new THREE.CircleGeometry(0.5, 24).rotateX(-Math.PI / 2);

function glowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, "rgba(255,255,255,1)");
  r.addColorStop(0.45, "rgba(255,255,255,0.45)");
  r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const additive = (opts: THREE.MeshBasicMaterialParameters) =>
  new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false, ...opts });

const m = (tone: string, finish?: Finish, alpha?: number) => pencilMaterial(tone, { finish, alpha });

/** One fixture's drawn heads, kept so the frame loop can aim them. */
interface Rig {
  pan: THREE.Group | null;
  tilt: THREE.Group | null;
}

export function PartyLights() {
  const view = useGame((s) => s.view);
  const top = useGame(topShown);
  const fixtures = useMemo(() => (view ? collectFixtures(view) : []), [view]);
  const rays = useMemo(() => new Map(fixtures.map((f) => [f.id, new RoomRays(view!.levels[f.level], view!.lot, f.x, f.z, undefined, f.level > 0)])), [fixtures, view]);
  const heads = useMemo(() => fixtures.filter((f) => f.kind === "movinghead").slice(0, MAX_FIXTURES.movinghead), [fixtures]);
  const balls = useMemo(() => fixtures.filter((f) => f.kind === "discoball").slice(0, MAX_FIXTURES.discoball), [fixtures]);

  const tubes = useRef<THREE.InstancedMesh>(null);
  const cones = useRef<THREE.InstancedMesh>(null);
  const pools = useRef<THREE.InstancedMesh>(null);
  const rigs = useRef(new Map<string, Rig>());
  const headGroups = useRef(new Map<string, THREE.Group>());
  const ballMeshes = useRef(new Map<string, THREE.Group>());
  const materials = useMemo(() => {
    const tex = glowTexture();
    return { beam: additive({ opacity: 0.55, side: THREE.DoubleSide }), cone: additive({ opacity: 0.16, side: THREE.DoubleSide }), pool: additive({ opacity: 0.5, map: tex }), tex };
  }, []);
  const parts = useMemo(() => {
    const yoke = new Kit();
    headYoke(yoke, m, "#2b2b33");
    const body = new Kit();
    headBody(body, m, glowMaterial, "#2b2b33", 0);
    return { yoke: yoke.build(), body: body.build() };
  }, []);
  const fixtureLevel = useMemo(() => new Map(fixtures.map((f) => [f.id, f.level])), [fixtures]);
  const ballGeometry = useMemo(() => new THREE.SphereGeometry(0.21, 24, 16), []);

  useEffect(
    () => () => {
      materials.beam.dispose();
      materials.cone.dispose();
      materials.pool.dispose();
      materials.tex.dispose();
      ballGeometry.dispose();
      for (const b of [...parts.yoke, ...parts.body]) b.geometry.dispose();
    },
    [materials, ballGeometry, parts],
  );

  const tmp = useMemo(() => ({ c: new THREE.Color(), q: new THREE.Quaternion(), p: new THREE.Vector3(), s: new THREE.Vector3(), d: new THREE.Vector3(), mat: new THREE.Matrix4() }), []);

  useFrame((_, dt) => {
    const state = useGame.getState();
    const party = state.life?.party;
    const lights = party?.lights ?? DEFAULT_LIGHTS;
    const now = serverNow();
    stepParty(lights, party?.music, now, Math.min(dt, 0.1), state.view ? [state.view.lot.w / 2, state.view.lot.d / 2] : undefined);
    const level = partyUniforms.uLevel.value;
    const T = tubes.current;
    const C = cones.current;
    const P = pools.current;
    if (!T || !C || !P) return;
    const live = lights.on && level > 0.02;
    for (const [id, g] of headGroups.current) g.visible = live && (fixtureLevel.get(id) ?? 0) <= top;
    for (const [id, g] of ballMeshes.current) g.visible = live && (fixtureLevel.get(id) ?? 0) <= top;
    if (!live) {
      T.count = C.count = P.count = 0;
      return;
    }
    const t = partyTime(now);
    const steady = steadyFor(lights);
    let nt = 0;
    let nc = 0;
    let np = 0;
    const { c, q, p, s: sc, d, mat } = tmp;

    /** Stretch an instance of a unit tube or cone from one point to another. */
    const place = (mesh: THREE.InstancedMesh, i: number, b: Beam, floor: number, radius: (len: number) => number) => {
      p.set(b.from[0], floor + b.from[1], b.from[2]);
      d.set(b.to[0] - b.from[0], b.to[1] - b.from[1], b.to[2] - b.from[2]);
      const len = d.length();
      if (len < 0.01) return false;
      q.setFromUnitVectors(up, d.divideScalar(len));
      const r = radius(len);
      sc.set(r, len, r);
      mesh.setMatrixAt(i, mat.compose(p, q, sc));
      mesh.setColorAt(i, paletteAt(b.hue, c).multiplyScalar(level * b.glow));
      return true;
    };
    const pool = (x: number, z: number, floor: number, size: number, hue: number, glow: number) => {
      if (np >= POOLS) return;
      p.set(x, floor + 0.012, z);
      q.identity();
      sc.set(size, 1, size);
      P.setMatrixAt(np, mat.compose(p, q, sc));
      P.setColorAt(np, paletteAt(hue, c).multiplyScalar(level * glow));
      np++;
    };

    const counts = { laser: 0, movinghead: 0, discoball: 0 };
    for (const f of fixtures) {
      if (f.level > top || counts[f.kind]++ >= MAX_FIXTURES[f.kind]) continue;
      const floor = f.level * STOREY + FLOOR_Y;
      const ray = rays.get(f.id)!;
      if (f.kind === "laser") {
        for (const b of laserBeams(f, ray, t, steady, lights.spread)) {
          if (nt < BEAMS && place(T, nt, b, floor, () => 0.02)) nt++;
        }
      } else if (f.kind === "movinghead") {
        const beams = headBeams(f, ray, t, steady, lights.spread);
        beams.forEach((b, i) => {
          if (nc < BEAMS && place(C, nc, b, floor, (len) => len * 0.15)) nc++;
          pool(b.to[0], b.to[2], floor, 0.15 * Math.hypot(b.to[0] - b.from[0], b.to[1] - b.from[1], b.to[2] - b.from[2]) + 0.2, b.hue, 0.9);
          const rig = rigs.current.get(`${f.id}:${i}`);
          if (rig?.pan && rig.tilt) {
            const dx = b.to[0] - b.from[0];
            const dz = b.to[2] - b.from[2];
            rig.pan.rotation.y = Math.atan2(dx, dz) - f.yaw;
            rig.tilt.rotation.x = Math.atan2(b.from[1] - b.to[1], Math.hypot(dx, dz));
          }
        });
      } else {
        for (const sp of ballSpots(f, ray, t, steady)) pool(sp.x, sp.z, floor, sp.size * 2, sp.hue, 0.8);
        const g = ballMeshes.current.get(f.id);
        if (g) g.rotation.y = steady ? 0 : t * 0.3;
      }
    }
    T.count = nt;
    C.count = nc;
    P.count = np;
    for (const mesh of [T, C, P]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  });

  if (!view) return null;
  return (
    <>
      <instancedMesh ref={tubes} args={[tube, materials.beam, BEAMS]} frustumCulled={false} raycast={() => null} />
      <instancedMesh ref={cones} args={[cone, materials.cone, BEAMS]} frustumCulled={false} raycast={() => null} renderOrder={2} />
      <instancedMesh ref={pools} args={[disc, materials.pool, POOLS]} frustumCulled={false} raycast={() => null} renderOrder={1} />
      {heads.map((f) => (
        <group key={f.id} position={[f.x, f.level * STOREY + FLOOR_Y, f.z]} rotation-y={f.yaw} visible={false} ref={(g) => void (g ? headGroups.current.set(f.id, g) : headGroups.current.delete(f.id))}>
          {HEAD_AT.map(([x, z], i) => (
            <group key={i} position={[x, HEAD_Y + 0.08, z]}>
              <group
                ref={(g) => {
                  const rig = rigs.current.get(`${f.id}:${i}`) ?? { pan: null, tilt: null };
                  rig.pan = g;
                  if (g) rigs.current.set(`${f.id}:${i}`, rig);
                  else rigs.current.delete(`${f.id}:${i}`);
                }}
              >
                <Meshes meshes={parts.yoke} raycast={false} />
                <group
                  ref={(g) => {
                    const rig = rigs.current.get(`${f.id}:${i}`) ?? { pan: null, tilt: null };
                    rig.tilt = g;
                    rigs.current.set(`${f.id}:${i}`, rig);
                  }}
                >
                  <Meshes meshes={parts.body} raycast={false} />
                </group>
              </group>
            </group>
          ))}
        </group>
      ))}
      {balls.map((f) => (
        <group key={f.id} position={[f.x, f.level * STOREY + FLOOR_Y + BALL_Y, f.z]} visible={false} ref={(g) => void (g ? ballMeshes.current.set(f.id, g) : ballMeshes.current.delete(f.id))}>
          <mesh geometry={ballGeometry} material={mirrorBallMaterial(f.tint)} raycast={() => null} />
        </group>
      ))}
    </>
  );
}
