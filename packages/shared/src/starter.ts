import { z } from "zod";
import starterData from "./catalog/starter.json";
import { cellsBetween, edgesBetween, type Rot } from "./grid";
import { newId } from "./ids";
import type { Op, SingleOp } from "./ops";

/**
 * The optional starter house is data, like the catalog: walls as straight lines, floors as rectangles of cells,
 * then doors, windows and furniture. It becomes one batch op, so it lands (or fails) in one go and can be undone.
 */

const n = z.number().int();
const Template = z.object({
  name: z.string(),
  lot: z.tuple([n, n]),
  walls: z.array(z.tuple([n, n, n, n, z.string()])),
  floors: z.array(z.tuple([n, n, n, n, z.string()])),
  openings: z.array(z.tuple([z.string(), z.enum(["h", "v"]), n, n, z.boolean()])),
  objects: z.array(z.tuple([z.string(), n, n, z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)])])),
});

export const starterTemplate = Template.parse(starterData);

/** The starter house as a single batch, with fresh IDs each time. */
export function starterHouseOp(level = 0, makeId: () => string = newId): Op {
  const t = starterTemplate;
  const ops: SingleOp[] = [];
  for (const [x1, z1, x2, z2, style] of t.walls) ops.push({ t: "walls.add", level, edges: edgesBetween(x1, z1, x2, z2), style });
  for (const [x1, z1, x2, z2, material] of t.floors) ops.push({ t: "floor.paint", level, cells: cellsBetween(x1, z1, x2, z2), material });
  for (const [catalogId, dir, x, zz, flip] of t.openings) ops.push({ t: "opening.place", level, id: makeId(), catalogId, dir, x, z: zz, flip });
  for (const [catalogId, x, zz, rot] of t.objects) ops.push({ t: "object.place", level, id: makeId(), catalogId, x, z: zz, rot: rot as Rot });
  return { t: "batch", ops };
}
