import * as THREE from "three";
import { Kit } from "../../render/kit";
import { pencilMaterial } from "../../render/pencil";
import { shade } from "../../render/models";
import { appearanceColors, normalizeAppearance, type Appearance } from "./appearance";
import { addCustomHair } from "./characterModel";

const SKIN = ["#f1d2b6", "#e2b48f", "#c68d63", "#9a6644", "#6e4630"];
const HAIR = ["#3b2b22", "#6b4630", "#b9874f", "#2a2522", "#8a3f2a", "#d8c28e"];
type HairStyle = "short" | "bun" | "long" | "curly";
const STYLES: HairStyle[] = ["short", "bun", "long", "curly"];

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Looks picked from the member ID, so each person always looks the same on both screens. */
export function looksFor(id: string, color: string) {
  const h = hash(id);
  return {
    skin: SKIN[h % SKIN.length]!,
    hair: HAIR[(h >>> 4) % HAIR.length]!,
    style: STYLES[(h >>> 8) % STYLES.length]!,
    sweater: color,
    trousers: ["#4d5866", "#5e5246", "#3f4a3c"][(h >>> 12) % 3]!,
  };
}

/** Body measurements in metres. */
export const HIP = 0.8;
export const THIGH = 0.4;
export const SHIN = 0.38;
export const TORSO = 0.56;
export const ARM = 0.52;
export const SHOULDER = 0.19;

type Looks = ReturnType<typeof looksFor> & { appearance?: Appearance };
export function customizedLooks(appearance: Appearance): Looks {
  const colors = appearanceColors(appearance);
  return { skin: colors.skin, hair: colors.hair, style: "short", sweater: colors.shirt, trousers: colors.bottom, appearance };
}


export function torso(k: Kit, l: Looks) {
  const sweater = pencilMaterial(l.sweater, { finish: "fabric" });
  const cuff = pencilMaterial(shade(l.sweater, 0.82), { finish: "fabric" });
  const skin = pencilMaterial(l.skin);
  const hair = pencilMaterial(l.hair, { finish: "fabric" });
  const ink = pencilMaterial("#3a3631");
  // hips and sweater
  k.add("soft", pencilMaterial(l.trousers, { finish: "fabric" }), [0, 0.02, 0], [0.34, 0.16, 0.22]);
  k.add("soft", sweater, [0, TORSO / 2 + 0.02, 0], [0.38, TORSO, 0.24]);
  k.add("cyl", cuff, [0, 0.09, 0], [0.37, 0.07, 0.23], { outline: 0.006 });
  // neck and head
  k.add("cyl", skin, [0, TORSO + 0.06, 0], [0.09, 0.1, 0.09], {
    outline: false,
  });
  const hy = TORSO + 0.22;
  k.add("sphere", skin, [0, hy, 0], [0.26, 0.28, 0.25]);
  for (const sx of [-1, 1])
    k.add("sphere", ink, [sx * 0.055, hy + 0.01, 0.118], 0.026, {
      outline: false,
    });
  k.add("sphere", pencilMaterial(shade(l.skin, 0.85)), [0, hy - 0.035, 0.125], [0.04, 0.03, 0.03], { outline: false });
  if (l.appearance) addCustomHair(k, hair, l.appearance.hairstyle, hy);
  else {
  // hair
  k.add("half", hair, [0, hy + 0.02, -0.01], [0.285, 0.26, 0.275]);
  if (l.style === "bun") k.add("sphere", hair, [0, hy + 0.13, -0.09], 0.12);
  if (l.style === "long") k.add("soft", hair, [0, hy - 0.1, -0.08], [0.27, 0.3, 0.1]);
  if (l.style === "curly")
    for (let i = 0; i < 7; i++) k.add("sphere", hair, [Math.cos(i * 0.9) * 0.12, hy + 0.08 + (i % 2) * 0.04, Math.sin(i * 0.9) * 0.1 - 0.02], 0.1);
  if (l.style === "short")
    k.add("soft", hair, [0, hy + 0.08, 0.06], [0.24, 0.07, 0.12], {
      rot: [0.3, 0, 0],
    });
  }
}

export function arm(k: Kit, l: Looks) {
  k.add("soft", pencilMaterial(l.sweater, { finish: "fabric" }), [0, -ARM / 2 + 0.04, 0], [0.11, ARM - 0.06, 0.11]);
  k.add("sphere", pencilMaterial(l.skin), [0, -ARM + 0.02, 0], 0.085);
}

export function thigh(k: Kit, l: Looks, side: -1 | 1) {
  const skin = pencilMaterial(l.skin);
  const cloth = pencilMaterial(l.trousers, { finish: "fabric" });
  const outfit = l.appearance?.outfit ?? "long-pants";
  k.add("soft", outfit === "long-pants" ? cloth : skin, [0, -THIGH / 2, 0], [0.14, THIGH + 0.04, 0.15]);
  if (outfit === "shorts") k.add("soft", cloth, [0, -0.12, 0], [0.15, 0.28, 0.17]);
  if (outfit === "skirt") {
    // Two visual halves follow the existing thigh joints when walking or sitting.
    const panel = new THREE.CylinderGeometry(0.19, 0.25, 0.42, 16, 1, false, side > 0 ? 0 : Math.PI, Math.PI);
    panel.translate(-side * 0.09, -0.13, 0);
    k.add(panel, cloth, [0, 0, 0], 1, { outline: 0.006, normals: true });
  }
}

export function shin(k: Kit, l: Looks) {
  k.add("soft", pencilMaterial(l.appearance && l.appearance.outfit !== "long-pants" ? l.skin : l.trousers, { finish: l.appearance && l.appearance.outfit !== "long-pants" ? undefined : "fabric" }), [0, -SHIN / 2 + 0.02, 0], [0.12, SHIN, 0.13]);
  k.add("soft", pencilMaterial("#3d3833", { finish: "stone" }), [0, -SHIN + 0.03, 0.05], [0.13, 0.08, 0.24]);
}

/** Neutral preview built from the exact same body-part builders as the animated game character. */
export function buildPreviewCharacter(appearance: Appearance) {
  const looks = customizedLooks(normalizeAppearance(appearance));
  const k = new Kit();
  k.at([0, HIP, 0], 0, () => {
    torso(k, looks);
    for (const side of [-1, 1] as const) {
      k.at([side * SHOULDER, TORSO - 0.06, 0], 0, () => arm(k, looks));
      k.at([side * 0.09, 0, 0], 0, () => {
        thigh(k, looks, side);
        k.at([0, -THIGH, 0], 0, () => shin(k, looks));
      });
    }
  });
  return k.build();
}
