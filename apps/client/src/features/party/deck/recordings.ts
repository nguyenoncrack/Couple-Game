import { DEFAULT_BPM, type DeckTrackId, type RecordedTrackId } from "@cg/shared";

export const STREAMED_RECORDINGS: ReadonlySet<DeckTrackId> = new Set<RecordedTrackId>(["hard-summer-2017-live"]);

export const RECORDING_URLS: Readonly<Partial<Record<DeckTrackId, string>>> = {
  "atlasaudio-edm": `${import.meta.env.BASE_URL}audio/dj/atlasaudio-edm-606245.mp3`,
  "kulakovka-hard-edm": `${import.meta.env.BASE_URL}audio/dj/kulakovka-hard-edm-281129.mp3`,
  "sad-machine-ksk-edit": `${import.meta.env.BASE_URL}audio/dj/porter-robinson-sad-machine-ksk-edit.mp3`,
  "fuck-the-speakerz-up": `${import.meta.env.BASE_URL}audio/dj/isoxo-fuck-the-speakerz-up.mp3`,
  "hard-summer-2017-live": `${import.meta.env.BASE_URL}audio/dj/4b-hard-summer-2017-live.mp3`,
  "back-to-u": `${import.meta.env.BASE_URL}audio/dj/slander-william-black-back-to-u.mp3`,
  "take-me": `${import.meta.env.BASE_URL}audio/dj/william-black-matte-runn-take-me.mp3`,
  "dont-leave-kiss-fm-edit": `${import.meta.env.BASE_URL}audio/dj/seven-lions-ellie-goulding-dont-leave-kiss-fm-edit.mp3`,
  "where-you-are": `${import.meta.env.BASE_URL}audio/dj/john-summit-where-you-are.mp3`,
  "clarity-album-mix": `${import.meta.env.BASE_URL}audio/dj/zedd-foxes-clarity-original-album-mix.mp3`,
  "take-me-to-the-moon": `${import.meta.env.BASE_URL}audio/dj/ian-asher-danny-take-me-to-the-moon.mp3`,
  "black-out-days-stay-away": `${import.meta.env.BASE_URL}audio/dj/ian-asher-phantogram-black-out-days-stay-away.mp3`,
} satisfies Record<RecordedTrackId, string>;

/** At the default tempo, recordings play at their original speed. */
export function recordingOffset(beat: number, cue: number, duration: number): number {
  return (Math.max(0, beat - cue) * 60 / DEFAULT_BPM) % duration;
}
