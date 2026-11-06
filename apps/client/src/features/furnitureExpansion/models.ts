import * as THREE from "three";
import type { Kit } from "../../render/kit";
import type { Finish } from "../../render/pencil";

type Point = [number, number, number];
type Params = Record<string, unknown>;
type Mat = (tone: string, finish?: Finish, alpha?: number) => THREE.Material;
type Builder = (k: Kit, w: number, d: number, p: Params, m: Mat, seed: number) => void;
const color = (p: Params, key: string, fallback: string) => typeof p[key] === "string" ? p[key] as string : fallback;

function arch(w: number, h: number, depth: number) {
  const s = new THREE.Shape(), r = w / 2;
  s.moveTo(-r, 0); s.lineTo(r, 0); s.lineTo(r, h - r);
  s.absarc(0, h - r, r, 0, Math.PI, false); s.lineTo(-r, 0);
  return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 16 });
}
const mirrorFrame = arch(.74, .96, .05), mirrorFace = arch(.65, .87, .012);


/** Shared joinery, tubing and props keep the new pieces consistent without one-off model files. */
function rod(k: Kit, mat: THREE.Material, a: Point, b: Point, radius = .018) {
  const delta = new THREE.Vector3(...b).sub(new THREE.Vector3(...a));
  const e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize()), "YXZ");
  k.add("cyl8", mat, a.map((v, i) => (v + b[i]!) / 2) as Point, [radius * 2, delta.length(), radius * 2], { rot: [e.x, e.y, e.z], outline: false });
}
function legs(k: Kit, mat: THREE.Material, w: number, d: number, h: number) {
  for (const x of [-1, 1]) for (const z of [-1, 1]) k.box(mat, [x * (w / 2 - .06), h / 2, z * (d / 2 - .06)], [.06, h, .06]);
}
function handle(k: Kit, mat: THREE.Material, x: number, y: number, z: number, width = .14) {
  rod(k, mat, [x - width / 2, y, z], [x + width / 2, y, z], .012);
  for (const dx of [-width / 2, width / 2]) rod(k, mat, [x + dx, y, z], [x + dx, y, z - .025], .009);
}
function book(k: Kit, m: Mat, x: number, y: number, z: number, tone: string, angle = 0) {
  k.at([x, y, z], angle, () => {
    k.box(m(tone, "fabric"), [0, .025, 0], [.21, .05, .28]);
    k.box(m("#eee8d8", "paper"), [.006, .025, .008], [.198, .035, .25]);
  });
}
function pot(k: Kit, m: Mat, x: number, y: number, z: number, tone: string, plant = false) {
  k.add("cone", m(tone, "clay"), [x, y + .11, z], [.22, .22, .22], { rot: [Math.PI, 0, 0] });
  k.add("torus", m(tone, "clay"), [x, y + .21, z], [.21, .21, .21], { rot: [Math.PI / 2, 0, 0] });
  k.add("cyl", m("#5f4938", "earth"), [x, y + .205, z], [.18, .012, .18]);
  if (plant) for (let i = 0; i < 5; i++) {
    const a = i * 2.4, tip: Point = [x + Math.cos(a) * .11, y + .36 + i * .025, z + Math.sin(a) * .11];
    rod(k, m("#43864c", "foliage"), [x, y + .2, z], tip, .007);
    k.add("sphere", m(i % 2 ? "#79a74c" : "#399359", "foliage"), tip, [.12, .045, .07], { rot: [0, -a, .2], outline: false });
  }
}
function speaker(k: Kit, m: Mat, x: number, y: number, z: number, wood: string) {
  k.box(m(wood, "timber"), [x, y + .24, z], [.33, .48, .31]);
  k.box(m("#403d3b", "fabric"), [x, y + .24, z + .16], [.28, .43, .018]);
  for (const [h, size] of [[.17, .18], [.35, .085]]) {
    k.add("torus", m("#212c34", "rubber"), [x, y + h!, z + .18], size!, { outline: false });
    k.add("sphere", m("#4c5558", "metal"), [x, y + h!, z + .182], [size! * .65, size! * .65, .025], { outline: false });
  }
}

export const EXPANSION_BUILDERS: Record<string, Builder> = {
  nestingtables: (k, _w, _d, p, m) => {
    const wood = m(color(p, "wood", "#b67942"), "timber"), stone = m(color(p, "stone", "#eee0c2"), "mineral");
    for (const [x, y, r, z] of [[-.3, .48, .43, -.015], [.46, .34, .34, .02]]) {
      k.add("cyl", stone, [x!, y! - .025, z!], [r! * 2, .05, r! * 2]);
      for (let i = 0; i < 3; i++) {
        const a = i * Math.PI * 2 / 3;
        rod(k, wood, [x! + Math.cos(a) * r! * .6, .01, z! + Math.sin(a) * r! * .6], [x! + Math.cos(a) * r! * .48, y! - .05, z! + Math.sin(a) * r! * .48], .025);
      }
    }
    book(k, m, -.35, .48, -.02, "#4e9d98", .2);
  },
  fireplace: (k, _w, _d, p, m) => {
    const stone = m(color(p, "stone", "#c8bda8"), "mineral"), wood = m(color(p, "wood", "#9a6136"), "timber");
    k.box(stone, [0, .07, 0], [1.86, .14, .82]);
    for (const x of [-.73, .73]) k.box(stone, [x, .59, -.1], [.3, .95, .58]);
    k.box(stone, [0, 1.04, -.1], [1.76, .22, .58]);
    k.box(wood, [0, 1.19, -.05], [1.94, .09, .8]);
    k.box(m("#292b30", "metal"), [0, .58, -.36], [1.16, .84, .05]);
    k.box(m("#363a3c", "metal"), [0, .2, -.05], [1.17, .12, .54]);
    for (const [x, y, h] of [[-.31, .38, .3], [-.05, .47, .48], [.22, .4, .36]]) {
      k.add("cone", m("#ef8e37", "paint"), [x!, y!, .04], [.19, h!, .08]);
      k.add("cone", m("#f7ce68", "paint"), [x!, y! - .045, .09], [.09, h! * .6, .04]);
    }
    for (const z of [-.05, .08]) rod(k, wood, [-.43, .27, z], [.42, .27, z], .045);
    for (let i = 0; i < 9; i++) rod(k, m("#3b4040", "metal"), [-.5 + i * .125, .17, .26], [-.5 + i * .125, .37, .26], .009);
    pot(k, m, -.65, 1.235, -.06, "#448e88", true);
  },
  divider: (k, _w, _d, p, m) => {
    const wood = m(color(p, "wood", "#8a5433"), "timber"), cane = m(color(p, "fabric", "#dac693"), "fabric");
    for (let j = 0; j < 3; j++) k.at([-.62 + j * .62, 0, 0], j % 2 ? -.24 : .24, () => {
      for (const x of [-.275, .275]) k.box(wood, [x, .86, 0], [.05, 1.72, .06]);
      for (const y of [.16, 1.68]) k.box(wood, [0, y, 0], [.59, .055, .065]);
      k.box(cane, [0, .9, 0], [.49, 1.45, .025]);
      for (let r = 0; r < 9; r++) rod(k, wood, [-.23, .24 + r * .16, .027], [.23, .24 + r * .16, .027], .004);
    });
    for (const x of [-.84, .84]) k.box(wood, [x, .025, 0], [.15, .05, .5]);
  },
  bedbench: (k, _w, _d, p, m) => {
    const wood = m(color(p, "wood", "#825436"), "timber"), fab = m(color(p, "fabric", "#dca46a"), "fabric");
    legs(k, wood, 1.76, .64, .32);
    k.box(wood, [0, .3, 0], [1.79, .12, .68]);
    k.add("soft", fab, [0, .4, .02], [1.86, .12, .76]);
    for (const x of [-.6, 0, .6]) {
      k.add("sphere", m("#bc7e4d", "fabric"), [x, .459, .02], [.035, .008, .035]);
      k.box(m("#e5b981", "fabric"), [x + .2, .35, .407], [.003, .06, .003], { outline: false });
    }
    k.add("soft", m("#648e8b", "fabric"), [.64, .48, -.08], [.36, .08, .44]);
  },
  dressingvanity: (k, _w, _d, p, m) => {
    const wood = m(color(p, "wood", "#b7794f"), "timber"), brass = m("#bda45f", "metal");
    legs(k, wood, 1.7, .72, .69);
    k.box(wood, [0, .73, 0], [1.86, .08, .8]);
    for (const x of [-.5, .5]) {
      k.box(wood, [x, .61, .02], [.76, .18, .7]);
      handle(k, brass, x, .61, .4);
    }
    // Rounded arched frame and inset reflective face; both fit behind the worktop.
    k.add(mirrorFrame, brass, [0, .77, -.32], 1);
    k.add(mirrorFace, m("#bdd8d8", "glass"), [0, .815, -.267], 1);
    for (const x of [-.38, .38]) rod(k, brass, [x, .77, -.3], [x, .95, -.3], .012);
    k.add("cyl", m(color(p, "accent", "#dfa29b"), "ceramic"), [-.62, .8, .08], [.18, .06, .18]);
    for (let i = 0; i < 3; i++) {
      k.box(m(["#7ba79a", "#e4be68", "#c79fba"][i]!, "glass"), [.5 + i * .11, .84, -.13], [.075, .14, .065]);
      k.box(brass, [.5 + i * .11, .928, -.13], [.045, .036, .045]);
    }
  },
  blanketladder: (k, _w, _d, p, m) => {
    const wood = m(color(p, "wood", "#b08a56"), "timber");
    for (const x of [-.3, .3]) rod(k, wood, [x, .025, .22], [x, 1.62, -.22], .025);
    for (let i = 0; i < 5; i++) {
      const y = .24 + i * .29, z = .22 - (y - .025) / 1.595 * .44;
      rod(k, wood, [-.3, y, z], [.3, y, z], .018);
      if (i > 1) {
        const fab = m(i % 2 ? color(p, "fabric", "#4d9f9a") : "#e6ba86", "fabric");
        k.add("soft", fab, [0, y - .14, z + .04], [.49, .34, .04]);
        for (let f = 0; f < 9; f++) rod(k, fab, [-.2 + f * .05, y - .31, z + .04], [-.2 + f * .05, y - .345, z + .04], .004);
      }
    }
  },
  kitchenisland: (k, _w, _d, p, m) => {
    const wood = m(color(p, "wood", "#c69455"), "timber"), body = m(color(p, "body", "#388e88"), "paint"), brass = m("#c6ac69", "metal");
    k.box(body, [0, .07, 0], [1.68, .14, .66]);
    k.box(body, [0, .45, -.02], [1.79, .68, .74]);
    k.box(wood, [0, .86, 0], [1.92, .08, .9]);
    for (const x of [-.46, .46]) {
      k.box(body, [x, .42, .365], [.82, .52, .035]);
      handle(k, brass, x, .63, .405, .23);
      for (const dx of [-.35, .35]) k.box(brass, [x + dx, .42, .386], [.006, .4, .005]);
    }
    for (let i = 0; i < 8; i++) k.box(m("#b8864f", "timber"), [-.84 + i * .24, .901, 0], [.004, .002, .88], { outline: false });
    // Keep the central serving surface and preparation positions clear.
    rod(k, brass, [-.97, .66, -.24], [-.97, .66, .24], .012);
    k.box(m("#e0bf83", "fabric"), [-.975, .48, .02], [.022, .34, .3]);
  },
  barcart: (k, _w, _d, p, m) => {
    const metal = m(color(p, "metal", "#c5a654"), "metal"), wood = m(color(p, "wood", "#9b6541"), "timber");
    for (const x of [-.31, .31]) for (const z of [-.26, .26]) {
      k.add("sphere", m("#394248", "rubber"), [x, .045, z], [.07, .09, .07]);
      rod(k, metal, [x, .07, z], [x, .82, z], .014);
    }
    for (const y of [.19, .66]) {
      k.box(wood, [0, y, 0], [.7, .045, .6]);
      for (const z of [-.28, .28]) rod(k, metal, [-.34, y + .055, z], [.34, y + .055, z], .01);
    }
    rod(k, metal, [.31, .82, -.26], [.31, .82, .26], .018);
    for (const x of [-.2, -.02]) {
      k.add("cyl", m("#508e75", "glass"), [x, .35, -.08], [.1, .28, .1]);
      k.add("cyl", metal, [x, .51, -.08], [.045, .055, .045]);
    }
    k.add("sphere", m("#e4bc6e", "ceramic"), [-.1, .77, 0], [.22, .18, .2]);
    k.add("torus", metal, [-.1, .85, 0], [.13, .13, .13], { rot: [Math.PI / 2, 0, 0] });
    for (const x of [.13, .25]) k.add("cyl", m("#eee3ce", "ceramic"), [x, .73, .12], [.08, .09, .08]);
  },
  doublevanity: (k, _w, _d, p, m) => {
    const body = m(color(p, "body", "#3b8e9a"), "paint"), stone = m(color(p, "stone", "#ece6d8"), "mineral"), ceramic = m("#f4eee2", "ceramic"), metal = m("#bdac74", "metal");
    legs(k, metal, 1.75, .72, .12);
    k.box(body, [0, .43, 0], [1.84, .63, .76]);
    // Slab cut into strips around two recessed bowls, never a solid cap over the basin.
    for (const z of [-.33, .32]) k.box(stone, [0, .8, z], [1.92, .07, .19]);
    for (const x of [-.88, 0, .88]) k.box(stone, [x, .8, 0], [x === 0 ? .35 : .16, .07, .48]);
    for (const x of [-.5, .5]) {
      k.box(ceramic, [x, .73, 0], [.59, .035, .47]);
      for (const dx of [-.29, .29]) k.box(ceramic, [x + dx, .78, 0], [.035, .12, .48]);
      for (const z of [-.23, .23]) k.box(ceramic, [x, .78, z], [.58, .12, .035]);
      k.add("cyl", metal, [x, .751, 0], [.055, .005, .055]);
      rod(k, metal, [x, .83, -.3], [x, 1.04, -.3], .02);
      rod(k, metal, [x, 1.04, -.3], [x, 1.04, -.12], .02);
      k.box(body, [x, .44, .396], [.86, .52, .035]);
      handle(k, metal, x, .6, .44, .25);
    }
  },
  washer: (k, _w, _d, p, m) => {
    const body = m(color(p, "body", "#c6ddd7"), "paint"), metal = m("#aeb7b9", "metal"), rubber = m("#354c53", "rubber");
    legs(k, rubber, .66, .65, .06);
    k.add("roundbox", body, [0, .47, 0], [.78, .86, .77]);
    k.box(m("#eef1e9", "paint"), [0, .91, 0], [.81, .04, .8]);
    k.box(m("#566f76", "paint"), [0, .79, .392], [.71, .12, .02]);
    k.add("cyl", metal, [.11, .79, .42], [.065, .023, .065], { rot: [Math.PI / 2, 0, 0] });
    k.box(m("#72c1bd", "glass"), [-.12, .79, .412], [.16, .045, .01]);
    k.add("torus", metal, [0, .43, .402], .49);
    k.add("torus", rubber, [0, .43, .409], .39);
    k.add("cyl", m("#6e989e", "glass"), [0, .43, .407], [.35, .018, .35], { rot: [Math.PI / 2, 0, 0] });
    k.add("soft", m("#e6be85", "fabric"), [-.03, .36, .42], [.18, .12, .015]);
    handle(k, metal, .19, .48, .444, .06);
    k.add("soft", m("#df9f8e", "fabric"), [0, .967, .04], [.54, .07, .42]);
  },
  towelstand: (k, _w, _d, p, m) => {
    const metal = m(color(p, "metal", "#bcaa79"), "metal"), fab = m(color(p, "fabric", "#de8b6a"), "fabric");
    for (const x of [-.31, .31]) {
      k.box(metal, [x, .025, 0], [.12, .05, .63]);
      rod(k, metal, [x, .05, -.18], [x, 1.21, -.18], .02);
      rod(k, metal, [x, .05, .18], [x, .9, .18], .02);
    }
    for (const [y, z] of [[1.19, -.18], [.88, .18]]) {
      rod(k, metal, [-.31, y!, z!], [.31, y!, z!], .02);
      k.add("soft", fab, [0, y! - .18, z! + .025], [.5, .38, .04]);
      for (let i = 0; i < 3; i++) k.box(m("#ecc8a5", "fabric"), [0, y! - .3 + i * .02, z! + .047], [.48, .006, .004], { outline: false });
    }
  },
  officechair: (k, _w, _d, p, m) => {
    const metal = m(color(p, "metal", "#424c55"), "metal"), fab = m(color(p, "fabric", "#247e91"), "fabric");
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * 2 / 5, x = Math.cos(a) * .35, z = Math.sin(a) * .35;
      rod(k, metal, [0, .15, 0], [x, .08, z], .024);
      k.add("sphere", m("#283d44", "rubber"), [x, .035, z], [.065, .07, .065]);
    }
    rod(k, metal, [0, .1, 0], [0, .4, 0], .038);
    k.add("soft", fab, [0, .42, .04], [.62, .12, .58]);
    rod(k, metal, [0, .33, -.2], [0, 1.1, -.28], .025);
    k.add("soft", fab, [0, .88, -.24], [.57, .58, .09], { rot: [-.1, 0, 0] });
    for (const x of [-.35, .35]) {
      rod(k, metal, [x, .4, 0], [x, .66, 0], .017);
      k.add("soft", metal, [x, .67, .03], [.07, .045, .34]);
    }
    for (let i = 0; i < 6; i++) k.box(m("#4a98a2", "fabric"), [0, .7 + i * .067, -.183], [.49, .008, .006], { outline: false });
  },
  draftingtable: (k, _w, _d, p, m) => {
    const metal = m(color(p, "metal", "#426e72"), "metal"), wood = m(color(p, "wood", "#bc8d52"), "timber");
    for (const x of [-.67, .67]) {
      k.box(metal, [x, .035, 0], [.12, .07, .8]);
      rod(k, metal, [x, .07, -.29], [x, .86, .06], .03);
      rod(k, metal, [x, .07, .29], [x, .86, -.06], .03);
    }
    rod(k, metal, [-.67, .36, 0], [.67, .36, 0], .022);
    k.at([0, .95, 0], [.25, 0, 0], () => {
      k.box(wood, [0, 0, 0], [1.83, .07, .77]);
      k.box(m("#d4e6df", "paper"), [0, .04, 0], [1.22, .005, .57]);
      const ink = m("#557f8a", "paint");
      for (const x of [-.4, -.05, .4]) k.box(ink, [x, .045, 0], [.009, .002, .42], { outline: false });
      for (const z of [-.2, .04, .2]) k.box(ink, [0, .045, z], [.81, .002, .009], { outline: false });
      rod(k, m("#d6b05c", "timber"), [.65, .065, -.2], [.65, .065, .21], .012);
      k.box(metal, [0, .063, .35], [1.73, .05, .035]);
    });
    for (const x of [-.67, .67]) k.add("cyl", m("#c9b885", "metal"), [x, .83, .04], [.09, .035, .09], { rot: [0, 0, Math.PI / 2] });
  },
  arcade: (k, _w, _d, p, m) => {
    const body = m(color(p, "body", "#7659b7"), "paint"), accent = m(color(p, "accent", "#e9b63b"), "paint"), dark = m("#253440", "paint");
    k.box(dark, [0, .065, 0], [.74, .13, .74]);
    k.box(body, [0, .56, 0], [.75, .99, .68]);
    k.box(dark, [0, .7, .35], [.6, .19, .025]);
    k.box(accent, [0, 1.04, .1], [.79, .09, .66]);
    for (const x of [-.36, .36]) k.box(body, [x, 1.38, -.11], [.07, .72, .57]);
    k.box(dark, [0, 1.37, -.3], [.66, .52, .06]);
    k.box(m("#4aa8b4", "glass"), [0, 1.38, -.255], [.56, .4, .018]);
    for (let i = 0; i < 4; i++) k.box(m("#e6d17c", "paint"), [-.18 + i * .12, 1.37 + Math.sin(i * 2) * .09, -.238], [.035, .035, .008]);
    k.box(body, [0, 1.77, -.11], [.8, .17, .62]);
    k.box(accent, [0, 1.77, .21], [.67, .1, .018]);
    for (let i = 0; i < 5; i++) k.add("sphere", m("#faf1d3", "paint"), [-.23 + i * .115, 1.77, .225], .035);
    rod(k, dark, [-.17, 1.09, .18], [-.17, 1.19, .18], .014);
    k.add("sphere", m("#e36d6b", "paint"), [-.17, 1.2, .18], .065);
    for (const x of [.07, .18, .29]) k.add("cyl", m("#e07885", "paint"), [x, 1.1, .18], [.055, .018, .055]);
    k.box(m("#bab9a8", "metal"), [0, .52, .375], [.14, .09, .02]);
  },
  foosball: (k, _w, _d, p, m) => {
    const wood = m(color(p, "wood", "#a86b38"), "timber"), metal = m("#a9b6b8", "metal"), dark = m("#33494d", "rubber");
    legs(k, wood, 1.56, .64, .68);
    k.box(wood, [0, .72, 0], [1.73, .18, .65]);
    k.box(m(color(p, "field", "#298c68"), "paint"), [0, .818, 0], [1.55, .018, .57]);
    for (const z of [-.33, .33]) k.box(wood, [0, .87, z], [1.77, .16, .065]);
    for (const x of [-.85, .85]) {
      for (const z of [-.235, .235]) k.box(wood, [x, .87, z], [.06, .16, .15]);
      k.box(wood, [x, .948, 0], [.065, .026, .65]);
    }
    for (let i = 0; i < 6; i++) {
      const x = -.62 + i * .248;
      rod(k, metal, [x, .9, -.43], [x, .9, .43], .008);
      k.add("cyl", dark, [x, .9, i % 2 ? -.45 : .45], [.035, .08, .035], { rot: [Math.PI / 2, 0, 0] });
      for (const z of [-.16, 0, .16]) {
        const team = m(i % 2 ? "#d55354" : "#e9c057", "paint");
        k.box(team, [x, .872, z], [.04, .065, .04]);
        k.add("sphere", team, [x, .925, z], .045);
      }
    }
    for (const z of [-.25, .25]) k.box(m("#e6e8d3", "paint"), [0, .829, z], [1.46, .002, .007]);
    k.box(m("#e6e8d3", "paint"), [0, .829, 0], [.006, .002, .5]);
    k.add("sphere", m("#eee9d6", "paint"), [.11, .844, .09], .03);
  },
  vinylconsole: (k, _w, _d, p, m) => {
    const woodTone = color(p, "wood", "#945d38"), wood = m(woodTone, "timber"), brass = m("#c1ae76", "metal");
    legs(k, wood, 1.75, .61, .2);
    k.box(wood, [0, .44, 0], [1.86, .49, .7]);
    for (const x of [-.69, .69]) speaker(k, m, x, .215, .21, woodTone);
    k.box(m("#4f4d48", "fabric"), [0, .43, .36], [.87, .35, .02]);
    for (let i = 0; i < 8; i++) k.box(m(["#579d9b", "#d5a153", "#c76c6a"][i % 3]!, "paper"), [-.31 + i * .083, .43, .38], [.024, .27 + i % 2 * .03, .035]);
    k.box(wood, [0, .715, 0], [1.94, .06, .77]);
    k.box(m("#44474b", "paint"), [0, .78, -.02], [.72, .07, .51]);
    k.add("cyl", m("#27363a", "rubber"), [-.08, .822, -.02], [.41, .015, .41]);
    k.add("cyl", m("#d78956", "paper"), [-.08, .832, -.02], [.1, .004, .1]);
    rod(k, brass, [.25, .84, -.18], [.23, .85, .1], .009);
    rod(k, brass, [.23, .85, .1], [.12, .85, .13], .009);
    k.box(m("#d3e5e1", "glass", .28), [0, 1.05, -.245], [.73, .48, .012]);
    for (const x of [-.28, .28]) k.add("cyl", brass, [x, .78, .235], [.04, .02, .04], { rot: [Math.PI / 2, 0, 0] });
  },
  eggchair: (k, _w, _d, p, m) => {
    const metal = m(color(p, "metal", "#3d5860"), "metal"), cane = m(color(p, "wood", "#b4834f"), "timber"), fab = m(color(p, "fabric", "#e29a5f"), "fabric");
    // Stable floor stand and a swept mast, all contained in the reserved 2 x 2 footprint.
    k.add("torus", metal, [0, .014, -.05], [1.55, 1.55, .16], { rot: [Math.PI / 2, 0, 0] });
    const mast: Point[] = [[0, .06, -.72], [0, 1.35, -.72], [0, 1.94, -.6], [0, 2.13, -.3], [0, 2.13, 0]];
    for (let i = 1; i < mast.length; i++) rod(k, metal, mast[i - 1]!, mast[i]!, .026);
    rod(k, metal, [0, 2.13, 0], [0, 1.75, 0], .009);
    // Back half of an ellipsoid; the front remains open to the seated avatar.
    for (let r = 0; r < 9; r++) {
      const y = .34 + r * .165, radius = .63 * Math.sqrt(Math.max(.08, 1 - ((y - 1) / .8) ** 2));
      let was: Point | null = null;
      for (let j = 0; j <= 16; j++) {
        const a = Math.PI + j * Math.PI / 16, at: Point = [Math.cos(a) * radius, y, Math.sin(a) * radius * .8];
        if (was) rod(k, cane, was, at, .012); was = at;
      }
    }
    for (let j = 0; j <= 10; j++) {
      const a = Math.PI + j * Math.PI / 10;
      let was: Point | null = null;
      for (let r = 0; r <= 12; r++) {
        const y = .28 + r * .122, radius = .63 * Math.sqrt(Math.max(.04, 1 - ((y - 1) / .8) ** 2));
        const at: Point = [Math.cos(a) * radius, y, Math.sin(a) * radius * .8];
        if (was) rod(k, cane, was, at, .01); was = at;
      }
    }
    k.add("soft", fab, [0, .42, .02], [1.06, .12, .84]);
    k.add("soft", fab, [0, .81, -.31], [.82, .61, .17], { rot: [-.12, 0, 0] });
    k.add("soft", m("#eed5a1", "fabric"), [.27, .68, -.1], [.34, .3, .13], { rot: [0, .3, -.2] });
  },
  pottingbench: (k, _w, _d, p, m) => {
    const wood = m(color(p, "wood", "#9e7f4e"), "timber"), body = m(color(p, "body", "#478b75"), "paint"), metal = m("#a9b2a8", "metal");
    legs(k, body, 1.78, .7, .86);
    for (let i = 0; i < 5; i++) k.box(wood, [0, .22, -.28 + i * .14], [1.72, .05, .11]);
    k.box(wood, [0, .88, 0], [1.91, .07, .85]);
    for (const x of [-.83, .83]) k.box(body, [x, 1.17, -.33], [.07, .64, .07]);
    for (const y of [1.05, 1.3, 1.48]) k.box(wood, [0, y, -.34], [1.78, .11, .05]);
    pot(k, m, -.56, .915, -.04, "#c97e53", true);
    pot(k, m, .47, .915, -.13, "#e4b164");
    pot(k, m, -.48, .245, 0, "#b8734a");
    k.box(m("#6c6650", "fabric"), [.38, .36, -.02], [.45, .22, .39]);
    k.add("cyl", metal, [.1, 1.25, -.27], [.045, .015, .045], { rot: [Math.PI / 2, 0, 0] });
    rod(k, metal, [.1, 1.24, -.24], [.1, 1.05, -.24], .012);
    k.add("sphere", metal, [.1, 1.02, -.24], [.08, .13, .025]);
    rod(k, wood, [.35, .94, .24], [.68, .94, .24], .014);
    k.add("sphere", metal, [.72, .94, .24], [.16, .025, .1]);
  },
};
