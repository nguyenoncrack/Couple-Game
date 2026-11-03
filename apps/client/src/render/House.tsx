import { catalog, cellKey, footprintOf, parseCell, parseEdge, type Level, type PlacedObject } from "@cg/shared";
import type { ThreeEvent } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three";
import { useGame } from "../state/game";
import type { Kit } from "./kit";
import { KitMesh, Meshes } from "./KitMesh";
import { modelFor, shade } from "./models";
import { pencilMaterial, shadowMaterial } from "./pencil";

export const WALL_H = 2.7;
export const WALL_DOWN_H = 0.32;
export const WALL_T = 0.14;
const FLOOR_Y = 0.04;

interface Run {
  dir: "h" | "v";
  /** Fixed coordinate (z for h, x for v) and the span along the other axis. */
  at: number;
  from: number;
  to: number;
  style: string;
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

/** Add one straight wall (with baseboards and a top cap) to a kit. Also used for the build previews. */
export function addWall(k: Kit, run: Run, height: number, mat: THREE.Material, trim: THREE.Material) {
  const len = run.to - run.from + WALL_T;
  const mid = (run.from + run.to) / 2;
  const [x, z] = run.dir === "h" ? [mid, run.at] : [run.at, mid];
  const size = (l: number, h: number, t: number): [number, number, number] => (run.dir === "h" ? [l, h, t] : [t, h, l]);
  k.box(mat, [x, height / 2, z], size(len, height, WALL_T), { outline: 0.024 });
  k.box(trim, [x, 0.06, z], size(len + 0.02, 0.12, WALL_T + 0.035), { outline: 0.008 });
  k.box(trim, [x, height + 0.015, z], size(len + 0.02, 0.03, WALL_T + 0.03), { outline: 0.008 });
}

export function Walls({ walls }: { walls: Level["walls"] }) {
  const down = useGame((s) => s.wallsDown);
  return (
    <KitMesh
      deps={[walls, down]}
      make={(k) => {
        const trim = pencilMaterial("#f7f2e8");
        for (const run of wallRuns(walls)) {
          const style = catalog.wallStyles.get(run.style);
          addWall(k, run, down ? WALL_DOWN_H : WALL_H, pencilMaterial(style?.color ?? "#efe3cc", { finish: style?.finish, rim: false }), trim);
        }
      }}
    />
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
