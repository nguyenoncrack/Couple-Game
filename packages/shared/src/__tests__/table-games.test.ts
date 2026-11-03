import { describe, expect, it } from "vitest";
import { emptyBlueprint, type Blueprint } from "../blueprint";
import { Op } from "../ops";
import { applyOp } from "../rules";
import { Life } from "../life/engine";
import { arrivalTime, emptyLife } from "../life/state";
import { blackjackScore, dealBlackjack, finishBlackjack, playBlackjack, type BlackjackRound } from "../life/blackjack";
import { pingPongMoment } from "../life/pingpong";
import { LifeIntent } from "../protocol";

function apply(bp: Blueprint, op: Op) {
  const r = applyOp(bp, op); if (!r.ok) throw Error(r.reason); return r.blueprint;
}
function room(catalogId = "blackjack_table", rot: 0 | 1 | 2 | 3 = 0) {
  return apply(emptyBlueprint(14, 14), { t: "object.place", level: 0, id: "table00001", catalogId, x: 5, z: 5, rot });
}
function two(bp: Blueprint) {
  let round = 0;
  const life = new Life(emptyLife(), undefined, () => `round${String(++round).padStart(5, "0")}`, () => 0);
  life.ensureAvatar("amy", bp, 0); life.ensureAvatar("ben", bp, 0);
  return life;
}
function join(life: Life, bp: Blueprint, action: "blackjack" | "pingpong" = "blackjack") {
  expect(life.use("amy", bp, "table00001", action, 0)).toBeNull();
  expect(life.use("ben", bp, "table00001", action, 0)).toBeNull();
}

describe("blackjack rules", () => {
  it.each([
    [[0, 12], 21], [[0, 13], 12], [[0, 13, 26, 39], 14], [[0, 13, 8], 21], [[9, 10, 11], 30],
  ])("scores flexible aces and face cards: %j", (cards, score) => {
    expect(blackjackScore(cards as number[])).toBe(score);
  });
  it("draws unique server cards and resolves a shared round only after every hand finishes", () => {
    const round = dealBlackjack("round00001", ["amy", "ben"], () => 0);
    expect(round.phase).toBe("playing");
    expect(round.dealer).toHaveLength(1);
    expect(playBlackjack(round, "amy", "hit", () => 0)).toBe(true);
    expect(blackjackScore(round.hands.amy!.cards)).toBe(20);
    expect(playBlackjack(round, "amy", "stand", () => 0)).toBe(true);
    expect(round.phase).toBe("playing");
    expect(playBlackjack(round, "ben", "stand", () => 0)).toBe(true);
    expect(round.phase).toBe("finished");
    const drawn = [...round.dealer, ...Object.values(round.hands).flatMap((h) => h.cards)];
    expect(new Set(drawn).size).toBe(drawn.length);
    expect(playBlackjack(round, "amy", "hit")).toBe(false);
    expect("deck" in round).toBe(false);
  });
  it("stands on soft 17 and handles wins, pushes, busts and natural blackjack", () => {
    const make = (dealer: number[], cards: number[]): BlackjackRound => ({ id: "round00001", phase: "playing", dealer, hands: { amy: { cards, status: "stood" } } });
    const soft = make([0, 5], [9, 10]);
    finishBlackjack(soft, () => { throw Error("soft 17 should stand"); });
    expect(soft.dealer).toHaveLength(2); expect(soft.hands.amy!.result).toBe("win");
    const push = make([9, 10], [22, 23]); finishBlackjack(push); expect(push.hands.amy!.result).toBe("push");
    const bust = make([9, 10], [22, 23, 24]); finishBlackjack(bust); expect(bust.hands.amy!.result).toBe("lose");
    const dealerNatural = make([0, 12], [9, 8, 1]); finishBlackjack(dealerNatural); expect(dealerNatural.hands.amy!.result).toBe("lose");
    const bothNatural = make([0, 12], [13, 25]); finishBlackjack(bothNatural); expect(bothNatural.hands.amy!.result).toBe("push");
  });
});

describe("table interactions", () => {
  it.each([0, 1, 2, 3] as const)("reserves two safe spots at rotated tables (%s)", (rot) => {
    for (const [id, action] of [["blackjack_table", "blackjack"], ["ping_pong_table", "pingpong"]] as const) {
      const bp = room(id, rot); const life = two(bp); join(life, bp, action);
      expect(life.state.avatars.amy!.use!.slot).not.toBe(life.state.avatars.ben!.use!.slot);
      const moved = apply(bp, { t: "object.move", level: 0, id: "table00001", x: 8, z: 8, rot });
      expect(life.onBlueprint(moved, 60_000)).toBe(true);
      expect(life.state.avatars.amy!.use).toBeNull(); expect(life.state.avatars.ben!.use).toBeNull();
    }
  });
  it("validates table membership, arrival and round IDs without mutating rejected requests", () => {
    const bp = room(); const life = two(bp);
    expect(life.cards("amy", bp, "table00001", null, "deal", 0)).toBe("not-at-table");
    join(life, bp);
    expect(life.cards("amy", bp, "table00001", null, "deal", 0)).toBe("not-at-table");
    expect(life.cards("amy", bp, "table00001", null, "deal", 60_000)).toBeNull();
    const before = structuredClone(life.state);
    expect(life.cards("ben", bp, "table00001", null, "deal", 60_001)).toBe("round-changed");
    expect(life.cards("amy", bp, "table00001", "round00001", "deal", 60_001)).toBe("round-active");
    expect(life.state).toEqual(before);
    expect(LifeIntent.safeParse({ do: "cards", objectId: "table00001", roundId: "round00001", action: "give-me-21" }).success).toBe(false);
  });
  it("continues after a partner leaves or drops out, and pauses safely when the whole house goes offline", () => {
    const bp = room(); const life = two(bp); join(life, bp);
    life.cards("amy", bp, "table00001", null, "deal", 60_000);
    life.online = new Set();
    expect(life.tick(bp, 60_001)).toBe(false);
    life.online = new Set(["amy"]);
    expect(life.tick(bp, 60_002)).toBe(true);
    expect(life.state.blackjack!.table00001!.hands.ben!.status).toBe("stood");
    life.stop("amy", 60_003); expect(life.syncTableGames(bp)).toBe(true);
    expect(life.state.blackjack!.table00001!.phase).toBe("finished");
    expect(life.state.blackjack!.table00001!.hands.amy!.status).toBe("left");
  });
  it("saves an unfinished hand, restores it independently, and cleans up removed tables", () => {
    let bp = room(); const life = two(bp); join(life, bp);
    life.cards("amy", bp, "table00001", null, "deal", 60_000);
    const restored = Life.restore(JSON.parse(JSON.stringify(life.saved(60_001))), 70_000);
    expect(restored.state.blackjack).toEqual(life.state.blackjack);
    restored.cards("amy", bp, "table00001", "round00001", "hit", 70_001);
    expect(restored.state.blackjack).not.toEqual(life.state.blackjack);
    expect(two(bp).state.blackjack).toBeUndefined();
    bp = apply(bp, { t: "object.remove", level: 0, id: "table00001" });
    expect(restored.onBlueprint(bp, 70_002)).toBe(true);
    expect(restored.state.blackjack!.table00001).toBeUndefined();
    expect(restored.cards("amy", bp, "table00001", "round00001", "hit", 70_003)).toBe("not-at-table");
  });
  it("doesn't reuse occupied spots or stand inside furniture beside a card table", () => {
    let bp = room();
    bp = apply(bp, { t: "object.place", level: 0, id: "plant00001", catalogId: "plant_fiddle", x: 5, z: 6, rot: 0 });
    const life = two(bp);
    expect(life.use("amy", bp, "table00001", "blackjack", 0)).toBeNull();
    expect(life.state.avatars.amy!.use!.slot).toBe(1);
    expect(life.use("ben", bp, "table00001", "blackjack", 0)).toBe("taken");
  });
  it("derives the same ping-pong rally on both screens, with solo practice and net clearance", () => {
    const bp = room("ping_pong_table"); const life = two(bp);
    life.use("amy", bp, "table00001", "pingpong", 0);
    const amy = life.state.avatars.amy!;
    expect(pingPongMoment(life.state, "table00001", 0)).toBeNull();
    const start = arrivalTime(amy);
    expect(pingPongMoment(life.state, "table00001", start + 1)!.players).toBe(1);
    life.use("ben", bp, "table00001", "pingpong", 0);
    const bothStart = Math.max(...Object.values(life.state.avatars).map(arrivalTime));
    const moment = pingPongMoment(life.state, "table00001", bothStart + 425)!;
    expect(moment.players).toBe(2); expect(moment.progress).toBeCloseTo(0.5); expect(moment.y).toBeGreaterThan(0.93);
    expect(pingPongMoment(JSON.parse(JSON.stringify(life.state)), "table00001", bothStart + 425)).toEqual(moment);
    expect(pingPongMoment(life.state, "table00001", bothStart + 425, new Set(["amy"]))!.players).toBe(1);
    expect(life.nextEvent(bothStart)).toBeNull();
  });
});
