import { describe, expect, it } from "vitest";
import { folkLayout, MAX_FOLK, walkerAt } from "./folkLayout";
import { campLayout, lakeShape, playLayout } from "./sceneryLayout";

describe.each([[24, 20], [30, 26]])("folk round a %i × %i lot", (w, d) => {
  const folk = folkLayout(w, d);
  const lake = lakeShape(w);
  const inLot = (x: number, z: number) => x > -1 && x < w + 1 && z > -1 && z < d + 0.5;
  const kinds = (k: string) => folk.filter((f) => f.kind === k);

  it("is the same every time, a bounded few at each spot", () => {
    expect(JSON.stringify(folkLayout(w, d))).toBe(JSON.stringify(folk));
    expect(folk.length).toBeLessThanOrEqual(MAX_FOLK);
    expect(new Set(folk.map((f) => f.id)).size).toBe(folk.length);
    expect(kinds("chat").length + kinds("roast").length).toBeGreaterThanOrEqual(2);
    expect(kinds("swing").length + kinds("slide").length + kinds("dig").length).toBeGreaterThanOrEqual(2);
    expect(kinds("walk").length).toBeGreaterThanOrEqual(2);
  });

  it("seats the campers round the fire, facing it", () => {
    const [fx, , fz] = campLayout(d).fire;
    for (const f of [...kinds("chat"), ...kinds("roast")]) {
      const r = Math.hypot(f.x - fx, f.z - fz);
      expect(r).toBeGreaterThan(1.5);
      expect(r).toBeLessThan(2.8);
      // facing: the way they look points at the fire
      const dot = (Math.sin(f.ry) * (fx - f.x) + Math.cos(f.ry) * (fz - f.z)) / r;
      expect(dot).toBeGreaterThan(0.95);
      expect(f.seat).toBeGreaterThan(0.3);
    }
  });

  it("keeps the children on the playground", () => {
    const { cx, cz } = playLayout(w, d);
    for (const f of [...kinds("swing"), ...kinds("push"), ...kinds("slide"), ...kinds("dig")]) {
      expect(Math.abs(f.x - cx)).toBeLessThan(3.5);
      expect(Math.abs(f.z - cz)).toBeLessThan(3.7);
    }
  });

  it("never puts anyone on the lot or in the lake, walkers included all along their way", () => {
    for (const f of folk) {
      expect(inLot(f.x, f.z)).toBe(false);
      expect(lake.inside(f.x, f.z)).toBe(false);
    }
    for (const f of kinds("walk")) {
      for (let t = 0; t < 400; t += 0.5) {
        const p = walkerAt(f, t);
        expect(inLot(p.x, p.z)).toBe(false);
        expect(lake.inside(p.x, p.z)).toBe(false);
      }
    }
  });

  it("walks the whole way and back, pausing at each end", () => {
    const f = kinds("walk")[0]!;
    const start = f.route![0]!;
    const end = f.route![f.route!.length - 1]!;
    const seen = Array.from({ length: 2000 }, (_, i) => walkerAt(f, i * 0.25 - f.phase));
    expect(seen.some((p) => Math.hypot(p.x - end[0], p.z - end[1]) < 0.5)).toBe(true);
    expect(seen.some((p) => Math.hypot(p.x - start[0], p.z - start[1]) < 0.5)).toBe(true);
    expect(seen.some((p) => !p.moving)).toBe(true);
  });
});
