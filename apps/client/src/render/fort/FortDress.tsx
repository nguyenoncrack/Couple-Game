import { emptyFort } from "@cg/shared";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { useGame } from "../../state/game";
import { bulbPositions, canopyGeometry, DOOR_W, FORT_H } from "./fortModels";
import { canopyMaterial, drawNote, patternTexture } from "./fortMaterials";

/**
 * What makes a placed fort a fort: its blanket (in its pattern, glowing warm from inside when the fairy lights are
 * on, and see-through while somebody's in it so you can see them), the name plaque and the handwritten note at the
 * door, and the glow of the lights themselves. It sits inside the frame's own group, so it turns and picks with it.
 * Only the cloth and a few small glowing things: no real lights and no shadows.
 */

const reduceMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** How fast things ease (a bigger number is quicker). */
const EASE = 4;
const SEE_THROUGH = 0.58;
/** The middle of the lights' cell, from the middle of the frame. */
const LIGHTS_AT: [number, number] = [0, -0.5];

const glowSprite = (() => {
  let t: THREE.CanvasTexture | null = null;
  return () => {
    if (!t) {
      const c = document.createElement("canvas");
      c.width = c.height = 64;
      const g = c.getContext("2d")!;
      const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      r.addColorStop(0, "rgba(255,255,255,1)");
      r.addColorStop(0.4, "rgba(255,255,255,0.5)");
      r.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = r;
      g.fillRect(0, 0, 64, 64);
      t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
    }
    return t;
  };
})();

const additive = (opts: THREE.MeshBasicMaterialParameters) => new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false, ...opts });

/** A canvas texture for a bit of writing, redrawn when the words change (and once the handwriting font is in). */
function useNote(text: string, opts: Parameters<typeof drawNote>[2], width: number, height: number) {
  const canvas = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    return c;
  }, [width, height]);
  const texture = useMemo(() => {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [canvas]);
  useEffect(() => {
    let live = true;
    const draw = () => {
      drawNote(canvas, text, opts);
      texture.needsUpdate = true;
    };
    draw();
    // the handwriting font may still be on its way
    void document.fonts?.load(`32px "Patrick Hand"`).then(() => live && draw());
    return () => {
      live = false;
    };
  }, [canvas, texture, text, opts]);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

const PLAQUE = { ground: "#d9ae74", ink: "#3b2a1a", lines: 2, size: 44 };
const NOTE = { ground: "#fff6d8", ink: "#4a3a52", lines: 4, size: 30 };

export function FortDress({ id }: { id: string }) {
  const fort = useGame((s) => s.life?.forts?.[id]) ?? emptyFort();
  const occupied = useGame((s) => Object.values(s.life?.avatars ?? {}).some((a) => a.use?.objectId === id && a.use.action === "fort"));
  const inside = useGame((s) => Boolean(s.mode === "live" && s.firstPerson && s.me && s.life?.avatars[s.me]?.use?.objectId === id && s.life.avatars[s.me]?.use?.action === "fort"));
  const geometry = useMemo(() => canopyGeometry(), []);
  const material = useMemo(() => canopyMaterial(fort.pattern), []); // eslint-disable-line react-hooks/exhaustive-deps
  const parts = useMemo(
    () => ({
      pool: additive({ color: "#ffb65a", opacity: 0, map: glowSprite() }),
      door: additive({ color: "#ffb65a", opacity: 0, map: glowSprite(), side: THREE.DoubleSide }),
      bulb: additive({ map: glowSprite() }),
      disc: new THREE.CircleGeometry(1.25, 32).rotateX(-Math.PI / 2),
      plane: new THREE.PlaneGeometry(1, 1),
      // a bulb's halo: three crossed squares of soft light, so it glows from every side
      halo: mergeGeometries([new THREE.PlaneGeometry(0.2, 0.2), new THREE.PlaneGeometry(0.2, 0.2).rotateY(Math.PI / 2), new THREE.PlaneGeometry(0.2, 0.2).rotateX(Math.PI / 2)])!,
    }),
    [],
  );
  const bulbs = useRef<THREE.InstancedMesh>(null);
  const spots = useMemo(() => bulbPositions(), []);
  const glow = useRef(fort.lit ? 1 : 0);
  const opacity = useRef(1);
  const steady = useMemo(reduceMotion, []);
  const c = useMemo(() => new THREE.Color(), []);

  useEffect(() => {
    material.uniforms.uMap!.value = patternTexture(fort.pattern);
  }, [material, fort.pattern]);
  useEffect(() => {
    const mesh = bulbs.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    spots.forEach((p, i) => mesh.setMatrixAt(i, m.makeTranslation(p[0] + LIGHTS_AT[0], p[1] + 0.02, p[2] + LIGHTS_AT[1])));
    mesh.instanceMatrix.needsUpdate = true;
  }, [spots]);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
      for (const m of [parts.pool, parts.door, parts.bulb]) m.dispose();
      parts.disc.dispose();
      parts.plane.dispose();
      parts.halo.dispose();
    },
    [geometry, material, parts],
  );

  useFrame(({ clock }, dt) => {
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * EASE);
    glow.current += ((fort.lit ? 1 : 0) - glow.current) * k;
    // see-through while someone's in (so they can be seen), solid again once they leave, and solid from the inside
    const target = occupied && !inside ? SEE_THROUGH : 1;
    opacity.current += (target - opacity.current) * k;
    const g = Math.abs(glow.current) < 0.003 ? 0 : glow.current;
    material.uniforms.uGlow!.value = g;
    material.uniforms.uOpacity!.value = opacity.current;
    material.depthWrite = opacity.current > 0.97;
    parts.pool.opacity = g * 0.42;
    parts.door.opacity = g * 0.5 * (inside ? 0 : 1);
    const mesh = bulbs.current;
    if (mesh) {
      mesh.visible = g > 0.01;
      if (mesh.visible) {
        // a slow, shallow shimmer on each bulb (a steady glow if the device asks for less motion)
        const t = clock.elapsedTime;
        spots.forEach((_, i) => mesh.setColorAt(i, c.setScalar(g * (steady ? 1 : 0.88 + 0.12 * Math.sin(t * 0.9 + i * 1.7)) * 1.1)));
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
  });

  const plaque = useNote(fort.name, PLAQUE, 256, 80);
  const note = useNote(fort.sign, NOTE, 128, 128);
  const slope = Math.atan2(0.95, 1.36);

  return (
    <>
      <mesh geometry={geometry} material={material} renderOrder={3} />
      <mesh geometry={parts.disc} material={parts.pool} position={[0, 0.03, 1.4]} renderOrder={1} raycast={() => null} />
      <mesh geometry={parts.plane} material={parts.door} position={[0, 0.5, 0.78]} scale={[1.35, 1.1, 1]} renderOrder={4} raycast={() => null} />
      <instancedMesh ref={bulbs} args={[parts.halo, parts.bulb, spots.length]} frustumCulled={false} visible={false} renderOrder={5} raycast={() => null} />
      {fort.name && (
        // the name, on a little plaque hung over the door
        <group position={[0, 0.86, 0.5]} rotation-x={-0.2}>
          <mesh position={[0, 0, -0.012]} raycast={() => null}>
            <boxGeometry args={[0.7, 0.24, 0.02]} />
            <meshBasicMaterial color="#a77a47" />
          </mesh>
          <mesh position={[0, 0, 0]} raycast={() => null}>
            <planeGeometry args={[0.66, 0.2]} />
            <meshBasicMaterial map={plaque} toneMapped={false} />
          </mesh>
          {[-0.28, 0.28].map((x) => (
            <mesh key={x} position={[x, 0.2, -0.01]} raycast={() => null}>
              <boxGeometry args={[0.012, 0.18, 0.012]} />
              <meshBasicMaterial color="#e8d9b8" />
            </mesh>
          ))}
        </group>
      )}
      {fort.sign && (
        // the handwritten note, pinned to the blanket beside the door
        <group position={[-0.95, 0.5, 0.62]} rotation={[-slope + 0.04, 0, 0.07]}>
          <mesh raycast={() => null}>
            <planeGeometry args={[0.32, 0.32]} />
            <meshBasicMaterial map={note} toneMapped={false} />
          </mesh>
          <mesh position={[0, 0.13, 0.01]} raycast={() => null}>
            <sphereGeometry args={[0.022, 8, 6]} />
            <meshBasicMaterial color="#d9534f" />
          </mesh>
        </group>
      )}
    </>
  );
}

export { DOOR_W, FORT_H };
