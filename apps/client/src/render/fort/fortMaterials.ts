import { PATTERNS, patternOf, type PatternId } from "@cg/shared";
import * as THREE from "three";
import { lighting, SUN_DIR } from "../pencil";

/**
 * The blanket's look: three patterns painted once onto small canvases (so there's nothing to download), and the
 * cloth material that shows one of them, goes warm from the inside when the fairy lights are on, and turns
 * see-through while somebody is in the fort so you can see them.
 */

const SIZE = 256;

function canvas() {
  const c = document.createElement("canvas");
  c.width = c.height = SIZE;
  return [c, c.getContext("2d")!] as const;
}

function star(g: CanvasRenderingContext2D, x: number, y: number, r: number, turn: number) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = turn + (i * Math.PI) / 5 - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
  g.fill();
}

/** A tiny deterministic generator, so a pattern looks the same every time. */
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Paint one pattern (any of the catalog's, by id) onto a square canvas that tiles. */
export function paintPattern(id: PatternId | string, size = SIZE): HTMLCanvasElement {
  const p = patternOf(id);
  const [c, g] = canvas();
  c.width = c.height = size;
  const k = size / SIZE;
  g.scale(k, k);
  g.fillStyle = p.base;
  g.fillRect(0, 0, SIZE, SIZE);
  if (p.id === "gingham") {
    // wide bands both ways: where they cross it's darkest
    g.fillStyle = p.accent;
    g.globalAlpha = 0.72;
    for (let i = 0; i < 4; i++) {
      g.fillRect(i * 64, 0, 32, SIZE);
      g.fillRect(0, i * 64, SIZE, 32);
    }
    g.globalAlpha = 1;
    // a few tiny stitches
    g.fillStyle = "#ffffff";
    g.globalAlpha = 0.4;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) g.fillRect(i * 64 + 14, j * 64 + 14, 4, 4);
    g.globalAlpha = 1;
  } else if (p.id === "stars") {
    const r = rng(7);
    g.fillStyle = "#3c4a8c";
    for (let i = 0; i < 18; i++) {
      g.beginPath();
      g.arc(r() * SIZE, r() * SIZE, 14 + r() * 26, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = p.accent;
    // stars, a few dots, all kept away from the edges so the tile joins up
    for (const [x, y, s, t] of [
      [64, 60, 22, 0.2],
      [180, 40, 14, 0.5],
      [200, 150, 24, 0.1],
      [96, 180, 15, 0.4],
      [30, 210, 11, 0.3],
      [150, 230, 10, 0.2],
    ] as const)
      star(g, x, y, s, t);
    for (const [x, y] of [[120, 110], [40, 130], [230, 90], [130, 20], [220, 220], [70, 250], [10, 40]] as const) {
      g.beginPath();
      g.arc(x, y, 3, 0, Math.PI * 2);
      g.fill();
    }
  } else {
    // patchwork: sixteen patches in a few related colours, with stitching between them
    const tones = [p.base, p.accent, "#e8a58f", "#f4efe0", "#b9cde0", "#e9c66a"];
    const r = rng(11);
    const n = 4;
    const cell = SIZE / n;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        g.fillStyle = tones[Math.floor(r() * tones.length)]!;
        g.fillRect(i * cell, j * cell, cell, cell);
        g.fillStyle = "rgba(255,255,255,0.35)";
        if ((i + j) % 2) {
          g.beginPath();
          g.moveTo(i * cell + cell / 2, j * cell + 8);
          g.lineTo(i * cell + cell - 8, j * cell + cell / 2);
          g.lineTo(i * cell + cell / 2, j * cell + cell - 8);
          g.lineTo(i * cell + 8, j * cell + cell / 2);
          g.closePath();
          g.fill();
        }
      }
    g.strokeStyle = "rgba(90,60,40,0.55)";
    g.lineWidth = 2;
    g.setLineDash([7, 5]);
    for (let i = 0; i <= n; i++) {
      g.beginPath();
      g.moveTo(i * cell, 0);
      g.lineTo(i * cell, SIZE);
      g.moveTo(0, i * cell);
      g.lineTo(SIZE, i * cell);
      g.stroke();
    }
  }
  return c;
}

const textures = new Map<string, THREE.Texture>();
export function patternTexture(id: PatternId | string): THREE.Texture {
  let t = textures.get(id);
  if (!t) {
    t = new THREE.CanvasTexture(paintPattern(id));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    textures.set(id, t);
  }
  return t;
}

/** A picture of a pattern for the panel's swatches. */
export const patternDataUrl = (id: string) => paintPattern(id, 64).toDataURL();

/** The warm colour the fabric glows. */
const GLOW = new THREE.Color("#ffb65a");

/** One fort's blanket. Its own material, since its pattern, glow and see-through-ness are its own. */
export function canopyMaterial(pattern: PatternId | string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    transparent: true,
    toneMapped: false,
    uniforms: {
      uMap: { value: patternTexture(pattern) },
      uGlow: { value: 0 },
      uOpacity: { value: 1 },
      uSun: { value: SUN_DIR },
      uTint: lighting.tint,
      uGlowColor: { value: GLOW },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vN;
      void main() {
        vUv = uv;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform float uGlow, uOpacity;
      uniform vec3 uSun, uTint, uGlowColor;
      varying vec2 vUv;
      varying vec3 vN;
      void main() {
        vec3 base = texture2D(uMap, vUv).rgb;
        vec3 n = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
        float diff = 0.66 + 0.34 * max(dot(n, normalize(uSun)), 0.0);
        vec3 day = base * diff * uTint;
        // lit from inside: the cloth glows a warm amber and the pattern shows through it, most of all from within
        float luma = dot(base, vec3(0.299, 0.587, 0.114));
        vec3 warm = uGlowColor * (0.5 + 1.1 * luma) + base * 0.12;
        float inside = gl_FrontFacing ? 0.72 : 1.0;
        vec3 col = mix(day, warm, clamp(uGlow * inside, 0.0, 1.0));
        gl_FragColor = vec4(col, uOpacity);
        #include <colorspace_fragment>
      }
    `,
  });
}

/** Text on a small canvas for the name plaque and the entrance note, in the game's handwriting. */
export function drawNote(canvas: HTMLCanvasElement, text: string, opts: { ground: string; ink: string; lines: number; size: number }) {
  const g = canvas.getContext("2d")!;
  const { width: W, height: H } = canvas;
  g.clearRect(0, 0, W, H);
  g.fillStyle = opts.ground;
  g.fillRect(0, 0, W, H);
  g.fillStyle = opts.ink;
  g.textAlign = "center";
  g.textBaseline = "middle";
  const family = `"Patrick Hand", "Segoe Print", "Bradley Hand", cursive`;
  const words = text.split(" ");
  let size = opts.size;
  let lines: string[] = [];
  for (; size >= 14; size -= 2) {
    g.font = `${size}px ${family}`;
    lines = [];
    let cur = "";
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (g.measureText(next).width > W - 28 && cur) {
        lines.push(cur);
        cur = w;
      } else cur = next;
    }
    lines.push(cur);
    if (lines.length <= opts.lines && lines.every((l) => g.measureText(l).width <= W - 24)) break;
  }
  const lh = size * 1.12;
  lines.slice(0, opts.lines).forEach((l, i, all) => g.fillText(l, W / 2, H / 2 + (i - (all.length - 1) / 2) * lh));
}

export { PATTERNS };
