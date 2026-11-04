import { campLayout, lakeShape } from "./sceneryLayout";
import { shoreLayout } from "./shoreLayout";
import { nearTrail, trailNetwork } from "./trailLayout";

/**
 * Little scenes that make the countryside look lived in, each gathered round a place people already go rather
 * than strewn about: the cabin's yard (a bicycle against the wall, a flower bed with its watering can, a
 * birdhouse), a woodpile by the fire circle, a picnic on the grass above the lake with a lantern on a hook,
 * more lanterns by the chairs and the jetty, a mailbox at the pavement and a ball left in the playground.
 * Worked out from the lot's size alone, like the rest of the scenery.
 */

type XZ = [number, number];

/** Where a prop stands and which way it faces (turned this far about y; 0 faces +z). */
export interface Placed {
  x: number;
  z: number;
  ry: number;
}

export interface Scenes {
  bicycle: Placed;
  flowerBed: Placed;
  wateringCan: Placed;
  birdhouse: Placed;
  woodpile: Placed;
  picnic: Placed;
  lanterns: Placed[];
  mailbox: Placed;
  ball: Placed;
  /** Ground the meadow grass and the woods keep off. */
  clearings: { x: number; z: number; r: number }[];
}

const made = new Map<string, Scenes>();

export function scenesLayout(w: number, d: number): Scenes {
  const key = `${w}:${d}`;
  let scenes = made.get(key);
  if (!scenes) made.set(key, (scenes = makeScenes(w, d)));
  return scenes;
}

function makeScenes(w: number, d: number): Scenes {
  const { cabin, fire } = campLayout(d);
  const lake = lakeShape(w);
  const net = trailNetwork(w, d);
  const on = nearTrail(net);
  const shore = shoreLayout(w, d);

  // the cabin's side wall that faces the street and the fire (+z), with its window in the middle: the bicycle
  // leans on the wall beside the window, a flower bed under it and a birdhouse by the corner. The porch, the
  // trails and the firewood are all on the other sides.
  const wallZ = cabin.z + 1.8 + 0.12;
  const bicycle = { x: cabin.x - 1.3, z: wallZ + 0.3, ry: 0 };
  const flowerBed = { x: cabin.x + 0.15, z: wallZ + 0.8, ry: 0 };
  const wateringCan = { x: cabin.x + 1.35, z: wallZ + 1.3, ry: -0.7 };
  const birdhouse = { x: cabin.x - 2.5, z: wallZ + 1.5, ry: 0.5 };

  // the woodpile on the far side of the fire circle from both trails, end-on to the fire
  const woodpile = { x: fire[0] - 3.7, z: fire[2] + 0.4, ry: Math.PI / 2 };

  // the picnic: the open grass above the lake a little east of the jetty, wherever there's room enough clear of
  // the trails, the water and the shore's things, nearest that spot
  const near: XZ = [shore.dock.x + 6.5, shore.dock.shoreZ + 1.5];
  let picnic = near;
  let best = -Infinity;
  for (let x = shore.dock.x + 3; x <= shore.dock.x + 12; x += 0.25)
    for (let z = shore.dock.shoreZ - 1; z <= shore.dock.shoreZ + 6; z += 0.25) {
      if (lake.inside(x, z, 1.6)) continue;
      let room = 3;
      for (let r = 0.25; r < 3; r += 0.25)
        if (on(x, z, r)) {
          room = r;
          break;
        }
      for (const c of [...shore.clearings, ...net.open, ...shore.rocks.map((s) => ({ ...s, r: s.r * 1.6 })), ...net.patches.map((p) => ({ ...p, r: p.radius }))])
        room = Math.min(room, Math.hypot(c.x - x, c.z - z) - c.r);
      const score = Math.min(room, 2.5) - 0.05 * Math.hypot(x - near[0], z - near[1]);
      if (score > best) [best, picnic] = [score, [x, z]];
    }
  // the blanket's long side faces the water
  const toWater = Math.atan2(lake.cx - picnic[0], lake.cz - picnic[1]);

  const lanterns: Placed[] = [
    // (a lantern's hook reaches out along its +x) by the picnic, behind one corner, hanging over the blanket
    { x: picnic[0] - Math.sin(toWater) * 1.4 + Math.cos(toWater) * 0.9, z: picnic[1] - Math.cos(toWater) * 1.4 - Math.sin(toWater) * 0.9, ry: toWater + Math.PI },
    // beside the chairs, toward them, and at the jetty's foot opposite the life ring, away from the boards
    { x: shore.seat.x + Math.cos(shore.seat.facing + Math.PI / 2) * 1.5, z: shore.seat.z + Math.sin(shore.seat.facing + Math.PI / 2) * 1.5, ry: Math.PI / 2 - shore.seat.facing },
    { x: shore.dock.x + 0.98, z: shore.dock.shoreZ + 0.75, ry: 0 },
  ];

  // the mailbox just outside the lot's front corner, beside the pavement, facing the street
  const mailbox = { x: -1.3, z: d + 0.5, ry: 0 };
  // a ball left on the bark between the bottom of the slide and the swings
  const ball = { x: w + 5.3, z: d / 2 + 3.1, ry: 0 };

  const clearings = [
    { x: picnic[0], z: picnic[1], r: 1.6 },
    { x: woodpile.x, z: woodpile.z, r: 1.2 },
    { x: flowerBed.x, z: flowerBed.z, r: 1.0 },
    { x: birdhouse.x, z: birdhouse.z, r: 0.4 },
    { x: mailbox.x, z: mailbox.z, r: 0.5 },
    ...lanterns.map((l) => ({ x: l.x, z: l.z, r: 0.4 })),
  ];
  return { bicycle, flowerBed, wateringCan, birdhouse, woodpile, picnic: { x: picnic[0], z: picnic[1], ry: toWater }, lanterns, mailbox, ball, clearings };
}
