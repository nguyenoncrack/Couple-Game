import { describe, expect, it } from "vitest";
import { emptyBlueprint } from "../blueprint";
import { applyOp, costOf } from "../rules";
import { DAILY_COINS, dayFromNumber, dayNumber, localDay, nextMilestone, plausibleDay, streakStats, visitReward } from "../visits";

/** The day `n` days after `day`. */
const plus = (day: string, n: number) => dayFromNumber(dayNumber(day)! + n);

/** Visit on each of these days in turn, as the directory does: what each brought. */
function visitAll(days: string[]) {
  const seen: string[] = [];
  return days.map((d) => {
    const r = visitReward(seen, d);
    if (r) seen.push(d);
    return r;
  });
}

describe("days", () => {
  it("are calendar days, across months, years and leap days", () => {
    expect(plus("2026-01-31", 1)).toBe("2026-02-01");
    expect(plus("2026-12-31", 1)).toBe("2027-01-01");
    expect(plus("2028-02-28", 1)).toBe("2028-02-29");
    expect(plus("2027-02-28", 1)).toBe("2027-03-01");
    expect(dayNumber("2026-02-30")).toBeNull();
    expect(dayNumber("2026-2-3")).toBeNull();
    expect(dayNumber("tomorrow")).toBeNull();
  });

  it("are the player's own date, a minute either side of their midnight", () => {
    expect(localDay(new Date(2026, 10, 4, 23, 59, 59))).toBe("2026-11-04");
    expect(localDay(new Date(2026, 10, 5, 0, 0, 0))).toBe("2026-11-05");
    expect(localDay(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31");
    expect(localDay(new Date(2027, 0, 1, 0, 1))).toBe("2027-01-01");
  });

  it("can only be today somewhere in the world", () => {
    const noonUtc = Date.UTC(2026, 10, 4, 12);
    expect(plausibleDay("2026-11-04", noonUtc)).toBe(true);
    // Hawaii is still on the 3rd at UTC midnight-ish; Kiribati already on the 5th
    expect(plausibleDay("2026-11-03", Date.UTC(2026, 10, 4, 1))).toBe(true);
    expect(plausibleDay("2026-11-05", Date.UTC(2026, 10, 4, 22))).toBe(true);
    expect(plausibleDay("2026-11-06", noonUtc)).toBe(false);
    expect(plausibleDay("2026-11-02", noonUtc)).toBe(false);
    expect(plausibleDay("2026-13-01", noonUtc)).toBe(false);
  });
});

describe("streaks", () => {
  it("count once a day: coming back the same day brings nothing", () => {
    const [first, again, later] = visitAll(["2026-11-04", "2026-11-04", "2026-11-04"]);
    expect(first).toEqual({ streak: 1, coins: DAILY_COINS, milestone: null });
    expect(again).toBeNull();
    expect(later).toBeNull();
  });

  it("go on day after day, over a month's end, with bonuses at 3, 7, 14 and 30", () => {
    const start = "2026-10-20";
    const days = Array.from({ length: 31 }, (_, i) => plus(start, i));
    const got = visitAll(days);
    expect(got.map((g) => g!.streak)).toEqual(days.map((_, i) => i + 1));
    const bonuses = got.filter((g) => g!.milestone).map((g) => [g!.milestone, g!.coins]);
    expect(bonuses).toEqual([
      [3, DAILY_COINS + 300],
      [7, DAILY_COINS + 750],
      [14, DAILY_COINS + 1500],
      [30, DAILY_COINS + 3000],
    ]);
    // the day after the last milestone is just the daily coins again
    expect(got[30]).toEqual({ streak: 31, coins: DAILY_COINS, milestone: null });
    expect(streakStats(days, days.at(-1)!)).toEqual({ current: 31, longest: 31, total: 31 });
  });

  it("start again at one after a missed day, keeping the longest and the total", () => {
    const days = ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-05"];
    const got = visitAll(days);
    expect(got.map((g) => g!.streak)).toEqual([1, 2, 3, 1]);
    expect(streakStats(days, "2026-11-05")).toEqual({ current: 1, longest: 3, total: 4 });
    // a new run earns its milestones again
    expect(visitAll([...days, "2026-11-06", "2026-11-07"]).at(-1)).toMatchObject({ streak: 3, milestone: 3 });
  });

  it("stay alive until the end of the next day, then show as nothing until you're back", () => {
    const days = ["2026-11-01", "2026-11-02"];
    expect(streakStats(days, "2026-11-02").current).toBe(2);
    expect(streakStats(days, "2026-11-03").current).toBe(2);
    expect(streakStats(days, "2026-11-04").current).toBe(0);
    expect(streakStats([], "2026-11-04")).toEqual({ current: 0, longest: 0, total: 0 });
  });

  it("can't go back to fill in a day that was missed", () => {
    expect(visitReward(["2026-11-01", "2026-11-03"], "2026-11-02")).toBeNull();
    expect(visitReward(["2026-11-03"], "2026-11-03")).toBeNull();
    expect(visitReward(["2026-11-03"], "nope")).toBeNull();
  });

  it("say what's next to look forward to", () => {
    expect(nextMilestone(0)).toEqual({ days: 3, coins: 300, left: 3 });
    expect(nextMilestone(3)).toEqual({ days: 7, coins: 750, left: 4 });
    expect(nextMilestone(29)).toEqual({ days: 30, coins: 3000, left: 1 });
    expect(nextMilestone(30)).toBeNull();
  });
});

describe("coins", () => {
  const sofa = { t: "object.place", level: 0, id: "sofa000001", catalogId: "sofa_cozy", x: 2, z: 2, rot: 0 } as const;

  it("pay for furniture and come back when it goes", () => {
    const bp = emptyBlueprint();
    const price = costOf(bp, sofa)!;
    expect(price).toBeGreaterThan(0);
    const r = applyOp(bp, sofa);
    if (!r.ok) throw new Error(r.reason);
    expect(r.blueprint.funds).toBe(bp.funds - price);
    const back = applyOp(r.blueprint, { t: "object.remove", level: 0, id: "sofa000001" });
    expect(back.ok && back.blueprint.funds).toBe(bp.funds);
  });

  it("can't be overspent, but a visit's coins always land and old edits always replay", () => {
    const broke = { ...emptyBlueprint(), funds: 10 };
    expect(applyOp(broke, sofa)).toEqual({ ok: false, reason: "cant-afford" });
    const paid = applyOp(broke, { t: "funds.add", amount: 5000, note: "visit 2026-11-04" });
    expect(paid.ok && paid.blueprint.funds).toBe(5010);
    // from the log: already accepted once, so it goes through even short of coins
    const replayed = applyOp(broke, sofa, undefined, { accepted: true });
    expect(replayed.ok && replayed.blueprint.funds).toBeLessThan(0);
  });
});
