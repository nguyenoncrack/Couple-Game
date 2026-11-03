import {
  catalog,
  cellsBetween,
  edgesBetween,
  footprintOf,
  newId,
  openingProblem,
  placementProblem,
  rotatedSize,
  type OpeningItem,
  type PlacedOpening,
  type Rot,
} from "@cg/shared";
import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { create } from "zustand";
import { autoPan, cameraGestureActive } from "../render/CameraRig";
import { addWall, FootprintMarker, Furniture, objectTransform, openingTransform, WALL_DOWN_H, WALL_H, wallRuns, Walls } from "../render/House";
import type { Kit } from "../render/kit";
import { KitMesh, Meshes } from "../render/KitMesh";
import { modelFor, openingModelFor } from "../render/models";
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
  kind: "object" | "opening";
  id: string;
  /** Offset from the pointer's cell to the object's anchor, kept while dragging. */
  offset: [number, number];
  x: number;
  z: number;
  rot: Rot;
  /** Doors and windows: which wall line, and which way they face. */
  dir: "h" | "v";
  flip: boolean;
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
// While something is being dragged, the camera follows the pointer to the screen edge.
useBuild.subscribe((b) => (autoPan.active = Boolean(b.drag || b.move)));

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

/** Doors and windows snap to the nearest wall line, preferring a spot where they'd fit. */
function openingSpotAt(p: [number, number], item: OpeningItem, ignore: string | null): { dir: "h" | "v"; x: number; z: number } {
  const half = item.width / 2;
  const h = { dir: "h" as const, x: Math.round(p[0] - half), z: Math.round(p[1]) };
  const v = { dir: "v" as const, x: Math.round(p[0]), z: Math.round(p[1] - half) };
  const level = useGame.getState().view?.levels[0];
  if (level) {
    const okH = openingProblem(level, item, h, ignore) === null;
    const okV = openingProblem(level, item, v, ignore) === null;
    if (okH !== okV) return okH ? h : v;
  }
  return Math.abs(p[1] - Math.round(p[1])) <= Math.abs(p[0] - Math.round(p[0])) ? h : v;
}

/** Presence only has room for a rotation, so a door's wall direction and facing ride in it. */
export const openingToRot = (dir: "h" | "v", flip: boolean) => ((dir === "v" ? 1 : 0) + (flip ? 2 : 0)) as Rot;
export const rotToOpening = (rot: Rot) => ({ dir: rot % 2 ? ("v" as const) : ("h" as const), flip: rot >= 2 });

function finishMove() {
  const m = getB().move;
  if (!m) return;
  setB({ move: null });
  const level = useGame.getState().view?.levels[0];
  if (!m.moved || !level) return;
  if (m.kind === "opening") {
    const o = level.openings[m.id];
    if (o && (o.x !== m.x || o.z !== m.z || o.dir !== m.dir || o.flip !== m.flip)) submit({ t: "opening.move", level: 0, id: m.id, dir: m.dir, x: m.x, z: m.z, flip: m.flip });
    return;
  }
  const o = level.objects[m.id];
  if (o && (o.x !== m.x || o.z !== m.z || o.rot !== m.rot)) submit({ t: "object.move", level: 0, id: m.id, x: m.x, z: m.z, rot: m.rot });
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

/** Turn the selected object a quarter, keeping it centred where it was; turn a door or window to face the other way. */
export function rotateSelected() {
  const s = useGame.getState();
  const level = s.view?.levels[0];
  const opening = s.selection ? level?.openings[s.selection] : null;
  if (opening) {
    submit({ t: "opening.move", level: 0, id: opening.id, dir: opening.dir, x: opening.x, z: opening.z, flip: !opening.flip });
    return;
  }
  const o = s.selection ? level?.objects[s.selection] : null;
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
  if (s.view?.levels[0]?.openings[id]) submit({ t: "opening.remove", level: 0, id });
  else submit({ t: "object.remove", level: 0, id });
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
          if (m.kind === "opening") setB({ move: { ...m, flip: !m.flip, moved: true } });
          else setB({ move: { ...m, rot: ((m.rot + 1) % 4) as Rot, moved: true } });
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
    const level = view?.levels[0];
    if (move?.moved && move.kind === "opening") {
      const o = level?.openings[move.id];
      if (o) drag = { catalogId: o.catalogId, objectId: move.id, x: move.x, z: move.z, rot: openingToRot(move.dir, move.flip) };
    } else if (move?.moved) {
      const o = level?.objects[move.id];
      if (o) drag = { catalogId: o.catalogId, objectId: move.id, x: move.x, z: move.z, rot: move.rot };
    } else if (tool === "buy" && placing && pointer) {
      const opening = catalog.openings.get(placing.catalogId);
      if (opening) {
        const spot = openingSpotAt(pointer, opening, null);
        drag = { catalogId: placing.catalogId, objectId: null, x: spot.x, z: spot.z, rot: openingToRot(spot.dir, placing.rot % 2 === 1) };
      } else {
        const [x, z] = anchorUnder(pointer, placing.catalogId, placing.rot);
        drag = { catalogId: placing.catalogId, objectId: null, x, z, rot: placing.rot };
      }
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
    if (move?.kind === "opening") {
      const item = catalog.openings.get(s.view?.levels[0]?.openings[move.id]?.catalogId ?? "");
      if (item) {
        const spot = openingSpotAt(p, item, move.id);
        if (spot.x !== move.x || spot.z !== move.z || spot.dir !== move.dir) setB({ move: { ...move, ...spot, moved: true } });
      }
    } else if (move) {
      const c = cellAt(p);
      const x = c[0] + move.offset[0];
      const z = c[1] + move.offset[1];
      if (x !== move.x || z !== move.z) setB({ move: { ...move, x, z, moved: true } });
    }
  };

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0 || cameraGestureActive()) return;
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
        const opening = catalog.openings.get(catalogId);
        if (opening) {
          const spot = openingSpotAt(p, opening, null);
          submit({ t: "opening.place", level: 0, id: newId(), catalogId, ...spot, flip: rot % 2 === 1 });
          break;
        }
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
    if (cameraGestureActive()) return;
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
    setB({ move: { kind: "object", id, offset: [o.x - c[0], o.z - c[1]], x: o.x, z: o.z, rot: o.rot, dir: "h", flip: false, moved: false } });
  };

  const onOpeningDown = (id: string, e: ThreeEvent<PointerEvent>) => {
    if (cameraGestureActive()) return;
    const s = useGame.getState();
    if (s.tool !== "select") {
      onDown(e);
      return;
    }
    const partner = heldByPartner(id);
    if (partner) {
      toast(`${partner.name} is moving that right now.`);
      return;
    }
    const o = s.view!.levels[0]!.openings[id]!;
    select(id);
    setB({ move: { kind: "opening", id, offset: [0, 0], x: o.x, z: o.z, rot: 0, dir: o.dir, flip: o.flip, moved: false } });
  };

  return (
    <>
      <mesh geometry={plane} position={[0, 0.04, 0]} visible={false} onPointerMove={onMove} onPointerDown={onDown} onPointerLeave={() => setB({ pointer: null })} />
      <Walls level={level} hiddenOpening={move?.moved && move.kind === "opening" ? move.id : null} onOpeningDown={onOpeningDown} />
      <Furniture objects={level.objects} hidden={move?.moved && move.kind === "object" ? move.id : null} onObjectDown={onObjectDown} />
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
  const wallsDown = useGame((s) => s.wallMode === "down");
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
    const opening = catalog.openings.get(placing.catalogId);
    if (opening) {
      const spot = openingSpotAt(pointer, opening, null);
      out.push(<OpeningGhost key="placing" catalogId={placing.catalogId} {...spot} flip={placing.rot % 2 === 1} ignore={null} />);
    } else {
      const [x, z] = anchorUnder(pointer, placing.catalogId, placing.rot);
      out.push(<Ghost key="placing" catalogId={placing.catalogId} x={x} z={z} rot={placing.rot} ignore={null} />);
    }
  }

  if (move?.moved && move.kind === "opening" && level?.openings[move.id]) {
    out.push(<OpeningGhost key="moving" catalogId={level.openings[move.id]!.catalogId} dir={move.dir} x={move.x} z={move.z} flip={move.flip} ignore={move.id} />);
  } else if (move?.moved && level?.objects[move.id]) {
    out.push(<Ghost key="moving" catalogId={level.objects[move.id]!.catalogId} x={move.x} z={move.z} rot={move.rot} ignore={move.id} />);
  } else if (selection && level?.objects[selection]) {
    const o = level.objects[selection]!;
    const f = footprintOf(catalog.furniture.get(o.catalogId)!, o);
    out.push(<FootprintMarker key="sel" {...f} color="#3a3631" />);
  } else if (selection && level?.openings[selection]) {
    const o = level.openings[selection]!;
    out.push(<FootprintMarker key="sel" {...openingFootprint(o, catalog.openings.get(o.catalogId)!)} color="#3a3631" />);
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

/** A strip of floor either side of a door or window, for selection and hold markers. */
export function openingFootprint(o: Pick<PlacedOpening, "dir" | "x" | "z">, item: OpeningItem) {
  return o.dir === "h" ? { x: o.x, z: o.z - 0.3, w: item.width, d: 0.6 } : { x: o.x - 0.3, z: o.z, w: 0.6, d: item.width };
}

/** A see-through door or window snapped to a wall, green if it fits there and red if not. */
export function OpeningGhost({ catalogId, dir, x, z, flip, ignore, color }: { catalogId: string; dir: "h" | "v"; x: number; z: number; flip: boolean; ignore: string | null; color?: string }) {
  const item = catalog.openings.get(catalogId);
  const level = useGame((s) => s.view?.levels[0]);
  if (!item || !level) return null;
  const ok = openingProblem(level, item, { dir, x, z }, ignore) === null;
  const { position, rotationY } = openingTransform({ dir, x, z, flip }, item);
  return (
    <group>
      <group position={position} rotation-y={rotationY}>
        <Meshes meshes={openingModelFor(item, ok ? "ok" : "bad")} raycast={false} />
      </group>
      <FootprintMarker {...openingFootprint({ dir, x, z }, item)} color={color ?? (ok ? "#6f9e5c" : "#c4534a")} />
    </group>
  );
}
