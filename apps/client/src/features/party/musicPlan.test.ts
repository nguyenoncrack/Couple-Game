import type { Track } from "@cg/shared";
import { describe, expect, it } from "vitest";
import { DRIFT_SEC, plan, userSeeked } from "./musicPlan";
import { YT_STATE as S } from "./youtubeApi";

const track = (videoId: string): Track => ({ id: "t0000000001", videoId, by: "ana" });
const A = "aaaaaaaaaaa";
const B = "bbbbbbbbbbb";

describe("keeping this screen's player in step with the house's music", () => {
  it("does nothing when there's nothing playing and nothing loaded", () => {
    expect(plan(null, false, 0, { videoId: null, state: S.unstarted, time: 0 })).toEqual({});
  });

  it("clears the player when the queue has run out", () => {
    expect(plan(null, false, 0, { videoId: A, state: S.playing, time: 40 })).toEqual({ clear: true });
  });

  it("loads the current video at the shared position, playing or cued", () => {
    expect(plan(track(A), true, 12.5, { videoId: null, state: S.unstarted, time: 0 })).toEqual({ load: { videoId: A, at: 12.5, play: true } });
    expect(plan(track(A), false, 30, { videoId: B, state: S.playing, time: 5 })).toEqual({ load: { videoId: A, at: 30, play: false } });
  });

  it("leaves a player alone while it's playing about the right place", () => {
    expect(plan(track(A), true, 50, { videoId: A, state: S.playing, time: 50.4 })).toEqual({});
    expect(plan(track(A), true, 50, { videoId: A, state: S.buffering, time: 50 + DRIFT_SEC - 0.1 })).toEqual({});
  });

  it("brings a drifted player back, and starts one that's stopped", () => {
    expect(plan(track(A), true, 50, { videoId: A, state: S.playing, time: 40 })).toEqual({ seek: 50 });
    expect(plan(track(A), true, 50, { videoId: A, state: S.paused, time: 50 })).toEqual({ play: true });
    expect(plan(track(A), true, 50, { videoId: A, state: S.cued, time: 0 })).toEqual({ play: true, seek: 50 });
  });

  it("waits out the end of a video for the house to move on", () => {
    expect(plan(track(A), true, 240, { videoId: A, state: S.ended, time: 238 })).toEqual({});
  });

  it("pauses a player the house has paused, and parks it at the shared place", () => {
    expect(plan(track(A), false, 20, { videoId: A, state: S.playing, time: 20 })).toEqual({ pause: true });
    expect(plan(track(A), false, 20, { videoId: A, state: S.playing, time: 31 })).toEqual({ pause: true, seek: 20 });
    expect(plan(track(A), false, 20, { videoId: A, state: S.paused, time: 20.5 })).toEqual({});
    expect(plan(track(A), false, 20, { videoId: A, state: S.paused, time: 3 })).toEqual({ seek: 20 });
  });

  it("tells a drag of the progress bar from ordinary playback", () => {
    expect(userSeeked(10, 10.5, 0.5)).toBe(false);
    expect(userSeeked(10, 11.2, 0.5)).toBe(false);
    expect(userSeeked(10, 60, 0.5)).toBe(true);
    expect(userSeeked(60, 10, 0.5)).toBe(true);
  });
});
