import { DEFAULT_DECK, trackBeats, type Deck, type DeckTrackId, type SetStep } from "@cg/shared";
import { describe, expect, it } from "vitest";
import { addSongs, canMove, liveList, moveSong, pairKey, removeSong, sameSteps, type EditContext } from "./setPlan";

const ctx = (onAir: number | null, onAirPos: number | null = null): EditContext => ({ bpm: 124, analysis: () => null, onAir, onAirPos });
const step = (track: DeckTrackId, from = 0): SetStep => ({ track, from, cues: [] });
const five: DeckTrackId[] = ["take-me", "back-to-u", "atlasaudio-edm", "where-you-are", "clarity-album-mix"];

describe("the workspace's set list", () => {
  it("follows the house's set, or the record on air on its own", () => {
    const steps = addSongs([], five, ctx(null)).steps;
    const deck: Deck = { ...DEFAULT_DECK, a: "back-to-u", b: "atlasaudio-edm", set: { name: null, steps, step: 1 } };
    expect(liveList(deck, 0)).toMatchObject({ onAir: 1, was: 1, shared: true });
    // a set that has lost track of the record on air: the record on its own
    expect(liveList({ ...deck, a: "night-bus" }, 0)).toMatchObject({ steps: [{ track: "night-bus" }], onAir: 0, shared: false });
    // a transition that has finished but the set hasn't moved on: the next record is on air
    const done: Deck = { ...deck, mix: { style: "blend", from: 0, to: 1, start: 0, beats: 16 } };
    expect(liveList(done, 20)).toMatchObject({ onAir: 2, was: 2 });
    expect(liveList(done, 8)).toMatchObject({ onAir: 1 });
    expect(liveList({ ...DEFAULT_DECK, a: null, b: null }, 0)).toMatchObject({ steps: [], onAir: null });
  });

  it("adds several songs at once, each linked to the one before", () => {
    const one = [step("take-me")];
    const e = addSongs(one, five.slice(1), ctx(0, 40));
    expect(e.steps.map((s) => s.track)).toEqual(five);
    expect(e.relinked).toEqual([0, 1, 2, 3]);
    // the link from the record on air comes after where it is now
    expect(e.steps[0]!.next!.at).toBeGreaterThan(40);
    expect(e.steps.slice(0, 4).every((s) => s.next && s.next.at < trackBeats(s.track))).toBe(true);
    expect(e.steps[4]!.next).toBeUndefined();
  });

  it("reorders around the record on air, re-linking only the pairs that changed", () => {
    const { steps } = addSongs([step("take-me")], five.slice(1), ctx(0));
    expect(canMove(steps, 1, -1, 0)).toBe(false);
    expect(canMove(steps, 0, 1, 0)).toBe(false);
    const e = moveSong(steps, 3, 1, ctx(0));
    expect(e.steps.map((s) => s.track)).toEqual(["take-me", "back-to-u", "atlasaudio-edm", "clarity-album-mix", "where-you-are"]);
    expect(e.relinked).toEqual([2, 3]);
    expect([2, 3].map((i) => pairKey(e.steps, i))).toEqual(["atlasaudio-edm>clarity-album-mix", "clarity-album-mix>where-you-are"]);
    // the record that's now last hands over to nothing
    expect(e.steps[4]!.next).toBeUndefined();
    expect(e.steps[0]).toEqual(steps[0]);
  });

  it("removes a record and links the ones either side, keeping the record on air", () => {
    const { steps } = addSongs([step("take-me")], five.slice(1), ctx(0));
    const e = removeSong(steps, 2, ctx(3));
    expect(e.onAir).toBe(2);
    expect(e.steps.map((s) => s.track)).toEqual(["take-me", "back-to-u", "where-you-are", "clarity-album-mix"]);
    // the link into the record on air is history, and is left alone
    expect(e.relinked).toEqual([]);
    const last = removeSong(steps, 4, ctx(0));
    expect(last.steps).toHaveLength(4);
    expect(last.steps[3]!.next).toBeUndefined();
    const middle = removeSong(steps, 2, ctx(0));
    expect(middle.relinked).toEqual([1]);
    expect(removeSong(steps, 0, ctx(0)).steps).toHaveLength(5);
  });

  it("matches a set the house rounded to its grid", () => {
    const { steps } = addSongs([step("neon-drift")], ["take-me"], ctx(0));
    const rounded = steps.map((s) => ({ ...s, from: s.from + 0.2, next: s.next && { ...s.next, at: Math.round(s.next.at * 4) / 4 } }));
    expect(sameSteps(rounded, steps)).toBe(true);
    expect(sameSteps(rounded.slice(0, 1), steps)).toBe(false);
  });
});
