import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { lighting, SUN_DIR } from "./pencil";

/**
 * Real light for the pencil materials. Each frame, before the view is drawn, two quick depth-only pictures of the
 * scene are taken:
 *  - from the sun, so surfaces it can't reach fall into soft shadow;
 *  - from straight above, a height map, so floors and lawn darken a little where walls, furniture, people and
 *    trees stand close by or overhead (contact shadows).
 * Both are wired into the materials only while the main view is drawn, so other canvases that share the
 * materials draw without them.
 *
 * On a device that can't keep up (frames slower than ~30 a second for a few seconds) both are switched off and
 * the drawn contact patches under furniture come back in full. `?look=low` forces that, `?look=high` keeps
 * shadows on whatever the speed.
 */

const SHADOW_SIZE = 2048;
const HEIGHT_SIZE = 1024;
/** Heights above this (metres) all read as "tall". */
const HEIGHT_MAX = 8;
/** Room around the lot that shadows and contact shade cover: the fence, hedges and trees. */
const MARGIN = 9;
const SLOW_MS = 33;
const SLOW_FOR_MS = 3000;

const heightVertex = /* glsl */ `
  varying float vY;
  void main() {
    #ifdef USE_INSTANCING
      vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
    #else
      vec4 world = modelMatrix * vec4(position, 1.0);
    #endif
    vY = world.y;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;
const heightFragment = /* glsl */ `
  uniform float uMax;
  varying float vY;
  void main() {
    gl_FragColor = vec4(clamp(vY / uMax, 0.0, 1.0), 0.0, 0.0, 1.0);
  }
`;

/** Maps clip space (-1..1) to texture space (0..1). */
const BIAS = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);

function quality(): "auto" | "high" | "low" {
  const q = new URLSearchParams(location.search).get("look");
  return q === "low" || q === "high" ? q : "auto";
}

/** Meshes worth casting: solid surfaces, not outlines, glass, ghosts, markers or the drawn contact patches. */
function casts(o: THREE.Object3D) {
  const m = (o as THREE.Mesh).material as THREE.Material | undefined;
  if (!(o as THREE.Mesh).isMesh || !m || Array.isArray(m)) return false;
  return !m.transparent && m.side !== THREE.BackSide && m.colorWrite !== false;
}

export function Sunlight({ w, d }: { w: number; d: number }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);

  const passes = useMemo(() => {
    const depth = new THREE.DepthTexture(SHADOW_SIZE, SHADOW_SIZE);
    depth.compareFunction = THREE.LessEqualCompare;
    depth.minFilter = depth.magFilter = THREE.LinearFilter;
    const shadow = new THREE.WebGLRenderTarget(SHADOW_SIZE, SHADOW_SIZE, { depthTexture: depth });
    const height = new THREE.WebGLRenderTarget(HEIGHT_SIZE, HEIGHT_SIZE, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    return {
      shadow,
      height,
      sunCam: new THREE.OrthographicCamera(),
      topCam: new THREE.OrthographicCamera(),
      depthOnly: new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide }),
      heights: new THREE.ShaderMaterial({ vertexShader: heightVertex, fragmentShader: heightFragment, uniforms: { uMax: { value: HEIGHT_MAX } }, side: THREE.DoubleSide }),
      mode: quality(),
      on: quality() !== "low",
      slowSince: 0,
      turn: false,
      hidden: [] as THREE.Object3D[],
    };
  }, []);

  // aim both cameras at the lot
  useEffect(() => {
    const cx = w / 2;
    const cz = d / 2;
    const half = Math.max(w, d) / 2 + MARGIN;
    const { sunCam, topCam } = passes;
    sunCam.left = sunCam.bottom = -half;
    sunCam.right = sunCam.top = half;
    sunCam.near = 1;
    sunCam.far = 160;
    sunCam.position.set(cx, 0, cz).addScaledVector(SUN_DIR, 70);
    sunCam.lookAt(cx, 0, cz);
    sunCam.updateMatrixWorld();
    sunCam.updateProjectionMatrix();
    lighting.shadowMatrix.value.copy(BIAS).multiply(sunCam.projectionMatrix).multiply(sunCam.matrixWorldInverse);
    lighting.shadowTexel.value = 1 / SHADOW_SIZE;

    topCam.left = topCam.bottom = -half;
    topCam.right = topCam.top = half;
    topCam.near = 0.5;
    topCam.far = HEIGHT_MAX + 4;
    topCam.position.set(cx, HEIGHT_MAX + 2, cz);
    topCam.up.set(0, 0, -1);
    topCam.lookAt(cx, 0, cz);
    topCam.updateMatrixWorld();
    topCam.updateProjectionMatrix();
    lighting.heightMatrix.value.copy(BIAS).multiply(topCam.projectionMatrix).multiply(topCam.matrixWorldInverse);
    // one metre along x and z, in the height map's texture coordinates (z runs up the picture)
    lighting.heightScale.value.set(HEIGHT_MAX, 1 / (half * 2), -1 / (half * 2));
    lighting.focus.value.set(cx, cz, Math.hypot(w, d) / 2 + 4);
  }, [w, d, passes]);

  // the maps light the main view only
  useEffect(() => {
    const before = scene.onBeforeRender;
    const after = scene.onAfterRender;
    scene.onBeforeRender = (...args) => {
      before.apply(scene, args);
      if (!passes.on) return;
      lighting.shadowMap.value = passes.shadow.depthTexture;
      lighting.heightMap.value = passes.height.texture;
      lighting.shadowOn.value = 1;
      lighting.heightOn.value = 1;
      lighting.contact.value = 0.35;
    };
    scene.onAfterRender = (...args) => {
      after.apply(scene, args);
      lighting.shadowMap.value = null;
      lighting.heightMap.value = null;
      lighting.shadowOn.value = 0;
      lighting.heightOn.value = 0;
      lighting.contact.value = 1;
    };
    if (import.meta.env.DEV) Object.assign(window, { __gl: gl, __scene: scene, __sunlight: passes });
    return () => {
      scene.onBeforeRender = before;
      scene.onAfterRender = after;
    };
  }, [scene, gl, passes]);

  useEffect(
    () => () => {
      passes.shadow.dispose();
      passes.height.dispose();
      passes.depthOnly.dispose();
      passes.heights.dispose();
    },
    [passes],
  );

  useFrame((state, dt) => {
    lighting.time.value = state.clock.elapsedTime;

    // fall back to the light version if frames run slow for a while (and the page is actually on screen)
    if (passes.mode === "auto" && passes.on && !document.hidden) {
      const now = performance.now();
      if (dt * 1000 > SLOW_MS) {
        if (!passes.slowSince) passes.slowSince = now;
        else if (now - passes.slowSince > SLOW_FOR_MS) passes.on = false;
      } else passes.slowSince = 0;
    }
    if (!passes.on) return;

    const hidden = passes.hidden;
    hidden.length = 0;
    scene.traverseVisible((o) => {
      if ((o as THREE.Mesh).isMesh || (o as THREE.Line).isLine || (o as THREE.Points).isPoints || (o as THREE.Sprite).isSprite) {
        if (!casts(o)) hidden.push(o);
      }
    });
    for (const o of hidden) o.visible = false;
    const background = scene.background;
    scene.background = null;
    const target = gl.getRenderTarget();
    const clear = gl.getClearColor(new THREE.Color());
    const clearAlpha = gl.getClearAlpha();
    gl.setClearColor(0x000000, 0);

    // the two pictures take turns, one a frame, which halves their cost; a frame's lag in a shadow doesn't show
    passes.turn = !passes.turn;
    scene.overrideMaterial = passes.turn ? passes.depthOnly : passes.heights;
    gl.setRenderTarget(passes.turn ? passes.shadow : passes.height);
    gl.clear();
    gl.render(scene, passes.turn ? passes.sunCam : passes.topCam);

    scene.overrideMaterial = null;
    gl.setRenderTarget(target);
    gl.setClearColor(clear, clearAlpha);
    scene.background = background;
    for (const o of hidden) o.visible = true;
  });

  return null;
}
