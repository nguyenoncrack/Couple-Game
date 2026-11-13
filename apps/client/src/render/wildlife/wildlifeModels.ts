import * as THREE from "three";
import { Kit, type BuiltMesh } from "../kit";
import { natureMaterial } from "../nature";
import type { Act, Species } from "./wildlifeLayout";

/**
 * The wildlife's models and how they move. Each animal is a few parts (a body, a head, the legs in two diagonal
 * pairs, a tail), each its own instanced mesh, so a whole countryside of them is a few dozen draw calls. Models
 * stand on y = 0 facing +z; `animate` turns what an animal is doing into small turns of its parts about their
 * pivots. All soft, matte, and drawn with the same sunlight as the trees.
 */

type V3 = [number, number, number];
type Mat = (tone: string) => THREE.Material;

export interface PartSpec {
  id: string;
  /** What the part turns about. */
  pivot: V3;
  build: (k: Kit, m: Mat) => void;
}

const fur: Mat = (tone) => natureMaterial(tone, { finish: "foliage" });
const dark = "#2a2420";

/** A leg: a thin stick from the hip down to the ground, with a dark foot. */
function leg(k: Kit, m: Mat, x: number, z: number, hip: number, thick: number, coat: string, foot = dark, sock = 0.06) {
  k.add("cyl8", m(coat), [x, hip / 2 + 0.02, z], [thick, hip - 0.04, thick], { outline: false });
  k.add("cyl8", m(foot), [x, sock / 2, z + 0.005], [thick * 1.25, sock, thick * 1.4], { outline: false });
}

function deerParts(coat: string, belly: string, opts: { spots?: boolean; antlers?: boolean } = {}): PartSpec[] {
  const legsA = (k: Kit, m: Mat) => {
    leg(k, m, 0.12, 0.32, 0.56, 0.09, coat);
    leg(k, m, -0.12, -0.36, 0.56, 0.09, coat);
  };
  const legsB = (k: Kit, m: Mat) => {
    leg(k, m, -0.12, 0.32, 0.56, 0.09, coat);
    leg(k, m, 0.12, -0.36, 0.56, 0.09, coat);
  };
  return [
    {
      id: "body",
      pivot: [0, 0.66, 0],
      build: (k, m) => {
        k.add("sphere", m(coat), [0, 0.68, 0], [0.44, 0.44, 1.0]);
        k.add("sphere", m(coat), [0, 0.69, -0.4], [0.42, 0.44, 0.46]);
        k.add("sphere", m(belly), [0, 0.54, 0.05], [0.34, 0.24, 0.82]);
        k.add("cyl8", m(coat), [0, 0.9, 0.5], [0.19, 0.46, 0.22], { rot: [0.62, 0, 0], outline: false });
        k.add("sphere", m("#f3ecdc"), [0, 0.8, -0.63], [0.15, 0.17, 0.11]);
        if (opts.spots) for (const [x, y, z] of [[0.15, 0.88, -0.1], [-0.13, 0.9, 0.15], [0.11, 0.87, 0.32], [-0.16, 0.85, -0.3], [0.05, 0.91, -0.4], [-0.04, 0.92, 0.02]] as V3[]) k.add("sphere", m("#f6efe0"), [x, y, z], 0.055);
      },
    },
    {
      id: "head",
      pivot: [0, 1.06, 0.64],
      build: (k, m) => {
        k.add("sphere", m(coat), [0, 1.1, 0.78], [0.19, 0.21, 0.32]);
        k.add("sphere", m(belly), [0, 1.03, 0.97], [0.12, 0.11, 0.16]);
        k.add("sphere", m(dark), [0, 1.05, 1.06], 0.045);
        for (const s of [-1, 1]) {
          k.add("sphere", m(coat), [s * 0.14, 1.26, 0.7], [0.06, 0.16, 0.08], { rot: [0.3, 0, s * 0.55] });
          k.add("sphere", m("#1d1a17"), [s * 0.1, 1.14, 0.9], 0.026);
        }
        if (opts.antlers)
          for (const s of [-1, 1]) {
            const horn = m("#d8c6a0");
            k.add("cyl8", horn, [s * 0.11, 1.38, 0.66], [0.035, 0.32, 0.035], { rot: [0.2, 0, -s * 0.3], outline: false });
            k.add("cyl8", horn, [s * 0.2, 1.47, 0.72], [0.03, 0.2, 0.03], { rot: [0.7, 0, -s * 0.5], outline: false });
            k.add("cyl8", horn, [s * 0.18, 1.5, 0.6], [0.03, 0.16, 0.03], { rot: [-0.5, 0, -s * 0.3], outline: false });
          }
      },
    },
    { id: "legsA", pivot: [0, 0.56, 0], build: legsA },
    { id: "legsB", pivot: [0, 0.56, 0], build: legsB },
  ];
}

const FOX = { coat: "#d0672a", white: "#f4ecdc", sock: "#2b2420" };

export const SPECIES: Record<Species, PartSpec[]> = {
  deer: deerParts("#b27a4b", "#e9dcc2"),
  buck: deerParts("#a9714a", "#e4d6bb", { antlers: true }),
  fawn: deerParts("#c18a58", "#efe3cb", { spots: true }),

  rabbit: [
    {
      id: "body",
      pivot: [0, 0.15, 0],
      build: (k, m) => {
        k.add("sphere", m("#a99079"), [0, 0.16, 0.02], [0.2, 0.19, 0.3]);
        k.add("sphere", m("#a08670"), [0, 0.17, -0.12], [0.22, 0.22, 0.24]);
        k.add("sphere", m("#f4efe6"), [0, 0.2, -0.26], 0.075);
        for (const s of [-1, 1]) k.add("sphere", m("#8c7561"), [s * 0.08, 0.04, 0.12], [0.05, 0.05, 0.14]);
      },
    },
    {
      id: "head",
      pivot: [0, 0.22, 0.13],
      build: (k, m) => {
        k.add("sphere", m("#ab927b"), [0, 0.27, 0.18], [0.13, 0.12, 0.17]);
        k.add("sphere", m("#efe7dc"), [0, 0.24, 0.28], [0.06, 0.05, 0.05]);
        k.add("sphere", m("#d9a3a0"), [0, 0.255, 0.31], 0.018);
        for (const s of [-1, 1]) {
          k.add("sphere", m("#9d8570"), [s * 0.04, 0.4, 0.1], [0.04, 0.18, 0.05], { rot: [-0.2, 0, s * 0.12] });
          k.add("sphere", m("#2a211c"), [s * 0.06, 0.29, 0.25], 0.018);
        }
      },
    },
  ],

  squirrel: [
    {
      id: "body",
      pivot: [0, 0.12, 0],
      build: (k, m) => {
        k.add("sphere", m("#b5562c"), [0, 0.12, 0], [0.1, 0.11, 0.2]);
        k.add("sphere", m("#b0522a"), [0, 0.13, -0.08], [0.11, 0.12, 0.13]);
        k.add("sphere", m("#f0dcc0"), [0, 0.09, 0.07], [0.07, 0.07, 0.1]);
        for (const s of [-1, 1]) {
          k.add("sphere", m("#a24a24"), [s * 0.045, 0.025, 0.07], [0.04, 0.04, 0.08]);
          k.add("sphere", m("#a24a24"), [s * 0.05, 0.03, -0.07], [0.045, 0.05, 0.11]);
        }
        k.add("sphere", m("#bc5d31"), [0, 0.2, 0.13], 0.09);
        k.add("sphere", m("#f0dcc0"), [0, 0.18, 0.2], [0.04, 0.035, 0.04]);
        for (const s of [-1, 1]) {
          k.add("sphere", m("#a24a24"), [s * 0.05, 0.28, 0.12], [0.025, 0.045, 0.02]);
          k.add("sphere", m("#201a17"), [s * 0.04, 0.215, 0.185], 0.014);
        }
      },
    },
    {
      id: "tail",
      pivot: [0, 0.15, -0.14],
      build: (k, m) => {
        k.add("sphere", m("#c46a34"), [0, 0.17, -0.16], [0.09, 0.11, 0.14]);
        k.add("sphere", m("#c76d37"), [0, 0.28, -0.21], [0.11, 0.16, 0.14]);
        k.add("sphere", m("#cf7a42"), [0, 0.4, -0.19], [0.12, 0.16, 0.14]);
        k.add("sphere", m("#d98a50"), [0, 0.5, -0.12], [0.1, 0.12, 0.13]);
      },
    },
  ],

  fox: [
    {
      id: "body",
      pivot: [0, 0.4, 0],
      build: (k, m) => {
        k.add("sphere", m(FOX.coat), [0, 0.42, 0], [0.24, 0.26, 0.6]);
        k.add("sphere", m(FOX.coat), [0, 0.42, -0.24], [0.25, 0.27, 0.3]);
        k.add("sphere", m(FOX.white), [0, 0.34, 0.2], [0.2, 0.18, 0.2]);
        k.add("cyl8", m(FOX.coat), [0, 0.52, 0.3], [0.16, 0.28, 0.17], { rot: [0.7, 0, 0], outline: false });
      },
    },
    {
      id: "head",
      pivot: [0, 0.55, 0.35],
      build: (k, m) => {
        k.add("sphere", m(FOX.coat), [0, 0.59, 0.43], [0.16, 0.15, 0.2]);
        k.add("sphere", m(FOX.white), [0, 0.54, 0.5], [0.13, 0.08, 0.1]);
        k.add("cone", m(FOX.coat), [0, 0.55, 0.61], [0.09, 0.2, 0.08], { rot: [Math.PI / 2, 0, 0], outline: false });
        k.add("sphere", m(dark), [0, 0.56, 0.72], 0.032);
        for (const s of [-1, 1]) {
          k.add("cone", m(FOX.coat), [s * 0.075, 0.71, 0.4], [0.11, 0.17, 0.05], { outline: false });
          k.add("cone", m(FOX.sock), [s * 0.075, 0.76, 0.4], [0.06, 0.08, 0.03], { outline: false });
          k.add("sphere", m("#1d1a17"), [s * 0.07, 0.62, 0.54], 0.018);
        }
      },
    },
    {
      id: "tail",
      pivot: [0, 0.44, -0.4],
      build: (k, m) => {
        k.add("sphere", m(FOX.coat), [0, 0.4, -0.58], [0.14, 0.14, 0.4], { rot: [0.35, 0, 0] });
        k.add("sphere", m(FOX.white), [0, 0.34, -0.8], [0.12, 0.12, 0.2], { rot: [0.35, 0, 0] });
      },
    },
    {
      id: "legsA",
      pivot: [0, 0.38, 0],
      build: (k, m) => {
        leg(k, m, 0.08, 0.2, 0.38, 0.065, FOX.coat, FOX.sock, 0.2);
        leg(k, m, -0.08, -0.22, 0.38, 0.065, FOX.coat, FOX.sock, 0.2);
      },
    },
    {
      id: "legsB",
      pivot: [0, 0.38, 0],
      build: (k, m) => {
        leg(k, m, -0.08, 0.2, 0.38, 0.065, FOX.coat, FOX.sock, 0.2);
        leg(k, m, 0.08, -0.22, 0.38, 0.065, FOX.coat, FOX.sock, 0.2);
      },
    },
  ],

  hedgehog: [
    {
      id: "body",
      pivot: [0, 0.1, 0],
      build: (k, m) => {
        k.add("blob", m("#6c5845"), [0, 0.11, -0.02], [0.24, 0.17, 0.3]);
        k.add("blob", m("#80694f"), [0, 0.15, -0.04], [0.2, 0.12, 0.24]);
        k.add("sphere", m("#dcc3a0"), [0, 0.07, 0.16], [0.12, 0.1, 0.14]);
        k.add("sphere", m(dark), [0, 0.075, 0.245], 0.02);
        for (const s of [-1, 1]) k.add("sphere", m(dark), [s * 0.04, 0.1, 0.205], 0.014);
        for (const s of [-1, 1]) k.add("sphere", m("#cbb08c"), [s * 0.07, 0.015, 0.1], [0.04, 0.03, 0.06]);
      },
    },
  ],

  frog: [
    {
      id: "body",
      pivot: [0, 0.04, 0],
      build: (k, m) => {
        k.add("sphere", m("#5da349"), [0, 0.05, 0], [0.1, 0.07, 0.13]);
        k.add("sphere", m("#e9e29a"), [0, 0.035, 0.015], [0.07, 0.04, 0.09]);
        for (const s of [-1, 1]) {
          k.add("sphere", m("#6cb356"), [s * 0.035, 0.1, 0.06], 0.03);
          k.add("sphere", m(dark), [s * 0.035, 0.108, 0.075], 0.013);
          k.add("sphere", m("#4f9140"), [s * 0.07, 0.025, -0.05], [0.03, 0.035, 0.1]);
        }
      },
    },
  ],

  sparrow: [
    {
      id: "body",
      pivot: [0, 0.06, 0],
      build: (k, m) => {
        k.add("sphere", m("#9a7452"), [0, 0.06, 0], [0.1, 0.09, 0.17]);
        k.add("sphere", m("#e6dccb"), [0, 0.045, 0.03], [0.07, 0.06, 0.1]);
        k.add("sphere", m("#8e8a84"), [0, 0.105, 0.075], 0.065);
        k.add("cone", m("#c9a15a"), [0, 0.1, 0.122], [0.025, 0.04, 0.025], { rot: [Math.PI / 2, 0, 0], outline: false });
        k.add("sphere", m(dark), [0.025, 0.112, 0.1], 0.01);
        k.add("sphere", m(dark), [-0.025, 0.112, 0.1], 0.01);
        k.add("box", m("#7b5c40"), [0, 0.055, -0.13], [0.045, 0.012, 0.11]);
        for (const s of [-1, 1]) k.add("cyl8", m("#b99b86"), [s * 0.015, 0.012, 0.0], [0.006, 0.03, 0.006], { outline: false });
      },
    },
    { id: "wingL", pivot: [0.05, 0.075, 0], build: (k, m) => void k.add("sphere", m("#7f5f43"), [0.075, 0.075, -0.015], [0.015, 0.05, 0.12]) },
    { id: "wingR", pivot: [-0.05, 0.075, 0], build: (k, m) => void k.add("sphere", m("#7f5f43"), [-0.075, 0.075, -0.015], [0.015, 0.05, 0.12]) },
  ],
};

/** The leaping fish: a slim silver body with a tail fin. */
export const FISH_PARTS: PartSpec[] = [
  {
    id: "body",
    pivot: [0, 0, 0],
    build: (k, m) => {
      k.add("sphere", m("#8fa9b3"), [0, 0, 0], [0.09, 0.1, 0.34]);
      k.add("sphere", m("#dbe5e4"), [0, -0.025, 0.02], [0.07, 0.05, 0.26]);
      k.add("cone", m("#6f8d99"), [0, 0, -0.2], [0.12, 0.12, 0.02], { rot: [-Math.PI / 2, 0, 0], outline: false });
    },
  },
];

/** Each part's meshes, built once. */
export function buildSpecies(parts: PartSpec[]): Record<string, BuiltMesh[]> {
  const out: Record<string, BuiltMesh[]> = {};
  for (const p of parts) {
    const k = new Kit();
    p.build(k, fur);
    out[p.id] = k.build();
  }
  return out;
}

/** What an animal is up to this frame. */
export interface Doing {
  /** Seconds on the screen's clock. */
  t: number;
  /** How far it has walked (metres), for the stride. */
  dist: number;
  speed: number;
  moving: boolean;
  act: Act | null;
  /** 0..1 through the walk or the stay (see Stance). */
  u: number;
  /** Startled or watching: head up, listening. 0..1. */
  alert: number;
  fleeing: boolean;
  /** Makes each animal's small movements its own. */
  seed: number;
}

export interface PartPose {
  rx?: number;
  ry?: number;
  rz?: number;
  sx?: number;
  sy?: number;
  sz?: number;
}

export interface Pose {
  /** Lift, and turns of the whole body (radians: pitch negative is nose up). */
  dy: number;
  pitch: number;
  roll: number;
  parts: Record<string, PartPose>;
}

const smooth = (x: number) => x * x * (3 - 2 * x);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** 0 most of the time, a quick bump to 1 and back now and then (a head coming up to look). */
const glance = (t: number, seed: number, every = 5.5, length = 1.3) => {
  const c = (t + seed * 3.7) % every;
  return c < length ? Math.sin((c / length) * Math.PI) : 0;
};

/** The squirrel's trip up a tree: head first up the trunk, a spell upright on a branch, then back down head first. */
export function climbing(u: number): { height: number; pitch: number } {
  const up = smooth(clamp01(u / 0.2));
  const down = smooth(clamp01((u - 0.8) / 0.2));
  const height = up * (1 - down) * 1.9;
  // vertical on the trunk (nose up going up, nose down coming down), sitting up at the top
  const pitch = u < 0.2 ? -1.5 * up : u < 0.8 ? -0.7 : -0.7 + (1.5 + 0.7) * down;
  return { height, pitch: u > 0.995 ? 0 : pitch };
}

export function animate(kind: Species, a: Doing): Pose {
  const { t, dist, moving, act, u, alert, seed } = a;
  const amp = moving ? clamp01(a.speed / 0.8) : 0;
  switch (kind) {
    case "deer":
    case "buck":
    case "fawn": {
      const small = kind === "fawn";
      const stride = (small ? 6.8 : 5.2) * dist;
      const swing = Math.sin(stride) * (a.fleeing ? 0.75 : 0.5) * amp;
      const graze = act === "graze" && !moving ? 1 - Math.max(alert, glance(t, seed, 7, 1.6)) : 0;
      const nod = graze * (0.1 * Math.sin(t * 2.6 + seed) + 0.04 * Math.sin(t * 9));
      return {
        dy: Math.abs(Math.cos(stride)) * (a.fleeing ? 0.05 : 0.014) * amp,
        pitch: a.fleeing ? -0.06 : 0,
        roll: 0,
        parts: {
          head: { rx: (moving ? 0.15 : 0.1) * (1 - alert) - 0.25 * alert + graze * 1.0 + nod, ry: alert > 0.5 || moving ? 0 : Math.sin(t * 0.7 + seed) * 0.15 },
          legsA: { rx: swing },
          legsB: { rx: -swing },
        },
      };
    }
    case "rabbit": {
      const phase = (dist / 0.42) * Math.PI * 2;
      const hop = moving ? Math.max(0, Math.sin(phase)) : 0;
      const eating = act === "graze" && !moving && alert < 0.3;
      const chew = eating ? 0.45 + 0.28 * Math.max(0, Math.sin(t * 6.5 + seed)) * (0.5 + 0.5 * Math.sin(t * 0.8 + seed)) : 0;
      return {
        dy: hop * (a.fleeing ? 0.2 : 0.11) + alert * 0.03,
        pitch: moving ? -Math.cos(phase) * 0.35 : -0.5 * alert,
        roll: 0,
        parts: { head: { rx: chew - 0.1 * alert + (moving ? -0.1 : 0) } },
      };
    }
    case "squirrel": {
      const phase = (dist / 0.3) * Math.PI * 2;
      const hop = moving ? Math.max(0, Math.sin(phase)) : 0;
      const tail = Math.sin(t * 2.2 + seed) * 0.18 + (moving ? Math.sin(phase) * 0.08 : 0);
      let dy = hop * 0.07;
      let pitch = moving ? -Math.cos(phase) * 0.3 : -0.35 * Math.max(alert, glance(t, seed, 4, 1.4));
      if (act === "climb" && !moving) {
        const c = climbing(u);
        dy = c.height;
        pitch = c.pitch;
      }
      return { dy, pitch, roll: 0, parts: { tail: { rx: -0.1, rz: tail } } };
    }
    case "fox": {
      const stride = 7.4 * dist;
      const swing = Math.sin(stride) * 0.6 * amp;
      const sniff = act === "sniff" && !moving ? 1 - alert : 0;
      return {
        dy: Math.abs(Math.cos(stride)) * 0.018 * amp,
        pitch: a.fleeing ? -0.05 : 0,
        roll: 0,
        parts: {
          head: { rx: (moving ? 0.12 : 0) + sniff * (0.65 + 0.12 * Math.sin(t * 8 + seed)) - alert * 0.25, ry: sniff * Math.sin(t * 1.3 + seed) * 0.35 },
          tail: { rz: Math.sin(t * 1.6 + seed) * 0.12 * (1 + amp), rx: moving ? -0.1 : 0.25 },
          legsA: { rx: swing },
          legsB: { rx: -swing },
        },
      };
    }
    case "hedgehog": {
      const shuffle = moving ? Math.sin(dist * 22) : 0;
      const sniff = act === "sniff" && !moving ? Math.sin(t * 3 + seed) * 0.06 : 0;
      return { dy: Math.abs(shuffle) * 0.006, pitch: sniff - alert * 0.05, roll: shuffle * 0.04, parts: {} };
    }
    case "frog": {
      const leap = moving ? Math.sin(u * Math.PI) : 0;
      const throat = !moving ? 1 + 0.08 * Math.sin(t * 3.4 + seed) : 1;
      return { dy: leap * 0.13, pitch: moving ? -Math.cos(u * Math.PI) * 0.5 : 0, roll: 0, parts: { body: { sy: throat, sx: 1 + (throat - 1) * 0.4 } } };
    }
    case "sparrow": {
      const flying = moving || a.fleeing;
      const flap = Math.sin(t * 38 + seed) * 0.95 + 0.35;
      const preen = act === "preen" && !moving ? Math.sin(t * 1.9 + seed) * 0.5 + Math.sin(t * 7 + seed) * 0.1 : 0;
      return {
        dy: flying ? Math.sin(u * Math.PI) * 0.35 + 0.1 : 0,
        pitch: flying ? -0.25 : 0.05 + Math.max(0, Math.sin(t * 2.6 + seed)) * 0.15 * (alert < 0.3 ? 1 : 0),
        roll: flying ? 0 : preen * 0.15,
        parts: { wingL: { rz: flying ? -flap : -0.2 }, wingR: { rz: flying ? flap : 0.2 } },
      };
    }
  }
}
