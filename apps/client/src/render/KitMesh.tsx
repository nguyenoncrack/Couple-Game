import { useEffect, useMemo } from "react";
import { Kit, type BuiltMesh } from "./kit";

/** Draw prebuilt kit meshes. */
export function Meshes({ meshes, raycast = true }: { meshes: BuiltMesh[]; raycast?: boolean }) {
  return (
    <>
      {meshes.map((b, i) => (
        <mesh key={i} geometry={b.geometry} material={b.material} raycast={raycast ? undefined : () => null} />
      ))}
    </>
  );
}

/** Build a kit and draw it; it rebuilds only when `deps` change, and frees the old geometry. */
export function KitMesh({ make, deps, raycast = false }: { make: (k: Kit) => void; deps: unknown[]; raycast?: boolean }) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const built = useMemo(() => {
    const k = new Kit();
    make(k);
    return k.parts.length ? k.build() : [];
  }, deps);
  useEffect(() => () => built.forEach((b) => b.geometry.dispose()), [built]);
  return <Meshes meshes={built} raycast={raycast} />;
}
