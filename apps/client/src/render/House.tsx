import { catalog, cellKey, footprintOf, parseCell, parseEdge, positionAt, type Level, type OpeningItem, type PlacedObject, type PlacedOpening } from "@cg/shared";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { serverNow, useGame } from "../state/game";
import type { Kit } from "./kit";
import { KitMesh, Meshes } from "./KitMesh";
import { doorParts, modelFor, openingModelFor, shade, type DoorLeaf } from "./models";
import { pencilMaterial, shadowMaterial } from "./pencil";

export const WALL_H = 2.7;
export const WALL_DOWN_H = 0.32;
export const WALL_T = 0.14;
export const FLOOR_Y = 0.04;

export interface Run {
  dir: "h" | "v";
  /** Fixed coordinate (z for h, x for v) and the span along the other axis. */
  at: number;
  from: number;
  to: number;
  style: string;
}

/** Where a door or window cuts a wall: its span along the run, and the open height. */
export interface Gap {
  from: number;
  to: number;
  sill: number;
  top: number;
}

/** Merge unit wall edges into straight runs of the same style, so a long wall is one box with one outline. */
export function wallRuns(walls: Level["walls"]): Run[] {
  const groups = new Map<string, number[]>();
  for (const [key, w] of Object.entries(walls)) {
    const e = parseEdge(key);
    if (!e) continue;
    const g = `${e.dir}|${e.dir === "h" ? e.z : e.x}|${w.style}`;
    const list = groups.get(g) ?? [];
    list.push(e.dir === "h" ? e.x : e.z);
    groups.set(g, list);
  }
  const runs: Run[] = [];
  for (const [g, list] of groups) {
    const [dir, at, style] = g.split("|") as ["h" | "v", string, string];
    list.sort((a, b) => a - b);
    let start = list[0]!;
    let prev = start;
    for (const v of [...list.slice(1), Infinity]) {
      if (v !== prev + 1) {
        runs.push({ dir, at: Number(at), from: start, to: prev + 1, style });
        start = v;
      }
      prev = v;
    }
  }
  return runs;
}

/** Span of an opening along its wall line. */
function openingSpan(o: PlacedOpening, item: OpeningItem) {
  const a = o.dir === "h" ? o.x : o.z;
  return { at: o.dir === "h" ? o.z : o.x, from: a, to: a + item.width };
}

/** Every opening touching this run must cut a gap, even across a change in wall finish. */
export function openingsInRun(run: Run, openings: Level["openings"]) {
  const out: { o: PlacedOpening; item: OpeningItem }[] = [];
  for (const o of Object.values(openings)) {
    const item = catalog.openings.get(o.catalogId);
    if (!item || o.dir !== run.dir) continue;
    const s = openingSpan(o, item);
    if (s.at === run.at && s.from < run.to && s.to > run.from) out.push({ o, item });
  }
  return out;
}

/** Cut all overlapping wall sections, but draw each opening model in exactly one section. */
export function wallGroups(level: Pick<Level, "walls" | "openings">) {
  return wallRuns(level.walls).map((run) => {
    const openings = openingsInRun(run, level.openings);
    const models = openings.filter(({ o, item }) => {
      const span = openingSpan(o, item);
      const mid = (span.from + span.to) / 2;
      // Half-open bounds assign a centre on a finish seam to just one run.
      return mid >= run.from && mid < run.to;
    });
    return { run, openings, models };
  });
}

/**
 * Add one straight wall (with baseboards and a top cap) to a kit, leaving holes for doors and windows. Also used
 * for the build previews.
 */
export function addWall(k: Kit, run: Run, height: number, mat: THREE.Material, trim: THREE.Material, gaps: Gap[] = []) {
  const place = (a: number, b: number, y0: number, y1: number) => {
    if (b - a < 1e-3 || y1 - y0 < 1e-3) return;
    const mid = (a + b) / 2;
    const [x, z] = run.dir === "h" ? [mid, run.at] : [run.at, mid];
    const size = (l: number, h: number, t: number): [number, number, number] => (run.dir === "h" ? [l, h, t] : [t, h, l]);
    const len = b - a;
    k.box(mat, [x, (y0 + y1) / 2, z], size(len, y1 - y0, WALL_T), { outline: 0.024 });
    if (y0 === 0) k.box(trim, [x, 0.06, z], size(len + 0.02, 0.12, WALL_T + 0.035), { outline: 0.008 });
    if (y1 === height) k.box(trim, [x, height + 0.015, z], size(len + 0.02, 0.03, WALL_T + 0.03), { outline: 0.008 });
  };
  // Solid wall between the gaps; the ends reach half a wall's thickness further so corners close.
  const sorted = gaps.map((g) => ({ ...g, from: Math.max(g.from, run.from), to: Math.min(g.to, run.to) })).sort((a, b) => a.from - b.from);
  let cursor = run.from - WALL_T / 2;
  for (const g of sorted) {
    place(cursor, g.from === run.from ? g.from - WALL_T / 2 : g.from, 0, height);
    if (g.sill > 0) place(g.from, g.to, 0, Math.min(g.sill, height));
    if (g.top < height) place(g.from, g.to, g.top, height);
    cursor = g.to === run.to ? g.to + WALL_T / 2 : g.to;
  }
  place(cursor, run.to + WALL_T / 2, 0, height);
}

/** Where a door or window model sits: centred in its wall, turned to face its front. */
export function openingTransform(o: Pick<PlacedOpening, "dir" | "x" | "z" | "flip">, item: OpeningItem) {
  const half = item.width / 2;
  const position: [number, number, number] = o.dir === "h" ? [o.x + half, 0, o.z] : [o.x, 0, o.z + half];
  return { position, rotationY: (o.dir === "h" ? 0 : -Math.PI / 2) + (o.flip ? Math.PI : 0) };
}

export type WallMode = "up" | "cut" | "down";

/**
 * Should this wall be cut down? In cutaway mode walls between the camera and the middle of the view drop to a
 * stub, so you can see into rooms; walls behind it stay up. Walls side-on to the view only drop once they're
 * well in front, so rooms keep their side walls.
 */
function isCut(run: Run, cam: THREE.Vector3, target: THREE.Vector3) {
  let vx = cam.x - target.x;
  let vz = cam.z - target.z;
  const len = Math.hypot(vx, vz) || 1;
  vx /= len;
  vz /= len;
  const mid = (run.from + run.to) / 2;
  const [cx, cz] = run.dir === "h" ? [mid, run.at] : [run.at, mid];
  const ahead = (cx - target.x) * vx + (cz - target.z) * vz;
  const facing = Math.abs(run.dir === "h" ? vz : vx);
  return facing > 0.4 ? ahead > -0.3 : ahead > 2;
}

const ray = new THREE.Vector3();
const lookTarget = new THREE.Vector3();

export function Walls({
  level,
  hiddenOpening,
  onOpeningDown,
}: {
  level: Level;
  /** A door or window I'm dragging (drawn as a ghost instead). */
  hiddenOpening: string | null;
  onOpeningDown: (id: string, e: ThreeEvent<PointerEvent>) => void;
}) {
  // walls stand at full height when you're inside looking around
  const mode = useGame((s) => (s.mode === "live" && s.firstPerson ? "up" : s.wallMode));
  const groups = useMemo(() => wallGroups(level), [level.walls, level.openings]);
  const full = useRef<(THREE.Group | null)[]>([]);
  const low = useRef<(THREE.Group | null)[]>([]);

  useFrame(({ camera }) => {
    if (mode !== "cut") {
      // out of the cutaway (walls up, or first person): put back any walls it had lowered
      for (const g of full.current) if (g && !g.visible) g.visible = true;
      return;
    }
    // The middle of the view: where the camera's line of sight meets the floor.
    camera.getWorldDirection(ray);
    const t = ray.y < -0.05 ? -camera.position.y / ray.y : 12;
    lookTarget.copy(camera.position).addScaledVector(ray, t);
    for (let i = 0; i < groups.length; i++) {
      const cut = isCut(groups[i]!.run, camera.position, lookTarget);
      if (full.current[i]) full.current[i]!.visible = !cut;
      if (low.current[i]) low.current[i]!.visible = cut;
    }
  });

  return (
    <>
      {groups.map(({ run, openings, models }, i) => {
        const key = `${run.dir}|${run.at}|${run.from}|${run.style}`;
        return (
          <group key={key}>
            {mode !== "down" && (
              <group ref={(g) => void (full.current[i] = g)}>
                <WallRun run={run} openings={openings} height={WALL_H} />
                {models.map(({ o, item }) => o.id !== hiddenOpening && <OpeningModel key={o.id} o={o} item={item} low={null} onDown={onOpeningDown} />)}
              </group>
            )}
            {mode !== "up" && (
              <group ref={(g) => void (low.current[i] = g)} visible={mode === "down"}>
                <WallRun run={run} openings={openings} height={WALL_DOWN_H} />
                {models.map(({ o, item }) => o.id !== hiddenOpening && <OpeningModel key={o.id} o={o} item={item} low={WALL_DOWN_H} onDown={onOpeningDown} />)}
              </group>
            )}
          </group>
        );
      })}
    </>
  );
}

const TRIM = "#f7f2e8";

function WallRun({ run, openings, height }: { run: Run; openings: { o: PlacedOpening; item: OpeningItem }[]; height: number }) {
  const gapsKey = openings.map(({ o, item }) => `${o.id}:${o.x}:${o.z}:${item.id}`).join(",");
  return (
    <KitMesh
      deps={[run.dir, run.at, run.from, run.to, run.style, height, gapsKey]}
      make={(k) => {
        const style = catalog.wallStyles.get(run.style);
        const gaps = openings.map(({ o, item }) => ({ ...openingSpan(o, item), sill: item.sill, top: item.top }));
        addWall(k, run, height, pencilMaterial(style?.color ?? "#f6eddc", { finish: style?.finish, rim: false }), pencilMaterial(TRIM), gaps);
      }}
    />
  );
}

function OpeningModel({ o, item, low, onDown }: { o: PlacedOpening; item: OpeningItem; low: number | null; onDown: (id: string, e: ThreeEvent<PointerEvent>) => void }) {
  const { position, rotationY } = openingTransform(o, item);
  return (
    <group
      position={position}
      rotation-y={rotationY}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        onDown(o.id, e);
      }}
    >
      {low === null && doorParts(item) ? <Door item={item} transform={{ position, rotationY }} /> : <Meshes meshes={openingModelFor(item, null, low)} />}
    </group>
  );
}

/** How far a door swings open, how near someone has to be for it to, and how quickly it moves. */
const DOOR_OPEN = 1.45;
const DOOR_NEAR = 1.15;
const DOOR_SPEED = 7;

/**
 * A door that's shut until someone comes up to it, then swings open away from them and shuts again behind them.
 * Both screens work this out from where the characters are, so they see the same thing.
 */
function Door({ item, transform }: { item: OpeningItem; transform: { position: [number, number, number]; rotationY: number } }) {
  const parts = doorParts(item)!;
  const hinges = useRef<(THREE.Group | null)[]>([]);
  const swing = useRef({ angle: 0, side: 1 });
  useFrame((_, dt) => {
    const life = useGame.getState().life;
    const [ox, , oz] = transform.position;
    const c = Math.cos(transform.rotationY);
    const s = Math.sin(transform.rotationY);
    // the nearest person, in the door's own frame (x along the wall, z out through it)
    let near: number | null = null;
    if (life) {
      const t = serverNow();
      for (const a of Object.values(life.avatars)) {
        const p = positionAt(a, t);
        const dx = p.x - ox;
        const dz = p.z - oz;
        const lx = dx * c - dz * s;
        const lz = dx * s + dz * c;
        if (Math.abs(lx) <= item.width / 2 + 0.35 && Math.abs(lz) <= DOOR_NEAR && (near === null || Math.abs(lz) < Math.abs(near))) near = lz;
      }
    }
    const w = swing.current;
    // pick the way to swing as it starts to open, then keep it until it's shut again
    if (near !== null && Math.abs(w.angle) < 0.05) w.side = near >= 0 ? 1 : -1;
    const target = near === null ? 0 : DOOR_OPEN * w.side;
    w.angle += (target - w.angle) * (1 - Math.exp(-dt * DOOR_SPEED));
    parts.leaves.forEach((l, i) => {
      const g = hinges.current[i];
      if (g) g.rotation.y = (l.mirror ? -1 : 1) * w.angle;
    });
  });
  return (
    <>
      <Meshes meshes={parts.frame} />
      {parts.leaves.map((l: DoorLeaf, i) => (
        <group key={i} ref={(g) => void (hinges.current[i] = g)} position={[l.hingeX, 0, -0.03]}>
          <Meshes meshes={l.meshes} />
        </group>
      ))}
    </>
  );
}

export function Floors({ tiles }: { tiles: Level["tiles"] }) {
  return (
    <KitMesh
      deps={[tiles]}
      make={(k) => {
        const edgeMat = new Map<string, THREE.Material>();
        for (const [key, t] of Object.entries(tiles)) {
          const c = parseCell(key);
          const mat = catalog.floorMaterials.get(t.material);
          if (!c || !mat) continue;
          k.box(pencilMaterial(mat.color, { finish: mat.finish, rim: false }), [c.x + 0.5, FLOOR_Y / 2, c.z + 0.5], [1, FLOOR_Y, 1], { outline: false });
          // a darker lip where the floor ends, so a room's shape reads from above
          if (!edgeMat.has(t.material)) edgeMat.set(t.material, pencilMaterial(shade(mat.color, 0.72)));
          const lip = edgeMat.get(t.material)!;
          const sides: [number, number, [number, number, number], [number, number, number]][] = [
            [0, -1, [c.x + 0.5, FLOOR_Y / 2, c.z + 0.015], [1, FLOOR_Y + 0.004, 0.03]],
            [0, 1, [c.x + 0.5, FLOOR_Y / 2, c.z + 0.985], [1, FLOOR_Y + 0.004, 0.03]],
            [-1, 0, [c.x + 0.015, FLOOR_Y / 2, c.z + 0.5], [0.03, FLOOR_Y + 0.004, 1]],
            [1, 0, [c.x + 0.985, FLOOR_Y / 2, c.z + 0.5], [0.03, FLOOR_Y + 0.004, 1]],
          ];
          for (const [dx, dz, pos, size] of sides) if (!tiles[cellKey(c.x + dx, c.z + dz)]) k.box(lip, pos, size, { outline: false });
        }
      }}
    />
  );
}

const shadowPlane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

/** Where an object's model sits: the footprint centre, turned by its rotation. */
export function objectTransform(o: Pick<PlacedObject, "catalogId" | "x" | "z" | "rot">) {
  const item = catalog.furniture.get(o.catalogId)!;
  const f = footprintOf(item, o);
  return { item, f, position: [f.x + f.w / 2, FLOOR_Y, f.z + f.d / 2] as [number, number, number], rotationY: (-o.rot * Math.PI) / 2 };
}

export function Furniture({
  objects,
  hidden,
  onObjectDown,
}: {
  objects: Level["objects"];
  /** Objects being dragged by me (drawn as a ghost instead). */
  hidden: string | null;
  onObjectDown: (id: string, e: ThreeEvent<PointerEvent>) => void;
}) {
  return (
    <>
      {Object.values(objects).map((o) =>
        o.id === hidden || !catalog.furniture.has(o.catalogId) ? null : <Placed key={o.id} o={o} onDown={onObjectDown} />,
      )}
    </>
  );
}

function Placed({ o, onDown }: { o: PlacedObject; onDown: (id: string, e: ThreeEvent<PointerEvent>) => void }) {
  const { item, f, position, rotationY } = objectTransform(o);
  const meshes = modelFor(item);
  const shadow = useMemo(() => shadowMaterial(f.w + 0.1, f.d + 0.1, 0.32), [f.w, f.d]);
  return (
    <group>
      {item.layer === "floor" && <mesh geometry={shadowPlane} material={shadow} position={[position[0], FLOOR_Y + 0.005, position[2]]} scale={[f.w + 0.1, 1, f.d + 0.1]} raycast={() => null} />}
      <group
        position={position}
        rotation-y={rotationY}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          onDown(o.id, e);
        }}
      >
        <Meshes meshes={meshes} />
      </group>
    </group>
  );
}

/** A coloured rectangle drawn on the floor around a footprint (selection, partner's hold, placement check). */
export function FootprintMarker({ x, z, w, d, color, opacity = 0.9 }: { x: number; z: number; w: number; d: number; color: string; opacity?: number }) {
  const t = 0.06;
  const y = FLOOR_Y + 0.02;
  return (
    <group raycast={() => null}>
      {[
        [x + w / 2, z + t / 2, w, t],
        [x + w / 2, z + d - t / 2, w, t],
        [x + t / 2, z + d / 2, t, d],
        [x + w - t / 2, z + d / 2, t, d],
      ].map(([cx, cz, sw, sd], i) => (
        <mesh key={i} position={[cx!, y, cz!]} raycast={() => null}>
          <boxGeometry args={[sw!, 0.01, sd!]} />
          <meshBasicMaterial color={color} transparent opacity={opacity} />
        </mesh>
      ))}
      <mesh position={[x + w / 2, y - 0.005, z + d / 2]} raycast={() => null}>
        <boxGeometry args={[w, 0.004, d]} />
        <meshBasicMaterial color={color} transparent opacity={0.16} depthWrite={false} />
      </mesh>
    </group>
  );
}
