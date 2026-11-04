import { describe, expect, it } from "vitest";
import { emptyBlueprint, type Blueprint } from "../blueprint";
import { catalog } from "../catalog";
import { edgesBetween } from "../grid";
import { AUTO_AFTER_MS, URGENT } from "../life/autonomy";
import { slotsOf } from "../life/interactions";
import { Life } from "../life/engine";
import { needsAt, NEEDS, START_NEEDS, type NeedValues } from "../life/needs";
import { activityAt, arrivalTime, emptyLife } from "../life/state";
import { Op } from "../ops";
import { applyOp } from "../rules";
import { withStarterHouse } from "../starter";

let n = 0;
const ids = () => `id${String(++n).padStart(8, "0")}`;
const starter = () => withStarterHouse(emptyBlueprint(24, 20), ids);

/** The same "random" every run. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const T0 = 1_000_000;

function house(seed = 1, members = ["ana"]) {
  const bp = starter();
  const life = new Life(emptyLife(), catalog, ids, seeded(seed)).enableFreeWill();
  for (const m of members) life.ensureAvatar(m, bp, T0);
  return { bp, life };
}

function setNeeds(life: Life, id: string, v: Partial<NeedValues>, at = T0) {
  life.state.avatars[id]!.needs = { v: { ...START_NEEDS, ...v }, at, live: true };
}

/** Let time pass, waking whenever the house says something's due (as the server does). */
function run(life: Life, bp: Blueprint, from: number, ms: number, each?: (t: number) => void) {
  let t = from;
  const end = from + ms;
  while (t < end) {
    // at least once a second, so a short visit (the toilet) is seen
    t = Math.min(end, t + 1000, Math.max(t + 250, life.nextEvent(t) ?? end));
    life.tick(bp, t);
    each?.(t);
  }
  return t;
}

const apply = (bp: Blueprint, op: Op) => {
  const r = applyOp(bp, Op.parse(op));
  if (!r.ok) throw new Error(r.reason);
  return r.blueprint;
};

describe("free will", () => {
  it("sees to a pressing need first: the toilet, then washing up", () => {
    const { bp, life } = house();
    setNeeds(life, "ana", { bladder: 8, fun: 30 });
    life.tick(bp, T0);
    const a = life.state.avatars.ana!;
    expect(a.use?.action).toBe("toilet");
    expect(a.auto).toMatchObject({ need: "bladder" });
    const seen = new Set<string>();
    run(life, bp, T0, 40_000, (t) => seen.add(activityAt(a, t)));
    expect(seen).toContain("toilet");
    expect(seen).toContain("wash");
    expect(needsAt(a, T0 + 40_000).bladder).toBeGreaterThan(90);
  });

  it("goes to bed worn out, and gets up again once rested", () => {
    const { bp, life } = house(2);
    setNeeds(life, "ana", { energy: 5 });
    life.tick(bp, T0);
    const a = life.state.avatars.ana!;
    expect(a.use?.action).toBe("sleep");
    let woke = 0;
    run(life, bp, T0, 6 * 60_000, (t) => {
      if (!woke && a.use?.action !== "sleep") woke = t;
    });
    expect(woke).toBeGreaterThan(T0);
    expect(needsAt(a, woke).energy).toBeGreaterThanOrEqual(95);
  });

  it("cooks when there's nothing to eat, then sits down to the plate", () => {
    const { bp, life } = house(3);
    setNeeds(life, "ana", { hunger: 10 });
    life.tick(bp, T0);
    expect(life.state.cooking).not.toBeNull();
    const a = life.state.avatars.ana!;
    let ate = false;
    run(life, bp, T0, 4 * 60_000, (t) => {
      if (activityAt(a, t) === "eat") ate = true;
    });
    expect(ate).toBe(true);
    expect(needsAt(a, T0 + 4 * 60_000).hunger).toBeGreaterThan(URGENT);
  });

  it("waits a minute after the player's last order before doing anything by itself", () => {
    const { bp, life } = house(4);
    setNeeds(life, "ana", { bladder: 8 });
    life.command("ana", bp, T0, () => life.stop("ana", T0));
    life.tick(bp, T0 + AUTO_AFTER_MS / 2);
    expect(life.state.avatars.ana!.use).toBeNull();
    // the server's told when to look again
    expect(life.nextEvent(T0 + 1000)).toBe(T0 + AUTO_AFTER_MS);
    life.tick(bp, T0 + AUTO_AFTER_MS);
    expect(life.state.avatars.ana!.use?.action).toBe("toilet");
  });

  it("hands control straight back on an order, and gives up the seat a player wants", () => {
    const { bp, life } = house(5, ["ana", "ben"]);
    // a chair with one seat, so there's no other to take
    const chair = Object.values(bp.levels[0]!.objects).find((o) => slotsOf(o, "sit").length === 1)!;
    // Ben's off on his own: he takes the chair
    expect(life.use("ben", bp, chair.id, "sit", T0)).toBeNull();
    const ben = life.state.avatars.ben!;
    ben.auto = { need: "energy", since: T0 };
    // Ana, acting on her own too, can't have it
    life.state.avatars.ana!.auto = { need: "energy", since: T0 };
    expect(life.use("ana", bp, chair.id, "sit", T0 + 50)).toBe("taken");
    // but asked for by her player, it's hers: Ben gets up, and she's no longer acting on her own
    expect(life.command("ana", bp, T0 + 100, () => life.use("ana", bp, chair.id, "sit", T0 + 100))).toBeNull();
    const ana = life.state.avatars.ana!;
    expect(ana.use).toMatchObject({ objectId: chair.id, action: "sit" });
    expect(ana.auto).toBeUndefined();
    expect(ben.use).toBeNull();
    expect(ben.auto).toBeUndefined();
    // and Ben's player can't have it off her: it's her player's choice, not free will
    expect(life.command("ben", bp, T0 + 200, () => life.use("ben", bp, chair.id, "sit", T0 + 200))).toBe("taken");
  });

  it("lets what the player chose carry on once they go quiet, until it's done its job or something's pressing", () => {
    const { bp, life } = house(6);
    const tv = Object.values(bp.levels[0]!.objects).find((o) => o.catalogId === "tv_stand")!;
    setNeeds(life, "ana", { fun: 40 });
    life.command("ana", bp, T0, () => life.use("ana", bp, tv.id, "watch", T0));
    const a = life.state.avatars.ana!;
    // while the player's about, it's theirs
    run(life, bp, T0, AUTO_AFTER_MS - 1000);
    expect(a.use?.action).toBe("watch");
    expect(a.auto).toBeUndefined();
    // gone quiet: free will takes it on, and they watch until they've had their fill
    let doneAt = 0;
    let fun = 0;
    run(life, bp, T0 + AUTO_AFTER_MS - 1000, 5 * 60_000, (t) => {
      if (doneAt || a.use?.action === "watch") return;
      doneAt = t;
      fun = needsAt(a, t).fun;
    });
    expect(doneAt).toBeGreaterThan(T0 + AUTO_AFTER_MS);
    // up once they've had their fill (or after the longest anyone sits in front of the TV)
    expect(fun >= 90 || doneAt >= T0 + AUTO_AFTER_MS + 4 * 60_000).toBe(true);

    // something pressing gets them up from a player's choice straight away, once they've gone quiet
    const { bp: bp2, life: life2 } = house(12);
    const sofa = Object.values(bp2.levels[0]!.objects).find((o) => o.catalogId.startsWith("sofa"))!;
    life2.command("ana", bp2, T0, () => life2.use("ana", bp2, sofa.id, "sit", T0));
    setNeeds(life2, "ana", { bladder: 5 }, T0 + AUTO_AFTER_MS);
    run(life2, bp2, T0 + AUTO_AFTER_MS, 15_000);
    expect(["toilet", "wash"]).toContain(life2.state.avatars.ana!.use?.action);
  });

  it("takes a breather and tries again later when everything it needs is out of reach", () => {
    // a little walled-in yard with nothing in it
    let bp = emptyBlueprint(8, 8);
    bp = apply(bp, { t: "walls.add", level: 0, edges: [...edgesBetween(0, 4, 8, 4)], style: "plaster_cream" });
    const life = new Life(emptyLife(), catalog, ids, seeded(7)).enableFreeWill();
    life.ensureAvatar("ana", bp, T0);
    setNeeds(life, "ana", { bladder: 5 });
    life.tick(bp, T0);
    const a = life.state.avatars.ana!;
    expect(a.use).toBeNull();
    expect(a.auto).toMatchObject({ need: null });
    // and isn't asked again in a tight loop
    expect(life.nextEvent(T0)).toBeGreaterThanOrEqual(T0 + 6000);
  });

  it("keeps an away player's character living alongside their partner, and pauses with an empty house", () => {
    const { bp, life } = house(8, ["ana", "ben"]);
    life.online = new Set(["ana"]);
    setNeeds(life, "ben", { hunger: 60, energy: 60 });
    run(life, bp, T0, 10 * 60_000);
    const ben = life.state.avatars.ben!;
    // he's been up to things all the while (needs running, and seen to)
    expect(ben.needs!.live).toBe(true);
    expect(Math.min(...NEEDS.map((k) => needsAt(ben, T0 + 10 * 60_000)[k]))).toBeGreaterThan(5);
    // nobody left: nothing runs, nothing's due
    life.online = new Set();
    life.tick(bp, T0 + 10 * 60_000);
    expect(life.state.avatars.ben!.needs!.live).toBe(false);
    expect(life.nextEvent(T0 + 10 * 60_000)).toBeNull();
  });

  it("over an afternoon, does all sorts, takes the odd pause, and never lets a need run out", () => {
    const { bp, life } = house(9, ["ana", "ben"]);
    const did = new Set<string>();
    let pauses = 0;
    let lowest = 100;
    const start = T0;
    run(life, bp, start, 3 * 60 * 60_000, (t) => {
      for (const a of Object.values(life.state.avatars)) {
        const act = activityAt(a, t);
        if (act !== "walk" && act !== "idle") did.add(act);
        if (a.auto?.need === null && a.auto.since === t) pauses++;
        const v = needsAt(a, t);
        lowest = Math.min(lowest, ...NEEDS.map((k) => v[k]));
      }
    });
    expect(did.size).toBeGreaterThanOrEqual(6);
    for (const need of ["toilet", "sleep", "eat"]) expect(did).toContain(need);
    expect(pauses).toBeGreaterThan(0);
    expect(lowest).toBeGreaterThan(0);
  });

  it("is saved and picked up again, carrying on by itself", () => {
    const { bp, life } = house(10);
    setNeeds(life, "ana", { energy: 5 });
    life.tick(bp, T0);
    const saved = life.saved(T0 + 5000);
    expect(saved.avatars.ana!.auto).toMatchObject({ need: "energy" });
    const again = Life.restore(saved, T0 + 60_000, catalog).enableFreeWill();
    const a = again.state.avatars.ana!;
    expect(a.use?.action).toBe("sleep");
    expect(a.auto).toMatchObject({ need: "energy", since: T0 + 60_000 });
    run(again, bp, T0 + 60_000, 6 * 60_000);
    expect(arrivalTime(a)).toBeGreaterThan(T0 + 60_000);
  });

  it("does nothing on its own when it isn't switched on", () => {
    const bp = starter();
    const life = new Life(emptyLife(), catalog, ids, seeded(11));
    life.ensureAvatar("ana", bp, T0);
    setNeeds(life, "ana", { bladder: 5 });
    life.tick(bp, T0);
    expect(life.state.avatars.ana!.use).toBeNull();
    expect(life.nextEvent(T0)).toBeNull();
  });
});
