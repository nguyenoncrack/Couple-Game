import * as THREE from "three";
import { Kit } from "../../render/kit";
import { pencilMaterial } from "../../render/pencil";
import type { Hairstyle } from "./appearance";

/** Fit cosmetic hair around the existing head; the animation rig and hit area are untouched. */
export function addCustomHair(k: Kit, mat: THREE.Material, style: Hairstyle, headY: number) {
  const source = new Kit();
  addHair(source, mat, style);
  const transform = new THREE.Matrix4().makeTranslation(0, headY, 0)
    .multiply(new THREE.Matrix4().makeScale(0.26 / 0.4, 0.28 / 0.46, 0.25 / 0.37))
    .multiply(new THREE.Matrix4().makeTranslation(0, -1.49, 0));
  for (const part of source.parts) {
    const geometry = part.geo.clone().applyMatrix4(transform.clone().multiply(part.m));
    k.add(geometry, mat, [0, 0, 0], 1, { outline: part.outline, normals: true });
  }
}

function addHair(k: Kit, mat: THREE.Material, style: Hairstyle) {
  const fine = { outline: 0.004 };
  k.add("half", mat, [0, 1.6, -0.01], [0.425, 0.26, 0.405], fine);
  k.add("soft", mat, [0, 1.54, -0.145], [0.405, 0.22, 0.14], fine);
  // Hair behind the head stays open at the front, so faces and skin tones remain visible.
  if (["bob", "long", "waves"].includes(style)) {
    const long = style !== "bob";
    k.add("soft", mat, [0, long ? 1.32 : 1.43, -0.125], [0.445, long ? 0.7 : 0.47, 0.22], fine);
    for (const s of [-1, 1]) k.add("soft", mat, [s * 0.197, long ? 1.33 : 1.43, 0.015], [0.085, long ? 0.65 : 0.42, 0.18], fine);
  }
  if (style === "buzz") return;
  if (style === "side-part") {
    k.add("soft", mat, [-0.047, 1.668, 0.076], [0.35, 0.15, 0.26], { ...fine, rot: [0, 0, -0.15] });
    k.add("soft", mat, [0.14, 1.63, 0.075], [0.105, 0.16, 0.23], { ...fine, rot: [0, 0, 0.18] });
  }
  if (style === "quiff") {
    k.add("soft", mat, [-0.025, 1.73, 0.07], [0.35, 0.22, 0.27], { ...fine, rot: [-0.22, 0, -0.15] });
    k.add("soft", mat, [-0.15, 1.68, -0.04], [0.14, 0.18, 0.25], fine);
  }
  if (style === "curls") {
    for (let i = 0; i < 15; i++) {
      const a = i / 15 * Math.PI * 2;
      k.add("blob", mat, [Math.sin(a) * 0.17, 1.65 + Math.cos(a * 3) * 0.025, Math.cos(a) * 0.15], 0.15, fine);
    }
    for (let i = 0; i < 5; i++) k.add("blob", mat, [(i % 3 - 1) * 0.1, 1.73, (Math.floor(i / 3) - 0.5) * 0.12], 0.15, fine);
  }
  if (["curtains", "long", "waves"].includes(style)) {
    for (const s of [-1, 1]) k.add("soft", mat, [s * 0.105, 1.65, 0.12], [0.2, 0.2, 0.14], { ...fine, rot: [0, 0, s * 0.3] });
  }
  if (style === "top-knot") k.add("soft", mat, [0, 1.76, -0.11], [0.21, 0.2, 0.22], fine);
  if (["bob", "ponytail", "braid", "space-buns"].includes(style)) k.add("soft", mat, [-0.03, 1.655, 0.125], [0.34, 0.12, 0.15], { ...fine, rot: [0, 0, -0.13] });
  if (style === "ponytail") {
    k.add("sphere", mat, [0, 1.57, -0.215], [0.19, 0.2, 0.18], fine);
    k.add("soft", mat, [0, 1.34, -0.29], [0.17, 0.48, 0.17], { ...fine, rot: [-0.16, 0, 0] });
  }
  if (style === "braid") {
    for (let i = 0; i < 7; i++) k.add("soft", mat, [(i % 2 ? -1 : 1) * 0.018, 1.48 - i * 0.07, -0.23 - i * 0.007], [0.15 - i * 0.009, 0.13, 0.12], { ...fine, rot: [0, 0, (i % 2 ? -1 : 1) * 0.35] });
    k.add("cyl", pencilMaterial("#d5aa78"), [0, 1.025, -0.279], [0.08, 0.025, 0.08], fine);
  }
  if (style === "space-buns") for (const s of [-1, 1]) k.add("soft", mat, [s * 0.215, 1.7, -0.035], [0.21, 0.22, 0.22], fine);
  if (style === "waves") for (const s of [-1, 1]) for (let i = 0; i < 4; i++) k.add("soft", mat, [s * (0.19 + (i % 2 ? 0.025 : -0.01)), 1.43 - i * 0.1, -0.035], [0.13, 0.18, 0.22], { ...fine, rot: [0, 0, s * (i % 2 ? 0.15 : -0.15)] });
}
