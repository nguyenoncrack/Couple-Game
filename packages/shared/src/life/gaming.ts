import type { Level, PlacedObject } from "../blueprint";
import { catalog as defaultCatalog, type Catalog } from "../catalog";
import { parseEdge } from "../grid";
import { canSee, screenOf, seatsFacing, slotsOf, toWorld, type PlacedSlot } from "./interactions";
import { walkable, type Nav } from "./nav";

/** An opening in a wall is already absent from nav.walls, so a screen can be seen through a doorway. */
function clearView(nav: Nav, pose: PlacedSlot["pose"], screen: { x: number; z: number }) {
  const dx = screen.x - pose.x, dz = screen.z - pose.z;
  for (const key of nav.walls) {
    const e = parseEdge(key);
    if (!e) continue;
    const delta = e.dir === "h" ? dz : dx;
    if (Math.abs(delta) < 1e-8) continue;
    const t = ((e.dir === "h" ? e.z - pose.z : e.x - pose.x)) / delta;
    const along = e.dir === "h" ? pose.x + t * dx : pose.z + t * dz;
    const start = e.dir === "h" ? e.x : e.z;
    if (t > 0 && t < 1 && along >= start && along <= start + 1) return false;
  }
  return true;
}

/** The console uses the physically closest TV; seats and floor spots must actually face and see that screen. */
export function gamingSpots(level: Level, console: PlacedObject, nav: Nav, cat: Catalog = defaultCatalog) {
  const item = cat.furniture.get(console.catalogId);
  if (!item) return null;
  const [x, z] = toWorld(item, console, item.footprint[0] / 2, item.footprint[1] / 2);
  const screens = Object.values(level.objects).flatMap((o) => {
    const screen = screenOf(o, cat);
    return screen ? [{ o, screen, distance: Math.hypot(screen.x - x, screen.z - z) }] : [];
  }).sort((a, b) => a.distance - b.distance || a.o.id.localeCompare(b.o.id));
  const closest = screens[0];
  if (!closest) return null;
  const { o: tv, screen } = closest;
  return {
    tv,
    seats: seatsFacing(level, tv, cat).filter((s) => clearView(nav, s.pose, screen)),
    floor: slotsOf(tv, "watch", cat)
      .filter((s) => canSee(s, tv, cat) && clearView(nav, s.pose, screen) && walkable(nav, Math.floor(s.pose.x), Math.floor(s.pose.z)))
      // Floor spots require a path to that exact spot; don't settle inside a blocked or enclosed cell.
      .map((s) => ({ ...s, around: [] })),
  };
}
