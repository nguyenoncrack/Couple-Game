import type { Track } from "@cg/shared";
import { YT_STATE } from "./youtubeApi";

/**
 * What to do to this screen's player so it matches the shared music. Pure, so the rules are easy to test: the
 * controller observes the player, asks for a plan, and carries it out.
 */

export interface Observed {
  /** The video the player has loaded (null before it's loaded one). */
  videoId: string | null;
  /** `YT_STATE`. */
  state: number;
  /** Where it is, seconds. */
  time: number;
}

export interface Plan {
  /** Load this video (starting at `at` seconds), playing it or leaving it cued, paused. */
  load?: { videoId: string; at: number; play: boolean };
  seek?: number;
  play?: boolean;
  pause?: boolean;
  /** Nothing should be loaded: clear the player. */
  clear?: boolean;
}

/** A gap bigger than this between the player and the shared position gets a seek. */
export const DRIFT_SEC = 2.5;
/** Paused at the wrong place is a smaller thing to fix. */
export const PAUSED_DRIFT_SEC = 1.2;

export function plan(track: Track | null, playing: boolean, expected: number, obs: Observed): Plan {
  if (!track) return obs.videoId ? { clear: true } : {};
  if (track.videoId !== obs.videoId) return { load: { videoId: track.videoId, at: expected, play: playing } };
  const drift = Math.abs(obs.time - expected);
  const live = obs.state === YT_STATE.playing || obs.state === YT_STATE.buffering;
  if (playing) {
    // an ended video waits for the house to move on to the next
    if (obs.state === YT_STATE.ended) return {};
    if (!live) return { play: true, ...(drift > DRIFT_SEC ? { seek: expected } : {}) };
    return drift > DRIFT_SEC ? { seek: expected } : {};
  }
  if (live) return { pause: true, ...(drift > PAUSED_DRIFT_SEC ? { seek: expected } : {}) };
  return drift > PAUSED_DRIFT_SEC && obs.state !== YT_STATE.ended ? { seek: expected } : {};
}

/**
 * Did someone drag the player's own progress bar? Compare where it is with where it should have got to since the
 * last look: a jump of more than a couple of seconds either way isn't playback.
 */
export function userSeeked(prevTime: number, time: number, elapsedSec: number, jump = 2): boolean {
  return Math.abs(time - (prevTime + elapsedSec)) > jump;
}
