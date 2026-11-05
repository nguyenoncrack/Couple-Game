import { cellKey, edgeKey, materialPaintOp, materialRoom, parseCell, type Blueprint } from "@cg/shared";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { create } from "zustand";
import { submit, toast, useGame } from "../../state/game";
import type { MaterialKind } from "./material";

export type PaintScope = "draw" | "surface" | "room";
export const useMaterialTools = create<{ wall: PaintScope; floor: PaintScope }>(() => ({ wall: "draw", floor: "draw" }));
type Pending = { kind: MaterialKind; scope: PaintScope; level: number; point: [number, number]; edge?: string; from: [number, number] };
let pending: Pending | null = null;
export const cancelMaterialPaint = () => { pending = null; };

export function materialTargets(bp: Blueprint, level: number, kind: MaterialKind, scope: PaintScope, point: [number, number], edge?: string) {
  const [x, z] = point.map(Math.floor) as [number, number];
  if (scope === "room") {
    const room = materialRoom(bp, level, x, z);
    return room ? kind === "wall" ? room.walls : room.cells : null;
  }
  return kind === "floor" ? [cellKey(x, z)] : edge ? [edge] : [];
}

/** Queue until pointerup: a drag/pinch must not accidentally paint a room. */
export function queueMaterialPaint(point: [number, number], from: [number, number], edge?: string) {
  const s = useGame.getState();
  if (s.tool !== "wall" && s.tool !== "floor") return false;
  const scope = useMaterialTools.getState()[s.tool];
  if (scope === "draw") return false;
  pending = { kind: s.tool, scope, level: s.floor, point, edge, from };
  return true;
}

export function finishMaterialPaint(e: PointerEvent) {
  const p = pending; pending = null;
  if (!p || Math.hypot(e.clientX - p.from[0], e.clientY - p.from[1]) >= 8) return;
  const s = useGame.getState();
  if (!s.view || s.mode !== "build" || s.tool !== p.kind || s.floor !== p.level || useMaterialTools.getState()[p.kind] !== p.scope) return;
  const targets = materialTargets(s.view, p.level, p.kind, p.scope, p.point, p.edge);
  if (!targets) { toast("No enclosed room here. Close the walls, or choose a single surface."); return; }
  const op = materialPaintOp(s.view, p.level, p.kind, targets, p.kind === "wall" ? s.wallStyle : s.floorMaterial);
  if (op) submit(op);
  else if (!targets.length || !targets.some((key) => p.kind === "wall" ? s.view!.levels[p.level]!.walls[key] : s.view!.levels[p.level]!.tiles[key]))
    toast(p.kind === "wall" ? "Click an existing wall segment, or choose Draw walls." : "Lay floor tiles first, then apply a finish.");
}

export function edgeAtWall(run: { dir: "h" | "v"; at: number; from: number; to: number }, point: { x: number; z: number }) {
  const at = Math.max(run.from, Math.min(run.to - 1, Math.floor(run.dir === "h" ? point.x : point.z)));
  return run.dir === "h" ? edgeKey("h", at, run.at) : edgeKey("v", run.at, at);
}

/** A merged overlay shows the room footprint; floor holes remain unhighlighted. */
export function MaterialTargets({ pointer }: { pointer: [number, number] | null }) {
  const bp = useGame((s) => s.view), level = useGame((s) => s.floor), tool = useGame((s) => s.tool);
  const scope = useMaterialTools((s) => tool === "wall" || tool === "floor" ? s[tool] : "draw");
  const x = pointer ? Math.floor(pointer[0]) : null, z = pointer ? Math.floor(pointer[1]) : null;
  const geometry = useMemo(() => {
    if (!bp || x === null || z === null || scope === "draw" || (tool !== "wall" && tool !== "floor")) return null;
    const targets = materialTargets(bp, level, "floor", scope, [x, z]);
    const op = targets && materialPaintOp(bp, level, "floor", targets, "__preview__");
    const cells = op ? (op.t === "batch" ? op.ops : [op]).flatMap((v) => v.t === "floor.paint" ? v.cells : []) : [];
    const pos = cells.flatMap((key) => { const c = parseCell(key)!; return [c.x,.065,c.z,c.x,.065,c.z+1,c.x+1,.065,c.z,c.x+1,.065,c.z,c.x,.065,c.z+1,c.x+1,.065,c.z+1]; });
    return new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  }, [bp, level, tool, scope, x, z]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  return geometry ? <mesh geometry={geometry} raycast={() => null} renderOrder={5}><meshBasicMaterial color="#20bfa0" transparent opacity={.22} depthWrite={false} /></mesh> : null;
}
