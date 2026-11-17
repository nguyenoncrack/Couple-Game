import { DEFAULT_BPM, type DeckTrackId, type RecordedTrackId } from "@cg/shared";

export const RECORDING_URLS: Readonly<Partial<Record<DeckTrackId, string>>> = {
  "atlasaudio-edm": `${import.meta.env.BASE_URL}audio/dj/atlasaudio-edm-606245.mp3`,
  "kulakovka-hard-edm": `${import.meta.env.BASE_URL}audio/dj/kulakovka-hard-edm-281129.mp3`,
  "sad-machine-ksk-edit": `${import.meta.env.BASE_URL}audio/dj/porter-robinson-sad-machine-ksk-edit.mp3`,
  "fuck-the-speakerz-up": `${import.meta.env.BASE_URL}audio/dj/isoxo-fuck-the-speakerz-up.mp3`,
} satisfies Record<RecordedTrackId, string>;

/** At the default tempo, recordings play at their original speed. */
export function recordingOffset(beat: number, cue: number, duration: number): number {
  return (Math.max(0, beat - cue) * 60 / DEFAULT_BPM) % duration;
}
