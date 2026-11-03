import * as THREE from "three";
import type { Kit } from "./kit";
import type { Finish } from "./pencil";

type Mat = (tone: string, finish?: Finish, alpha?: number) => THREE.Material;
type Builder = (k: Kit, w: number, d: number, p: Record<string, unknown>, m: Mat, seed: number) => void;
const INK = "#353a3d";
const IVORY = "#f4f1e7";
const WOOD = "#ab8058";
const color = (p: Record<string, unknown>, key: string, fallback: string) => typeof p[key] === "string" ? p[key] as string : fallback;

/** These builders are visual assets only. Interaction slots can be added to their stable catalog IDs later. */
export const ENTERTAINMENT_BUILDERS: Record<string, Builder> = {
  pingpong(k, w, d, p, m) {
    const W = w - 0.2, D = d - 0.35, H = 0.76;
    const top = m(color(p, "top", "#397d87"));
    const frame = m("#4b5558");
    const white = m(IVORY);
    const rubber = m("#393b38");
    // Two leaves, a dark apron and a wheeled steel undercarriage.
    for (const s of [-1, 1]) {
      k.box(frame, [s * W / 4, H - 0.046, 0], [W / 2 - 0.008, 0.075, D]);
      k.box(top, [s * W / 4, H - 0.012, 0], [W / 2 - 0.008, 0.024, D]);
      k.box(frame, [s * W * 0.32, 0.31, 0], [0.055, 0.055, D * 0.7]);
      for (const z of [-D * 0.34, D * 0.34]) {
        k.box(frame, [s * W * 0.32, 0.41, z], [0.05, 0.65, 0.05]);
        k.box(frame, [s * W * 0.32, 0.105, z], [0.035, 0.06, 0.065], { outline: 0.005 });
        k.add("cyl", rubber, [s * W * 0.32, 0.055, z], [0.11, 0.035, 0.11], { rot: [0, 0, Math.PI / 2], outline: 0.004 });
        k.add("cyl", m("#a9aca6"), [s * W * 0.32 + 0.019, 0.055, z], [0.04, 0.004, 0.04], { rot: [0, 0, Math.PI / 2], outline: false });
      }
      k.box(frame, [0, H - 0.1, s * D * 0.34], [W * 0.67, 0.05, 0.045]);
      k.box(white, [s * (W / 2 - 0.018), H + 0.001, 0], [0.018, 0.002, D - 0.015], { outline: false });
      k.box(white, [0, H + 0.001, s * (D / 2 - 0.018)], [W - 0.015, 0.002, 0.018], { outline: false });
    }
    k.box(white, [0, H + 0.001, 0], [W - 0.03, 0.002, 0.009], { outline: false });
    // An open woven net, rather than an opaque wall.
    for (const s of [-1, 1]) {
      k.box(frame, [0, H - 0.015, s * (D / 2 + 0.025)], [0.07, 0.05, 0.065], { outline: 0.004 });
      k.add("cyl8", frame, [0, H + 0.08, s * (D / 2 + 0.025)], [0.025, 0.2, 0.025], { outline: 0.004 });
    }
    const thread = m("#566665");
    for (let i = 0; i <= 28; i++) k.box(thread, [0, H + 0.085, -D / 2 + i * D / 28], [0.003, 0.15, 0.003], { outline: false });
    for (let i = 0; i <= 4; i++) k.box(thread, [0, H + 0.01 + i * 0.0375, 0], [0.003, 0.003, D + 0.04], { outline: false });
    k.box(white, [0, H + 0.17, 0], [0.014, 0.012, D + 0.07], { outline: false });
    paddle(k, m, [-W * 0.29, H + 0.016, 0.17], -0.55, "#b85248");
    paddle(k, m, [W * 0.30, H + 0.016, -0.18], 2.45, "#363b3b");
    k.add("sphere", m("#f7e8bc"), [0.68, H + 0.02, 0.23], 0.04, { outline: 0.003 });
  },

  gameconsole(k, _w, _d, p, m) {
    const wood = m(color(p, "wood", WOOD), "wood");
    const dark = m(INK);
    const shell = m(color(p, "body", IVORY));
    // A small open media cabinet makes the console placeable under the existing floor-item rules.
    for (const x of [-0.33, 0.33]) for (const z of [-0.24, 0.24]) k.add("cyl8", dark, [x, 0.04, z], [0.035, 0.08, 0.035], { outline: 0.004 });
    k.box(wood, [0, 0.1, 0], [0.8, 0.04, 0.62]);
    k.box(wood, [0, 0.495, 0], [0.82, 0.03, 0.64]);
    for (const s of [-1, 1]) k.box(wood, [s * 0.38, 0.295, 0], [0.04, 0.39, 0.62]);
    k.box(m("#665244", "wood"), [0, 0.295, -0.29], [0.72, 0.39, 0.04]);
    k.box(wood, [0, 0.29, 0], [0.72, 0.025, 0.58]);
    for (let i = 0; i < 5; i++) {
      const x = -0.28 + i * 0.052;
      k.box(m(i % 2 ? "#588997" : "#506790"), [x, 0.20, 0.16], [0.04, 0.16, 0.19], { outline: 0.003 });
      k.box(shell, [x, 0.23, 0.257], [0.027, 0.055, 0.003], { outline: false });
    }
    // White flared side plates around a narrow black core, with blue seams and a disc slot.
    k.add("cyl", dark, [-0.2, 0.52, -0.055], [0.22, 0.018, 0.3], { outline: 0.004 });
    k.add("roundbox", dark, [-0.2, 0.738, -0.055], [0.11, 0.42, 0.22], { outline: 0.004 });
    for (const s of [-1, 1]) {
      k.add(CONSOLE_PLATE, shell, [-0.2 + s * 0.068, 0.738, -0.055], 1, { outline: 0.004, normals: true });
      k.box(m("#78b8cf"), [-0.2 + s * 0.055, 0.785, 0.057], [0.007, 0.27, 0.006], { outline: false });
    }
    k.box(dark, [-0.12, 0.70, 0.075], [0.006, 0.145, 0.004], { outline: false });
    for (const y of [0.66, 0.69]) k.box(m("#a9b5b5"), [-0.2, y, 0.057], [0.024, 0.008, 0.003], { outline: false });
    controller(k, m, [0.095, 0.528, 0.12], -0.25);
    controller(k, m, [0.23, 0.528, -0.14], 0.22);
    // A boxed game and its printed spine on the upper shelf.
    k.box(m("#4c7fa0"), [0.18, 0.318, 0.16], [0.26, 0.024, 0.19], { outline: 0.003 });
    k.box(shell, [0.18, 0.332, 0.16], [0.21, 0.004, 0.15], { outline: false });
  },

  blackjack(k, w, d, p, m) {
    const W = w - 0.2, D = d - 0.16;
    const wood = m(color(p, "wood", WOOD), "wood");
    const felt = m(color(p, "felt", "#568a76"), "fabric");
    const rail = m("#655047", "fabric");
    const frame = m("#4c514a");
    const gold = m("#d9c78f");
    for (const x of [-0.58, 0.58]) for (const z of [-0.22, 0.22]) {
      k.add("cyl8", frame, [x, 0.36, z], [0.045, 0.72, 0.045]);
      k.add("cyl", m("#3d403a"), [x, 0.015, z], [0.075, 0.03, 0.075], { outline: 0.004 });
    }
    for (const z of [-0.21, 0.21]) k.box(frame, [0, 0.66, z], [1.24, 0.05, 0.05]);
    k.add("cyl", wood, [0, 0.742, 0], [W, 0.084, D]);
    k.add("cyl", felt, [0, 0.787, 0], [W - 0.13, 0.012, D - 0.13], { outline: false });
    k.add(TABLE_RAIL, rail, [0, 0.79, 0], [W - 0.08, D - 0.08, 1], { rot: [Math.PI / 2, 0, 0], outline: 0.005, normals: true });
    // Three printed betting boxes and a small gold 21 emblem.
    for (const x of [-0.34, 0, 0.34]) {
      for (const s of [-1, 1]) {
        k.box(gold, [x + s * 0.105, 0.795, 0.18], [0.002, 0.001, 0.125], { outline: false });
        k.box(gold, [x, 0.795, 0.18 + s * 0.0625], [0.21, 0.001, 0.002], { outline: false });
      }
    }
    stroke(k, gold, [[-0.075, 0.796, -0.19], [-0.055, 0.796, -0.21], [-0.025, 0.796, -0.2], [-0.02, 0.796, -0.175], [-0.075, 0.796, -0.13], [-0.015, 0.796, -0.13]], 0.003);
    stroke(k, gold, [[0.025, 0.796, -0.195], [0.045, 0.796, -0.21], [0.045, 0.796, -0.13]], 0.003);
    stroke(k, gold, [[0.025, 0.796, -0.13], [0.065, 0.796, -0.13]], 0.003);
    cardDeck(k, m, [-0.5, 0.794, -0.075], -0.1);
    playingCard(k, m, [-0.13, 0.794, 0.005], -0.17, "A", "spade");
    playingCard(k, m, [0.04, 0.795, 0.03], 0.15, "K", "heart");
    // Card shoe and a second stack toward the dealer's side.
    k.at([0.53, 0.794, -0.16], -0.2, () => {
      const tray = m(INK);
      k.box(tray, [0, 0.012, 0], [0.22, 0.024, 0.2], { outline: 0.004 });
      for (const s of [-1, 1]) k.box(tray, [s * 0.103, 0.055, 0], [0.014, 0.09, 0.2], { outline: 0.003 });
      k.box(tray, [0, 0.07, -0.095], [0.22, 0.12, 0.012], { outline: 0.004 });
      k.add("roundbox", m(IVORY), [0, 0.045, -0.01], [0.15, 0.045, 0.17], { rot: [-0.22, 0, 0], outline: 0.002 });
      k.box(m("#aa5f58"), [0, 0.07, -0.015], [0.14, 0.003, 0.15], { rot: [-0.22, 0, 0], outline: false });
    });
    chipStack(k, m, [-0.56, 0.794, 0.16], "#bb6254", 7);
    chipStack(k, m, [-0.43, 0.794, 0.16], "#5b8195", 5);
    chipStack(k, m, [0.50, 0.794, 0.15], "#e9e0c8", 8);
  },
};

function paddle(k: Kit, m: Mat, pos: [number, number, number], turn: number, tone: string) {
  k.at(pos, turn, () => {
    const wood = m("#d3b081", "wood");
    k.add("cyl", wood, [0, 0, 0], [0.19, 0.025, 0.21], { outline: 0.003 });
    k.add("cyl", m(tone), [0, 0.016, 0], [0.18, 0.008, 0.20], { outline: false });
    k.add("roundbox", wood, [0, -0.002, 0.14], [0.045, 0.024, 0.15], { outline: 0.003 });
    k.box(m("#836447"), [0, 0.012, 0.15], [0.008, 0.003, 0.12], { outline: false });
  });
}
export function controller(k: Kit, m: Mat, pos: [number, number, number], turn: number) {
  k.at(pos, turn, () => {
    const white = m(IVORY), black = m(INK);
    k.add("soft", white, [0, 0.045, 0], [0.17, 0.065, 0.095], { outline: 0.003 });
    for (const s of [-1, 1]) k.add("soft", white, [s * 0.055, 0.024, 0.035], [0.065, 0.072, 0.1], { rot: [0, s * 0.2, s * -0.16], outline: 0.003 });
    k.add("roundbox", black, [0, 0.077, 0], [0.12, 0.013, 0.066], { outline: false });
    k.box(white, [0, 0.086, -0.017], [0.055, 0.006, 0.026], { outline: false });
    for (const s of [-1, 1]) k.add("cyl", black, [s * 0.025, 0.09, 0.015], [0.022, 0.012, 0.022], { outline: false });
    k.box(black, [-0.057, 0.084, -0.018], [0.026, 0.007, 0.008], { outline: false });
    k.box(black, [-0.057, 0.084, -0.018], [0.008, 0.007, 0.026], { outline: false });
    for (let i = 0; i < 4; i++) k.add("cyl", m(i % 2 ? "#8a9ca7" : "#bf8991"), [0.057 + Math.sin(i * Math.PI / 2) * 0.011, 0.084, -0.018 + Math.cos(i * Math.PI / 2) * 0.011], [0.007, 0.006, 0.007], { outline: false });
  });
}
function cardDeck(k: Kit, m: Mat, pos: [number, number, number], turn: number) {
  k.at(pos, turn, () => {
    k.add("roundbox", m(IVORY), [0, 0.0225, 0], [0.115, 0.045, 0.165], { outline: 0.002 });
    for (let i = 1; i < 6; i++) k.box(m("#b5afa3"), [0, i * 0.006, 0.083], [0.105, 0.001, 0.001], { outline: false });
    k.add("roundbox", m("#ac605a"), [0, 0.046, 0], [0.108, 0.003, 0.157], { outline: false });
    for (let x = -1; x <= 1; x++) for (let z = -2; z <= 2; z++) k.box(m("#ead9bb"), [x * 0.025, 0.048, z * 0.025], [0.011, 0.001, 0.011], { rot: [0, Math.PI / 4, 0], outline: false });
  });
}
function playingCard(k: Kit, m: Mat, pos: [number, number, number], turn: number, rank: "A" | "K", suit: "spade" | "heart") {
  k.at(pos, turn, () => {
    const ink = m(suit === "heart" ? "#b4544a" : "#343b3c");
    k.add("roundbox", m("#fdf9ee"), [0, 0.003, 0], [0.112, 0.006, 0.166], { outline: 0.0015 });
    k.add(suit === "heart" ? HEART : SPADE, ink, [0, 0.0068, 0], [0.055, 1, 0.055], { outline: false });
    if (suit === "spade") k.box(ink, [0, 0.0069, 0.025], [0.011, 0.001, 0.022], { outline: false });
    for (const angle of [0, Math.PI]) k.at([0, 0, 0], angle, () => {
      const x = -0.035, z = -0.049, y = 0.007;
      if (rank === "A") {
        stroke(k, ink, [[x - 0.006, y, z + 0.009], [x, y, z - 0.01], [x + 0.006, y, z + 0.009]], 0.0016);
        stroke(k, ink, [[x - 0.004, y, z + 0.003], [x + 0.004, y, z + 0.003]], 0.0016);
      } else {
        stroke(k, ink, [[x - 0.005, y, z - 0.01], [x - 0.005, y, z + 0.009]], 0.0016);
        stroke(k, ink, [[x + 0.006, y, z - 0.01], [x - 0.005, y, z], [x + 0.006, y, z + 0.009]], 0.0016);
      }
    });
  });
}
function chipStack(k: Kit, m: Mat, pos: [number, number, number], tone: string, count: number) {
  k.at(pos, 0, () => {
    for (let i = 0; i < count; i++) {
      k.add("cyl", m(tone), [0, 0.004 + i * 0.008, 0], [0.065, 0.008, 0.065], { outline: 0.001 });
      if (i % 2 === 0) k.add("cyl", m("#e9e1cc"), [0, 0.007 + i * 0.008, 0], [0.0652, 0.0012, 0.0652], { outline: false });
    }
    const y = count * 0.008 + 0.001;
    k.add("torus", m("#e8dcc2"), [0, y, 0], 0.04, { rot: [Math.PI / 2, 0, 0], outline: false });
    for (let i = 0; i < 6; i++) k.at([0, 0, 0], i * Math.PI / 3, () => k.box(m("#f4ebd6"), [0, y, 0.026], [0.008, 0.001, 0.009], { outline: false }));
  });
}
function stroke(k: Kit, mat: THREE.Material, points: [number, number, number][], radius: number) {
  for (let i = 1; i < points.length; i++) {
    const from = new THREE.Vector3(...points[i - 1]!), to = new THREE.Vector3(...points[i]!);
    const delta = to.clone().sub(from);
    const geometry = new THREE.CylinderGeometry(radius, radius, delta.length(), 6);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()));
    k.add(geometry, mat, from.add(to).multiplyScalar(0.5).toArray(), 1, { outline: false });
  }
}
function consolePlate() {
  const s = new THREE.Shape();
  s.moveTo(-0.12, -0.21); s.quadraticCurveTo(-0.16, 0, -0.14, 0.225);
  s.quadraticCurveTo(0.015, 0.21, 0.11, 0.24); s.quadraticCurveTo(0.15, 0.2, 0.12, -0.21); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: true, bevelSize: 0.003, bevelThickness: 0.003, bevelSegments: 2, curveSegments: 8 });
  g.translate(0, 0, -0.006); g.rotateY(Math.PI / 2); return g;
}
function heart() {
  const s = new THREE.Shape(); s.moveTo(0, -0.5);
  s.bezierCurveTo(-0.78, 0.02, -0.48, 0.75, 0, 0.3);
  s.bezierCurveTo(0.48, 0.75, 0.78, 0.02, 0, -0.5);
  const g = new THREE.ShapeGeometry(s, 12); g.rotateX(-Math.PI / 2); return g;
}
const CONSOLE_PLATE = consolePlate();
const TABLE_RAIL = new THREE.TorusGeometry(0.5, 0.035, 8, 64);
const HEART = heart();
const SPADE = HEART.clone().rotateY(Math.PI);
