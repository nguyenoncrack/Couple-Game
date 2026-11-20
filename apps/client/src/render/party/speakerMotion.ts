import { channelOf, deckBeat, deckRunning, mixAt, musicPosition, type Deck, type DeckTrackId, type Music } from "@cg/shared";
import { grooveOf, type GrooveAnalysis } from "./lightShow";

const REST = { cone: 0, rock: 0 };

function beatMotion(beat: number, strength: number) {
  const phase = beat - Math.floor(beat);
  return {
    cone: strength * Math.exp(-phase * 7),
    rock: strength * Math.cos(phase * 4 * Math.PI) * Math.exp(-phase * 4.5),
  };
}

/** The kick and cabinet recoil follow the loudest running deck, even with party lights off. */
export function speakerMotionAt(deck: Deck | undefined, music: Music | undefined, now: number, analysisOf: (id: DeckTrackId) => GrooveAnalysis | null) {
  if (deck?.playing) {
    const beat = deckBeat(deck, now);
    const balance = mixAt(deck, beat).xfade * Math.PI / 2;
    const a = deckRunning(deck, "a", beat) ? channelOf(deck, "a").vol * Math.cos(balance) : 0;
    const b = deckRunning(deck, "b", beat) ? channelOf(deck, "b").vol * Math.sin(balance) : 0;
    const gain = Math.max(a, b);
    if (gain <= 0.01) return REST;

    const groove = grooveOf(deck, beat, analysisOf, a >= b ? "a" : "b");
    if (!groove || groove.section === "break") return REST;
    const accent = groove.barBeat < 1 ? 1 : 0.76;
    return beatMotion(groove.beat, gain * accent * groove.energy);
  }
  if (music?.playing && music.current) return beatMotion(musicPosition(music, now) / 500, 0.55);
  return REST;
}

/** Smoothed once per scene frame, shared by every speaker cabinet and cone. */
export const speakerMotion = { ...REST };

export function stepSpeakerMotion(deck: Deck | undefined, music: Music | undefined, now: number, dt: number, reduced: boolean, analysisOf: (id: DeckTrackId) => GrooveAnalysis | null) {
  if (reduced) {
    Object.assign(speakerMotion, REST);
    return;
  }
  const target = speakerMotionAt(deck, music, now, analysisOf);
  const follow = 1 - Math.exp(-dt * 32);
  speakerMotion.cone += (target.cone - speakerMotion.cone) * follow;
  speakerMotion.rock += (target.rock - speakerMotion.rock) * follow;
}
