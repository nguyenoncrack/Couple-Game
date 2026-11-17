import { DEFAULT_BPM } from "@cg/shared";
import { recordingOffset } from "./recordings";

/** Long sets stream into the mixer without decoding the entire file into memory. */
export class StreamedRecording {
  private readonly audio = new Audio();
  private readonly source: MediaElementAudioSourceNode;
  private requested = false;
  private pendingSeek = true;
  private stopped = false;
  private failed = false;
  blocked = false;

  constructor(context: AudioContext, input: AudioNode, url: string) {
    this.audio.preload = "metadata";
    this.audio.loop = true;
    this.audio.preservesPitch = false;
    this.source = context.createMediaElementSource(this.audio);
    this.source.connect(input);
    this.audio.src = url;
  }

  get status(): "loading" | "error" | undefined {
    if (this.failed || this.audio.error) return "error";
    if (!this.blocked && (this.audio.paused || this.audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA)) return "loading";
  }

  requestSeek() {
    this.pendingSeek = true;
  }

  sync(beat: number, cue: number, bpm: number) {
    const { audio } = this;
    if (this.failed || audio.error || !Number.isFinite(audio.duration) || audio.duration <= 0) return;

    const rate = bpm / DEFAULT_BPM;
    if (audio.playbackRate !== rate) audio.playbackRate = rate;
    const offset = recordingOffset(beat, cue, audio.duration);
    if (this.pendingSeek) {
      audio.currentTime = offset;
      this.pendingSeek = false;
    }
    if (!this.requested) {
      this.play();
    } else if (!audio.paused && !audio.seeking && audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      const drift = Math.abs(audio.currentTime - offset);
      if (Math.min(drift, audio.duration - drift) > 2) audio.currentTime = offset;
    }
  }

  /** May also be called directly from a click if the browser blocked autoplay. */
  play() {
    this.requested = true;
    this.blocked = false;
    void this.audio.play().catch((error: unknown) => {
      if (this.stopped) return;
      if (error instanceof DOMException && error.name === "NotAllowedError") this.blocked = true;
      else this.failed = true;
    });
  }

  stop() {
    this.stopped = true;
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
    this.source.disconnect();
  }
}
