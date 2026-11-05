import { catalog, cellKey, liftShafts, parseCell, stairHoles, STOREY, type Blueprint, type Level } from "@cg/shared";
import { useMemo } from "react";
import { roofVisible, useGame } from "../state/game";
import { Floors, Furniture, Walls } from "./House";
import { Roofs } from "./Roof";

/**
 * A house of more than one floor, stacked `STOREY` apart. The floor you're on is drawn by the build or live tools
 * (where you can click things); this draws the floor tiles of every floor up to it, and the floors below it as they
 * are, walls up. Floors above the one you're on are hidden, so you can see in, unless the roof's on: then it's the
 * whole house, every floor, from outside.
 */

/** The top floor drawn: the one you're on, or with the roof on, the top of the house. */
export function topShown(s: Parameters<typeof roofVisible>[0]) {
  const n = s.view?.levels.length ?? 1;
  return roofVisible(s) ? n - 1 : Math.min(s.floor, n - 1);
}

const nothing = () => {};

/** A floor's roof, less the bits a floor above has been built over. */
export function openRoofs(bp: Blueprint, index: number): Level["roofs"] {
  const level = bp.levels[index];
  const above = bp.levels[index + 1]?.tiles;
  if (!level) return {};
  if (!above || !Object.keys(above).length) return level.roofs;
  const out: Level["roofs"] = {};
  for (const [key, r] of Object.entries(level.roofs)) {
    const c = parseCell(key);
    if (c && !above[cellKey(c.x, c.z)]) out[key] = r;
  }
  return out;
}

/** A floor's tiles, less the holes over stairs coming up from below and for lift shafts going through. */
export function floorTiles(bp: Blueprint, index: number): Level["tiles"] {
  const tiles = bp.levels[index]?.tiles ?? {};
  const holes = stairHoles(bp, index, catalog);
  for (const c of liftShafts(bp, index, catalog)) holes.add(c);
  if (!holes.size) return tiles;
  return Object.fromEntries(Object.entries(tiles).filter(([key]) => !holes.has(key)));
}

export function Storeys() {
  const view = useGame((s) => s.view);
  const floor = useGame((s) => s.floor);
  const top = useGame(topShown);
  if (!view) return null;
  return (
    <>
      {view.levels.slice(0, top + 1).map((_, i) => (
        <group key={i} position-y={i * STOREY}>
          <StoreyFloor bp={view} index={i} />
          {i !== floor && <Below bp={view} index={i} />}
        </group>
      ))}
    </>
  );
}

function StoreyFloor({ bp, index }: { bp: Blueprint; index: number }) {
  const tiles = useMemo(() => floorTiles(bp, index), [bp, index]);
  return <Floors tiles={tiles} slab={index > 0} />;
}

/** A floor other than the one you're on (under it, or over it with the roof on): furniture and all, walls standing, nothing to click. */
function Below({ bp, index }: { bp: Blueprint; index: number }) {
  const level = bp.levels[index]!;
  const roofs = useMemo(() => openRoofs(bp, index), [bp, index]);
  return (
    <>
      <Walls level={level} base={index * STOREY} standing hiddenOpening={null} onOpeningDown={nothing} />
      <Furniture objects={level.objects} hidden={null} onObjectDown={nothing} />
      <Roofs roofs={roofs} />
    </>
  );
}
