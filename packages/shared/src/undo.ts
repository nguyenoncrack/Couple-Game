import type { Blueprint, Level } from "./blueprint";
import { catalog as defaultCatalog, type Catalog } from "./catalog";
import { applyOp, edgesOfOpening } from "./rules";
import type { Op, SingleOp } from "./ops";

/**
 * Undo is just another op: the inverse of what you did, sent like any edit, so your partner sees it and the
 * server checks it. `inverseOp` works it out from the house as it was before the edit. `undoCheck` fingerprints
 * everything an edit touched; if that fingerprint changes before you undo (your partner moved the sofa you
 * placed), the undo is refused instead of trampling their edit.
 */

function groupBy<T>(items: T[], key: (t: T) => string | null): Map<string | null, T[]> {
  const m = new Map<string | null, T[]>();
  for (const it of items) {
    const k = key(it);
    const list = m.get(k);
    if (list) list.push(it);
    else m.set(k, [it]);
  }
  return m;
}

/** Doors and windows on any of these edges. */
function openingsOn(level: Level, edges: Set<string>, cat: Catalog) {
  return Object.values(level.openings).filter((o) => {
    const item = cat.openings.get(o.catalogId);
    return item !== undefined && edgesOfOpening(item, o).some((e) => edges.has(e));
  });
}

function inverseSingle(bp: Blueprint, op: SingleOp, cat: Catalog): SingleOp[] {
  const level = bp.levels[op.level];
  if (!level) return [];
  const L = op.level;

  switch (op.t) {
    case "walls.add": {
      const out: SingleOp[] = [];
      const fresh = op.edges.filter((e) => !level.walls[e]);
      if (fresh.length) out.push({ t: "walls.remove", level: L, edges: fresh });
      const restyled = op.edges.filter((e) => level.walls[e] && level.walls[e].style !== op.style);
      for (const [style, edges] of groupBy(restyled, (e) => level.walls[e]!.style)) out.push({ t: "walls.add", level: L, edges, style: style! });
      return out;
    }
    case "walls.remove": {
      const out: SingleOp[] = [];
      const had = op.edges.filter((e) => level.walls[e]);
      for (const [style, edges] of groupBy(had, (e) => level.walls[e]!.style)) out.push({ t: "walls.add", level: L, edges, style: style! });
      // Put back the doors and windows that went with the wall.
      for (const o of openingsOn(level, new Set(had), cat)) out.push({ t: "opening.place", level: L, ...o });
      return out;
    }
    case "floor.paint": {
      const out: SingleOp[] = [];
      const changed = op.cells.filter((c) => (level.tiles[c]?.material ?? null) !== op.material);
      for (const [material, cells] of groupBy(changed, (c) => level.tiles[c]?.material ?? null)) out.push({ t: "floor.paint", level: L, cells, material });
      return out;
    }
    case "roof.paint": {
      const out: SingleOp[] = [];
      const changed = op.cells.filter((c) => (level.roofs[c]?.style ?? null) !== op.style);
      for (const [style, cells] of groupBy(changed, (c) => level.roofs[c]?.style ?? null)) out.push({ t: "roof.paint", level: L, cells, style });
      return out;
    }
    case "object.place":
      return [{ t: "object.remove", level: L, id: op.id }];
    case "object.move": {
      const o = level.objects[op.id];
      return o ? [{ t: "object.move", level: L, id: o.id, x: o.x, z: o.z, rot: o.rot }] : [];
    }
    case "object.remove": {
      const o = level.objects[op.id];
      return o ? [{ t: "object.place", level: L, ...o }] : [];
    }
    case "opening.place":
      return [{ t: "opening.remove", level: L, id: op.id }];
    case "opening.move": {
      const o = level.openings[op.id];
      return o ? [{ t: "opening.move", level: L, id: o.id, dir: o.dir, x: o.x, z: o.z, flip: o.flip }] : [];
    }
    case "opening.remove": {
      const o = level.openings[op.id];
      return o ? [{ t: "opening.place", level: L, ...o }] : [];
    }
  }
}

/** The op that undoes `op`, given the house just before it. Null if it changed nothing. */
export function inverseOp(before: Blueprint, op: Op, cat: Catalog = defaultCatalog): Op | null {
  const steps = op.t === "batch" ? op.ops : [op];
  const out: SingleOp[][] = [];
  let cur = before;
  for (const step of steps) {
    out.push(inverseSingle(cur, step, cat));
    const r = applyOp(cur, step, cat);
    if (!r.ok) return null;
    cur = r.blueprint;
  }
  // Undo the last step first.
  const flat = out.reverse().flat();
  if (flat.length === 0) return null;
  if (flat.length === 1) return flat[0]!;
  if (flat.length > 400) return null;
  return { t: "batch", ops: flat };
}

/** A fingerprint of everything `op` touches, read from `bp`. Equal fingerprints mean nobody changed those things. */
export function undoCheck(bp: Blueprint, op: Op, cat: Catalog = defaultCatalog): string {
  const parts: unknown[] = [];
  for (const s of op.t === "batch" ? op.ops : [op]) {
    const level = bp.levels[s.level];
    if (!level) continue;
    switch (s.t) {
      case "walls.add":
      case "walls.remove": {
        parts.push(s.edges.map((e) => level.walls[e]?.style ?? null));
        parts.push(openingsOn(level, new Set(s.edges), cat).map((o) => o.id).sort());
        break;
      }
      case "floor.paint":
        parts.push(s.cells.map((c) => level.tiles[c]?.material ?? null));
        break;
      case "roof.paint":
        parts.push(s.cells.map((c) => level.roofs[c]?.style ?? null));
        break;
      case "object.place":
      case "object.move":
      case "object.remove":
        parts.push(level.objects[s.id] ?? null);
        break;
      case "opening.place":
      case "opening.move":
      case "opening.remove":
        parts.push(level.openings[s.id] ?? null);
        break;
    }
  }
  return JSON.stringify(parts);
}
