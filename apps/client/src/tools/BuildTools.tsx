import { cancelMaterialPaint, edgeAtWall, finishMaterialPaint, MaterialTargets, queueMaterialPaint, useMaterialTools } from "../features/buildMaterials/tools";
import { allowsBuildShortcut } from "../input/buildShortcuts";
import {
  catalog,
  cellsBetween,
  edgesBetween,
  footprintOf,
  newId,
  openingProblem,
  placementProblem,
  rotatedSize,
  STOREY,
  cellKey,
  flightOf,
  isLift,
  isStairs,
  shaftOf,
  type Op,
  type SingleOp,
  type OpeningItem,
  type PlacedOpening,
  type Rot,
} from "@cg/shared";
import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { create } from "zustand";
import { autoPan, cameraGestureActive, multiTouch } from "../render/CameraRig";
import { addWall, FootprintMarker, Furniture, objectTransform, openingTransform, WALL_DOWN_H, WALL_H, wallRuns, Walls } from "../render/House";
import type { Kit } from "../render/kit";
import { KitMesh, Meshes } from "../render/KitMesh";
import { modelFor, openingModelFor } from "../render/models";
import { buildRoof, ROOF_BASE, Roofs } from "../render/Roof";
import { openRoofs } from "../render/Storeys";
import { floorNow, heldByPartner, hold, sharePresence, submit, toast, useGame } from "../state/game";

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
  /** Where the press started on screen; nothing moves until the pointer has really travelled from it. */
  from: [number, number];
  armed: boolean;
  moved: boolean;
}

/** How far (in screen pixels) the pointer must travel before a press on furniture becomes a move, not a click. */
const DRAG_PX = 8;
/** Level with the floor being built on, or with the tops of its walls. */
const planeAt = (y: number) => new THREE.Plane(new THREE.Vector3(0, 1, 0), -(floorNow() * STOREY + y));

/** Where the pointer is on the grid: on the floor, or for the roof tool, level with the tops of the walls. */
function gridPoint(e: ThreeEvent<PointerEvent>): [number, number] {
  if (useGame.getState().tool !== "roof") return [e.point.x, e.point.z];
  const hit = e.ray.intersectPlane(planeAt(ROOF_BASE), new THREE.Vector3());
  return hit ? [hit.x, hit.z] : [e.point.x, e.point.z];
}

/** The floor point under the pointer. The hit point on a model sits above the floor, in a different cell. */
function floorUnder(e: ThreeEvent<PointerEvent>): [number, number] {
  const hit = e.ray.intersectPlane(planeAt(0.04), new THREE.Vector3());
  return hit ? [hit.x, hit.z] : [e.point.x, e.point.z];
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

/** The floor something goes on: the one you're looking at, but a lift always stands on the ground floor. */
const levelFor = (catalogId: string) => (isLift(catalog.furniture.get(catalogId)) ? 0 : floorNow());

function problemAt(catalogId: string, x: number, z: number, rot: Rot, ignore: string | null, on = floorNow()) {
  const view = useGame.getState().view;
  const item = catalog.furniture.get(catalogId);
  const level = isLift(item) ? 0 : on;
  if (!view || !item || !view.levels[level]) return "unknown-item";
  const problem = placementProblem(view, view.levels[level]!, item, { x, z, rot }, ignore);
  // stairs (or a lift) with no floor to step off onto get it laid with them
  return (problem === "needs-landing" || problem === "lift-no-stop") && landing(catalogId, x, z, rot).length ? null : problem;
}

/**
 * Laying the floor stairs need at the top, when there isn't any: the cells to step off onto, on the floor above.
 * Null if they're not stairs, there's no floor above, or the landing is already there.
 */
function landing(catalogId: string, x: number, z: number, rot: Rot): SingleOp[] {
  const s = useGame.getState();
  const item = catalog.furniture.get(catalogId);
  const levels = s.view?.levels ?? [];
  const lay = (level: number, cells: string[]): SingleOp[] => {
    const missing = cells.filter((c) => !levels[level]!.tiles[c]);
    return missing.length ? [{ t: "floor.paint", level, cells: missing, material: s.floorMaterial }] : [];
  };
  // stairs: the floor at the top, on the floor above
  if (isStairs(item)) return levels[s.floor + 1] ? lay(s.floor + 1, flightOf(item, { x, z, rot }).lanes.map((l) => cellKey(...l.exit))) : [];
  // a lift: floor at its doors on every floor above that has some (or the first, if none do yet), to stop at
  if (isLift(item) && levels.length > 1) {
    const doors = shaftOf(item, { x, z, rot }).front.map(([fx, fz]) => cellKey(fx, fz));
    const floors = [...levels.keys()].filter((i) => i > 0 && (i === s.floor || Object.keys(levels[i]!.tiles).length));
    return (floors.length ? floors : [1]).flatMap((i) => lay(i, doors));
  }
  return [];
}

/** An edit to stairs or a lift, with the floor to step out onto laid first if it's missing. */
function withLanding(op: SingleOp & { x: number; z: number; rot: Rot }, catalogId: string): Op {
  const lay = landing(catalogId, op.x, op.z, op.rot);
  return lay.length ? { t: "batch", ops: [...lay, op] } : op;
}

/** Doors and windows snap to the nearest wall line, preferring a spot where they'd fit. */
function openingSpotAt(p: [number, number], item: OpeningItem, ignore: string | null): { dir: "h" | "v"; x: number; z: number } {
  const half = item.width / 2;
  const h = { dir: "h" as const, x: Math.round(p[0] - half), z: Math.round(p[1]) };
  const v = { dir: "v" as const, x: Math.round(p[0]), z: Math.round(p[1] - half) };
  const level = useGame.getState().view?.levels[floorNow()];
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
  const level = useGame.getState().view?.levels[floorNow()];
  if (!m.moved || !level) return;
  if (m.kind === "opening") {
    const o = level.openings[m.id];
    if (o && (o.x !== m.x || o.z !== m.z || o.dir !== m.dir || o.flip !== m.flip)) submit({ t: "opening.move", level: floorNow(), id: m.id, dir: m.dir, x: m.x, z: m.z, flip: m.flip });
    return;
  }
  const o = level.objects[m.id];
  if (o && (o.x !== m.x || o.z !== m.z || o.rot !== m.rot)) submit(withLanding({ t: "object.move", level: levelFor(o.catalogId), id: m.id, x: m.x, z: m.z, rot: m.rot }, o.catalogId));
}

/**
 * A press with something from the catalog in hand. It's placed when the press ends close to where it began, so
 * the first finger of a pinch, or a press that turns into a camera drag, doesn't drop anything.
 */
let pendingPlace: { p: [number, number]; from: [number, number] } | null = null;

function placeAt(p: [number, number]) {
  const placing = useGame.getState().placing;
  if (!placing) return;
  const { catalogId, rot } = placing;
  const opening = catalog.openings.get(catalogId);
  if (opening) {
    const spot = openingSpotAt(p, opening, null);
    submit({ t: "opening.place", level: floorNow(), id: newId(), catalogId, ...spot, flip: rot % 2 === 1 });
    return;
  }
  const [x, z] = anchorUnder(p, catalogId, rot);
  submit(withLanding({ t: "object.place", level: levelFor(catalogId), id: newId(), catalogId, x, z, rot }, catalogId));
}

function finishPlace(e: PointerEvent) {
  const pending = pendingPlace;
  pendingPlace = null;
  if (pending && Math.hypot(e.clientX - pending.from[0], e.clientY - pending.from[1]) < DRAG_PX) placeAt(pending.p);
}

/** A second finger came down: the camera has the gesture, so drop whatever the first finger started. */
function cancelForCamera() {
  cancelMaterialPaint();
  pendingPlace = null;
  if (getB().drag || getB().move) setB({ drag: null, move: null });
}

function finishDrag() {
  const { drag } = getB();
  const s = useGame.getState();
  setB({ drag: null });
  if (!drag || !s.view) return;
  if ((s.tool === "wall" || s.tool === "floor") && useMaterialTools.getState()[s.tool] !== "draw") return;
  if (s.tool === "wall" || s.tool === "wallErase") {
    const edges = edgesBetween(drag.start[0], drag.start[1], drag.end[0], drag.end[1]);
    if (!edges.length) return;
    if (s.tool === "wall") submit({ t: "walls.add", level: floorNow(), edges, style: s.wallStyle });
    else {
      const existing = edges.filter((e) => s.view!.levels[floorNow()]!.walls[e]);
      if (existing.length) submit({ t: "walls.remove", level: floorNow(), edges: existing });
    }
  } else if (s.tool === "floor" || s.tool === "floorErase") {
    const cells = cellsBetween(drag.start[0], drag.start[1], drag.end[0], drag.end[1]);
    if (s.tool === "floorErase") {
      const existing = cells.filter((c) => s.view!.levels[floorNow()]!.tiles[c]);
      if (existing.length) submit({ t: "floor.paint", level: floorNow(), cells: existing, material: null });
    } else submit({ t: "floor.paint", level: floorNow(), cells, material: s.floorMaterial });
  } else if (s.tool === "roof") {
    const cells = cellsBetween(drag.start[0], drag.start[1], drag.end[0], drag.end[1]);
    const roofs = s.view.levels[floorNow()]!.roofs;
    if (s.roofErase) {
      const existing = cells.filter((c) => roofs[c]);
      if (existing.length) submit({ t: "roof.paint", level: floorNow(), cells: existing, style: null });
    } else {
      const changed = cells.filter((c) => roofs[c]?.style !== s.roofStyle);
      if (changed.length) submit({ t: "roof.paint", level: floorNow(), cells: changed, style: s.roofStyle });
    }
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
  const level = s.view?.levels[floorNow()];
  const opening = s.selection ? level?.openings[s.selection] : null;
  if (opening) {
    submit({ t: "opening.move", level: floorNow(), id: opening.id, dir: opening.dir, x: opening.x, z: opening.z, flip: !opening.flip });
    return;
  }
  const o = s.selection ? level?.objects[s.selection] : null;
  if (!o) return;
  const item = catalog.furniture.get(o.catalogId)!;
  const f = footprintOf(item, o);
  const rot = ((o.rot + 1) % 4) as Rot;
  const [w, d] = rotatedSize(item.footprint[0], item.footprint[1], rot);
  submit(withLanding({ t: "object.move", level: levelFor(o.catalogId), id: o.id, x: Math.round(f.x + f.w / 2 - w / 2), z: Math.round(f.z + f.d / 2 - d / 2), rot }, o.catalogId));
}

export function deleteSelected() {
  const s = useGame.getState();
  if (!s.selection) return;
  const id = s.selection;
  select(null);
  if (s.view?.levels[floorNow()]?.openings[id]) submit({ t: "opening.remove", level: floorNow(), id });
  else submit({ t: "object.remove", level: floorNow(), id });
}

export function BuildTools() {
  const view = useGame((s) => s.view);
  const tool = useGame((s) => s.tool);
  const floor = useGame((s) => s.floor);
  const materialScope = useMaterialTools((s) => tool === "wall" || tool === "floor" ? s[tool] : "draw");
  const move = useBuild((s) => s.move);
  const plane = useMemo(() => new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), []);
  const downAt = useRef<[number, number] | null>(null);

  // Let go of a drag even if the pointer is released over the HUD or outside the window.
  useEffect(() => {
    const up = (e: PointerEvent) => {
      downAt.current = null;
      finishMaterialPaint(e);
      finishPlace(e);
      finishDrag();
      finishMove();
    };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancelMaterialPaint);
    return () => {
      cancelMaterialPaint();
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancelMaterialPaint);
    };
  }, []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!allowsBuildShortcut(e)) return;
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
        cancelMaterialPaint();
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
    const level = view?.levels[floorNow()];
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
    sharePresence({ cursor: pointer ? { x: pointer[0], z: pointer[1] } : null, tool, drag, level: floor });
  }, [pointer, move, tool, placing, view, floor]);

  const level = view?.levels[floor];
  if (!view || !level) return null;

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    const p = gridPoint(e);
    setB({ pointer: p });
    if (multiTouch()) return cancelForCamera();
    const s = useGame.getState();
    const { drag } = getB();
    let { move } = getB();
    if (move && !move.armed) {
      const travelled = Math.hypot(e.nativeEvent.clientX - move.from[0], e.nativeEvent.clientY - move.from[1]);
      if (travelled < DRAG_PX) return;
      move = { ...move, armed: true };
      setB({ move });
    }
    if (drag) {
      if (s.tool === "wall" || s.tool === "wallErase") setB({ drag: { ...drag, end: straighten(drag.start, cornerAt(p)) } });
      else setB({ drag: { ...drag, end: cellAt(p) } });
    }
    if (move?.kind === "opening") {
      const item = catalog.openings.get(s.view?.levels[floorNow()]?.openings[move.id]?.catalogId ?? "");
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
    if (multiTouch()) return cancelForCamera();
    if (e.button !== 0 || cameraGestureActive()) return;
    const p = gridPoint(e);
    const s = useGame.getState();
    downAt.current = p;
    if (queueMaterialPaint(floorUnder(e), [e.nativeEvent.clientX, e.nativeEvent.clientY])) return;
    switch (s.tool) {
      case "wall":
      case "wallErase": {
        const c = cornerAt(p);
        setB({ drag: { start: c, end: c } });
        break;
      }
      case "floor":
      case "floorErase":
      case "roof": {
        const c = cellAt(p);
        setB({ drag: { start: c, end: c } });
        break;
      }
      case "buy":
        if (s.placing) pendingPlace = { p, from: [e.nativeEvent.clientX, e.nativeEvent.clientY] };
        break;
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
    const o = s.view!.levels[floorNow()]!.objects[id]!;
    select(id);
    const c = cellAt(floorUnder(e));
    const from: [number, number] = [e.nativeEvent.clientX, e.nativeEvent.clientY];
    setB({ move: { kind: "object", id, offset: [o.x - c[0], o.z - c[1]], x: o.x, z: o.z, rot: o.rot, dir: "h", flip: false, from, armed: false, moved: false } });
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
    const o = s.view!.levels[floorNow()]!.openings[id]!;
    select(id);
    const from: [number, number] = [e.nativeEvent.clientX, e.nativeEvent.clientY];
    setB({ move: { kind: "opening", id, offset: [0, 0], x: o.x, z: o.z, rot: 0, dir: o.dir, flip: o.flip, from, armed: false, moved: false } });
  };

  return (
    // everything at the height of the floor being built on
    <group position-y={floor * STOREY}>
      <mesh geometry={plane} position={[0, 0.04, 0]} visible={false} onPointerMove={onMove} onPointerDown={onDown} onPointerLeave={() => setB({ pointer: null })} />
      <Walls level={level} base={floor * STOREY} hiddenOpening={move?.moved && move.kind === "opening" ? move.id : null} onOpeningDown={onOpeningDown} onWallDown={materialScope !== "draw" ? (run, e) => {
        if (e.button !== 0 || multiTouch() || cameraGestureActive()) return;
        queueMaterialPaint(tool === "floor" ? floorUnder(e) : [e.point.x, e.point.z], [e.nativeEvent.clientX, e.nativeEvent.clientY], edgeAtWall(run, e.point));
      } : undefined} />
      <Furniture objects={level.objects} hidden={move?.moved && move.kind === "object" ? move.id : null} onObjectDown={onObjectDown} />
      <Roofs roofs={openRoofs(view, floor)} />
      {tool !== "select" && <Grid w={view.lot.w} d={view.lot.d} y={tool === "roof" ? ROOF_BASE + 0.01 : 0.05} />}
      <Previews />
    </group>
  );
}

function Grid({ w, d, y }: { w: number; d: number; y: number }) {
  const geo = useMemo(() => {
    const pts: number[] = [];
    for (let x = 0; x <= w; x++) pts.push(x, y, 0, x, y, d);
    for (let z = 0; z <= d; z++) pts.push(0, y, z, w, y, z);
    return new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  }, [w, d, y]);
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
  const level = useGame((s) => s.view?.levels[s.floor]);

  const wallPreview = useMemo(() => {
    if (!drag || (tool !== "wall" && tool !== "wallErase")) return null;
    const edges = edgesBetween(drag.start[0], drag.start[1], drag.end[0], drag.end[1]);
    return edges.length ? Object.fromEntries(edges.map((e) => [e, { style: "preview" }])) : null;
  }, [drag, tool]);

  if ((tool === "wall" || tool === "floor") && useMaterialTools.getState()[tool] !== "draw") return <MaterialTargets pointer={pointer} />;
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

  if (tool === "roof" && level) {
    const erase = useGame.getState().roofErase;
    const color = erase ? "#c4534a" : "#6f9e5c";
    const [ax, az] = drag ? drag.start : pointer ? cellAt(pointer) : [0, 0];
    const [bx, bz] = drag ? drag.end : [ax, az];
    if (drag || pointer) {
      const x0 = Math.min(ax, bx);
      const z0 = Math.min(az, bz);
      out.push(<FootprintMarker key="roof" x={x0} z={z0} w={Math.abs(bx - ax) + 1} d={Math.abs(bz - az) + 1} color={color} at={ROOF_BASE} onTop opacity={drag ? 0.9 : 0.6} />);
    }
    // while adding, a see-through roof shows the shape it'll make
    if (drag && !erase) out.push(<RoofGhost key="roofghost" roofs={level.roofs} cells={cellsBetween(drag.start[0], drag.start[1], drag.end[0], drag.end[1])} />);
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

const roofGhostMat = new THREE.MeshBasicMaterial({ color: "#9ccf8a", transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide });

/** The roof as it would be with these cells added, see-through. */
function RoofGhost({ roofs, cells }: { roofs: Record<string, { style: string }>; cells: string[] }) {
  const key = cells.join(",");
  return (
    <KitMesh
      deps={[roofs, key]}
      make={(k) => {
        const next = { ...roofs };
        for (const c of cells) next[c] = { style: "ghost" };
        buildRoof(k, next, roofGhostMat);
      }}
    />
  );
}

/** See-through furniture with a green (fits) or red (doesn't) footprint. */
export function Ghost({ catalogId, x, z, rot, ignore, color, level }: { catalogId: string; x: number; z: number; rot: Rot; ignore: string | null; color?: string; level?: number }) {
  const { item, f, position, rotationY } = objectTransform({ catalogId, x, z, rot });
  const ok = problemAt(catalogId, x, z, rot, ignore, level) === null;
  const tint = color ?? (ok ? "#6f9e5c" : "#c4534a");
  return (
    <group>
      <group position={position} rotation-y={rotationY}>
        <Meshes meshes={modelFor(item, ok ? "ok" : "bad")} raycast={false} />
      </group>
      <FootprintMarker {...f} color={tint} />
      {/* stairs: where you step on, and off at the top */}
      {isStairs(item) &&
        flightOf(item, { x, z, rot }).lanes.map((l, i) => (
          <group key={i}>
            <FootprintMarker x={l.entry[0]} z={l.entry[1]} w={1} d={1} color={tint} opacity={0.35} />
            <FootprintMarker x={l.exit[0]} z={l.exit[1]} w={1} d={1} color={tint} opacity={0.35} at={STOREY} />
          </group>
        ))}
      {/* a lift: where you wait at its doors */}
      {isLift(item) && shaftOf(item, { x, z, rot }).front.map(([fx, fz], i) => <FootprintMarker key={`door${i}`} x={fx} z={fz} w={1} d={1} color={tint} opacity={0.35} />)}
    </group>
  );
}

/** A strip of floor either side of a door or window, for selection and hold markers. */
export function openingFootprint(o: Pick<PlacedOpening, "dir" | "x" | "z">, item: OpeningItem) {
  return o.dir === "h" ? { x: o.x, z: o.z - 0.3, w: item.width, d: 0.6 } : { x: o.x - 0.3, z: o.z, w: 0.6, d: item.width };
}

/** A see-through door or window snapped to a wall, green if it fits there and red if not. */
export function OpeningGhost({ catalogId, dir, x, z, flip, ignore, color, on }: { catalogId: string; dir: "h" | "v"; x: number; z: number; flip: boolean; ignore: string | null; color?: string; on?: number }) {
  const item = catalog.openings.get(catalogId);
  const level = useGame((s) => s.view?.levels[on ?? s.floor]);
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
