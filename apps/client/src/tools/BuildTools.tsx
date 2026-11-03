import {
  catalog,
  cellsBetween,
  edgesBetween,
  footprintOf,
  newId,
  placementProblem,
  rotatedSize,
  type Rot,
} from "@cg/shared";
import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { create } from "zustand";
import { addWall, FootprintMarker, Furniture, objectTransform, WALL_DOWN_H, WALL_H, wallRuns } from "../render/House";
import type { Kit } from "../render/kit";
import { KitMesh, Meshes } from "../render/KitMesh";
import { modelFor } from "../render/models";
import { heldByPartner, hold, sharePresence, submit, toast, useGame } from "../state/game";

/**
 * Pointer handling for the build tools, plus everything they draw while you work: the grid, wall and floor
 * previews, and the ghost of whatever you're carrying. One big invisible plane at floor level catches the pointer.
 */

interface Drag {
  /** Grid point where the drag started (corner for walls, cell for floors). */
  start: [number, number];
  end: [number, number];
}

interface MoveDrag {
  id: string;
  /** Offset from the pointer's cell to the object's anchor, kept while dragging. */
  offset: [number, number];
  x: number;
  z: number;
  rot: Rot;
  moved: boolean;
}

interface BuildState {
  pointer: [number, number] | null;
  drag: Drag | null;
  move: MoveDrag | null;
}

export const useBuild = create<BuildState>(() => ({ pointer: null, drag: null, move: null }));
const setB = useBuild.setState;
const getB = useBuild.getState;

function lot() {
  return useGame.getState().view?.lot ?? { w: 0, d: 0 };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const cornerAt = ([x, z]: [number, number]): [number, number] => [clamp(Math.round(x), 0, lot().w), clamp(Math.round(z), 0, lot().d)];
const cellAt = ([x, z]: [number, number]): [number, number] => [clamp(Math.floor(x), 0, lot().w - 1), clamp(Math.floor(z), 0, lot().d - 1)];

/** Keep a wall drag straight: follow whichever axis the pointer has moved along most. */
function straighten(start: [number, number], end: [number, number]): [number, number] {
  return Math.abs(end[0] - start[0]) >= Math.abs(end[1] - start[1]) ? [end[0], start[1]] : [start[0], end[1]];
}

/** Anchor for an item carried under the pointer: the pointer sits at the footprint's centre. */
function anchorUnder(p: [number, number], catalogId: string, rot: Rot): [number, number] {
  const item = catalog.furniture.get(catalogId)!;
  const [w, d] = rotatedSize(item.footprint[0], item.footprint[1], rot);
  return [Math.round(p[0] - w / 2), Math.round(p[1] - d / 2)];
}

function problemAt(catalogId: string, x: number, z: number, rot: Rot, ignore: string | null) {
  const view = useGame.getState().view;
  const item = catalog.furniture.get(catalogId);
  if (!view || !item) return "unknown-item";
  return placementProblem(view, view.levels[0]!, item, { x, z, rot }, ignore);
}

function finishMove() {
  const m = getB().move;
  if (!m) return;
  setB({ move: null });
  const o = useGame.getState().view?.levels[0]?.objects[m.id];
  if (m.moved && o && (o.x !== m.x || o.z !== m.z || o.rot !== m.rot)) submit({ t: "object.move", level: 0, id: m.id, x: m.x, z: m.z, rot: m.rot });
}

function finishDrag() {
  const { drag } = getB();
  const s = useGame.getState();
  setB({ drag: null });
  if (!drag || !s.view) return;
  if (s.tool === "wall" || s.tool === "wallErase") {
    const edges = edgesBetween(drag.start[0], drag.start[1], drag.end[0], drag.end[1]);
    if (!edges.length) return;
    if (s.tool === "wall") submit({ t: "walls.add", level: 0, edges, style: s.wallStyle });
    else {
      const existing = edges.filter((e) => s.view!.levels[0]!.walls[e]);
      if (existing.length) submit({ t: "walls.remove", level: 0, edges: existing });
    }
  } else if (s.tool === "floor" || s.tool === "floorErase") {
    const cells = cellsBetween(drag.start[0], drag.start[1], drag.end[0], drag.end[1]);
    if (s.tool === "floorErase") {
      const existing = cells.filter((c) => s.view!.levels[0]!.tiles[c]);
      if (existing.length) submit({ t: "floor.paint", level: 0, cells: existing, material: null });
    } else submit({ t: "floor.paint", level: 0, cells, material: s.floorMaterial });
  }
}

export function select(id: string | null) {
  const s = useGame.getState();
  if (s.selection === id) return;
  useGame.setState({ selection: id });
  hold(id);
}

/** Turn the selected object a quarter, keeping it centred where it was. */
export function rotateSelected() {
  const s = useGame.getState();
  const o = s.selection ? s.view?.levels[0]?.objects[s.selection] : null;
  if (!o) return;
  const item = catalog.furniture.get(o.catalogId)!;
  const f = footprintOf(item, o);
  const rot = ((o.rot + 1) % 4) as Rot;
  const [w, d] = rotatedSize(item.footprint[0], item.footprint[1], rot);
  submit({ t: "object.move", level: 0, id: o.id, x: Math.round(f.x + f.w / 2 - w / 2), z: Math.round(f.z + f.d / 2 - d / 2), rot });
}

export function deleteSelected() {
  const s = useGame.getState();
  if (!s.selection) return;
  const id = s.selection;
  select(null);
  submit({ t: "object.remove", level: 0, id });
}

export function BuildTools() {
  const view = useGame((s) => s.view);
  const tool = useGame((s) => s.tool);
  const move = useBuild((s) => s.move);
  const plane = useMemo(() => new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), []);
  const downAt = useRef<[number, number] | null>(null);

  // Let go of a drag even if the pointer is released over the HUD or outside the window.
  useEffect(() => {
    const up = () => {
      downAt.current = null;
      finishDrag();
      finishMove();
    };
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
      const s = useGame.getState();
      const k = e.key.toLowerCase();
      if (k === "r") {
        const m = getB().move;
        if (m) {
          const o = s.view?.levels[0]?.objects[m.id];
          if (o) setB({ move: { ...m, rot: ((m.rot + 1) % 4) as Rot, moved: true } });
        } else if (s.placing) useGame.setState({ placing: { ...s.placing, rot: ((s.placing.rot + 1) % 4) as Rot } });
        else rotateSelected();
      } else if (k === "delete" || k === "backspace") {
        deleteSelected();
      } else if (k === "escape") {
        if (s.placing) useGame.setState({ placing: null });
        else select(null);
        setB({ drag: null, move: null });
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  // Tell the partner where I am and what I'm carrying.
  const pointer = useBuild((s) => s.pointer);
  const placing = useGame((s) => s.placing);
  useEffect(() => {
    let drag = null;
    if (move) {
      const o = view?.levels[0]?.objects[move.id];
      if (o && move.moved) drag = { catalogId: o.catalogId, objectId: move.id, x: move.x, z: move.z, rot: move.rot };
    } else if (tool === "buy" && placing && pointer) {
      const [x, z] = anchorUnder(pointer, placing.catalogId, placing.rot);
      drag = { catalogId: placing.catalogId, objectId: null, x, z, rot: placing.rot };
    }
    sharePresence({ cursor: pointer ? { x: pointer[0], z: pointer[1] } : null, tool, drag });
  }, [pointer, move, tool, placing, view]);

  if (!view) return null;
  const level = view.levels[0]!;

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    const p: [number, number] = [e.point.x, e.point.z];
    setB({ pointer: p });
    const s = useGame.getState();
    const { drag, move } = getB();
    if (drag) {
      if (s.tool === "wall" || s.tool === "wallErase") setB({ drag: { ...drag, end: straighten(drag.start, cornerAt(p)) } });
      else setB({ drag: { ...drag, end: cellAt(p) } });
    }
    if (move) {
      const c = cellAt(p);
      const x = c[0] + move.offset[0];
      const z = c[1] + move.offset[1];
      if (x !== move.x || z !== move.z) setB({ move: { ...move, x, z, moved: true } });
    }
  };

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
    const p: [number, number] = [e.point.x, e.point.z];
    const s = useGame.getState();
    downAt.current = p;
    switch (s.tool) {
      case "wall":
      case "wallErase": {
        const c = cornerAt(p);
        setB({ drag: { start: c, end: c } });
        break;
      }
      case "floor":
      case "floorErase": {
        const c = cellAt(p);
        setB({ drag: { start: c, end: c } });
        break;
      }
      case "buy": {
        if (!s.placing) return;
        const { catalogId, rot } = s.placing;
        const [x, z] = anchorUnder(p, catalogId, rot);
        submit({ t: "object.place", level: 0, id: newId(), catalogId, x, z, rot });
        break;
      }
      case "select":
        select(null);
        break;
    }
  };

  const onObjectDown = (id: string, e: ThreeEvent<PointerEvent>) => {
    const s = useGame.getState();
    if (s.tool !== "select") {
      // Other tools act on the floor underneath.
      onDown(e);
      return;
    }
    const partner = heldByPartner(id);
    if (partner) {
      toast(`${partner.name} is moving that right now.`);
      return;
    }
    const o = s.view!.levels[0]!.objects[id]!;
    select(id);
    const c = cellAt([e.point.x, e.point.z]);
    setB({ move: { id, offset: [o.x - c[0], o.z - c[1]], x: o.x, z: o.z, rot: o.rot, moved: false } });
  };

  return (
    <>
      <mesh geometry={plane} position={[0, 0.04, 0]} visible={false} onPointerMove={onMove} onPointerDown={onDown} onPointerLeave={() => setB({ pointer: null })} />
      <Furniture objects={level.objects} hidden={move?.moved ? move.id : null} onObjectDown={onObjectDown} />
      {tool !== "select" && <Grid w={view.lot.w} d={view.lot.d} />}
      <Previews />
    </>
  );
}

function Grid({ w, d }: { w: number; d: number }) {
  const geo = useMemo(() => {
    const pts: number[] = [];
    for (let x = 0; x <= w; x++) pts.push(x, 0.05, 0, x, 0.05, d);
    for (let z = 0; z <= d; z++) pts.push(0, 0.05, z, w, 0.05, z);
    return new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  }, [w, d]);
  return (
    <lineSegments geometry={geo} raycast={() => null}>
      <lineBasicMaterial color="#3a3631" transparent opacity={0.16} depthWrite={false} />
    </lineSegments>
  );
}

const previewMat = {
  add: new THREE.MeshBasicMaterial({ color: "#9ccf8a", transparent: true, opacity: 0.55, depthWrite: false }),
  erase: new THREE.MeshBasicMaterial({ color: "#e0675a", transparent: true, opacity: 0.55, depthWrite: false }),
};

function Previews() {
  const { drag, pointer, move } = useBuild();
  const tool = useGame((s) => s.tool);
  const placing = useGame((s) => s.placing);
  const selection = useGame((s) => s.selection);
  const view = useGame((s) => s.view);
  const wallsDown = useGame((s) => s.wallsDown);
  const level = view?.levels[0];

  const wallPreview = useMemo(() => {
    if (!drag || (tool !== "wall" && tool !== "wallErase")) return null;
    const edges = edgesBetween(drag.start[0], drag.start[1], drag.end[0], drag.end[1]);
    return edges.length ? Object.fromEntries(edges.map((e) => [e, { style: "preview" }])) : null;
  }, [drag, tool]);

  const out: React.ReactNode[] = [];

  if (wallPreview) {
    const mat = tool === "wall" ? previewMat.add : previewMat.erase;
    const key = JSON.stringify(wallPreview);
    out.push(
      <KitMesh
        key={`walls-${key}`}
        deps={[key, wallsDown]}
        make={(k: Kit) => {
          for (const run of wallRuns(wallPreview)) addWall(k, run, wallsDown ? WALL_DOWN_H : WALL_H, mat, mat);
        }}
      />,
    );
  } else if ((tool === "wall" || tool === "wallErase") && pointer) {
    const [x, z] = cornerAt(pointer);
    out.push(
      <mesh key="corner" position={[x, 0.3, z]} raycast={() => null} material={tool === "wall" ? previewMat.add : previewMat.erase}>
        <cylinderGeometry args={[0.1, 0.1, 0.6, 12]} />
      </mesh>,
    );
  }

  if (drag && (tool === "floor" || tool === "floorErase")) {
    const x0 = Math.min(drag.start[0], drag.end[0]);
    const z0 = Math.min(drag.start[1], drag.end[1]);
    const w = Math.abs(drag.end[0] - drag.start[0]) + 1;
    const d = Math.abs(drag.end[1] - drag.start[1]) + 1;
    out.push(<FootprintMarker key="floor" x={x0} z={z0} w={w} d={d} color={tool === "floor" ? "#6f9e5c" : "#c4534a"} />);
  } else if ((tool === "floor" || tool === "floorErase") && pointer) {
    const [x, z] = cellAt(pointer);
    out.push(<FootprintMarker key="floorhover" x={x} z={z} w={1} d={1} color={tool === "floor" ? "#6f9e5c" : "#c4534a"} opacity={0.6} />);
  }

  if (tool === "buy" && placing && pointer) {
    const [x, z] = anchorUnder(pointer, placing.catalogId, placing.rot);
    out.push(<Ghost key="placing" catalogId={placing.catalogId} x={x} z={z} rot={placing.rot} ignore={null} />);
  }

  if (move?.moved && level?.objects[move.id]) {
    out.push(<Ghost key="moving" catalogId={level.objects[move.id]!.catalogId} x={move.x} z={move.z} rot={move.rot} ignore={move.id} />);
  } else if (selection && level?.objects[selection]) {
    const o = level.objects[selection]!;
    const f = footprintOf(catalog.furniture.get(o.catalogId)!, o);
    out.push(<FootprintMarker key="sel" {...f} color="#3a3631" />);
  }

  return <>{out}</>;
}

/** See-through furniture with a green (fits) or red (doesn't) footprint. */
export function Ghost({ catalogId, x, z, rot, ignore, color }: { catalogId: string; x: number; z: number; rot: Rot; ignore: string | null; color?: string }) {
  const { item, f, position, rotationY } = objectTransform({ catalogId, x, z, rot });
  const ok = problemAt(catalogId, x, z, rot, ignore) === null;
  return (
    <group>
      <group position={position} rotation-y={rotationY}>
        <Meshes meshes={modelFor(item, ok ? "ok" : "bad")} raycast={false} />
      </group>
      <FootprintMarker {...f} color={color ?? (ok ? "#6f9e5c" : "#c4534a")} />
    </group>
  );
}
