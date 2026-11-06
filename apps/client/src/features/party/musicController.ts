import { musicPosition, type PartyCmd } from "@cg/shared";
import { serverNow, toast } from "../../state/game";
import { plan, userSeeked } from "./musicPlan";
import { usePartyUi, type MusicStatus } from "./partyUi";
import { loadYouTubeApi, YT_ERROR_TEXT, YT_STATE, type YTPlayer } from "./youtubeApi";
import type { Music } from "@cg/shared";

/**
 * This screen's end of the shared music: one YouTube player, kept in step with the house's queue. It follows the
 * server's state (which video, playing or paused, how far in) and reports back what the people in front of it do
 * with the player's own controls (pause, play, drag the progress bar), what finishes, and what YouTube won't play.
 * It only runs while this player has chosen to listen, and the player stays on screen the whole time.
 */

/** After telling the player to do something, ignore what it reports for this long (it's our own doing). */
const OWN_MS = 1500;
const TICK_MS = 500;
const ERROR_SHOWN_MS = 8000;
/** Told to play but not moving for this long: the browser is probably waiting for a click (longer if it says it's buffering). */
const STALL_MS = 4000;
const STALL_BUFFERING_MS = 6000;

export class MusicController {
  private player: YTPlayer | null = null;
  private host: HTMLElement | null = null;
  private ready = false;
  private loaded: string | null = null;
  private music: Music | undefined;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ownUntil = 0;
  private lastCmd = 0;
  private lastTime = 0;
  private lastAt = 0;
  /** The last moment the playhead was seen moving along, and when the current video was loaded. */
  private lastProgress = 0;
  private loadedAt = 0;
  /** The browser won't make sound until it's had a click: the player is held muted (so it still plays) until then. */
  private blocked = false;
  /** How near the speakers this player's character is (0..1); it scales the chosen volume. */
  private mix = 1;
  private dead = false;
  private state: number = YT_STATE.unstarted;
  private attaching = 0;

  constructor(private send: (cmd: PartyCmd) => void) {}

  /** An error stays on screen for a few seconds, whatever the status does after it. */
  private keepUntil = 0;

  private status(status: MusicStatus, message: string | null = null) {
    const s = usePartyUi.getState();
    if (message !== null) this.keepUntil = performance.now() + ERROR_SHOWN_MS;
    else if (performance.now() < this.keepUntil && status !== "playing") message = s.message;
    if (s.status !== status || s.message !== message) usePartyUi.setState({ status, message });
  }

  /** Put the player in `host` (an empty element that stays on screen) and start following the music. */
  async attach(host: HTMLElement, volume: number, muted: boolean) {
    if (this.host === host && this.player) return;
    this.detach();
    this.dead = false;
    this.host = host;
    const run = ++this.attaching;
    this.status("loading");
    let YT;
    try {
      YT = await loadYouTubeApi();
    } catch (e) {
      if (run === this.attaching) this.status("error", e instanceof Error ? `${e.message}. Check your connection and try again.` : "YouTube couldn't be reached.");
      return;
    }
    if (run !== this.attaching || this.dead || this.host !== host) return;
    const mount = document.createElement("div");
    host.replaceChildren(mount);
    this.player = new YT.Player(mount, {
      width: "100%",
      height: "100%",
      playerVars: { playsinline: 1, controls: 1, rel: 0, origin: location.origin, enablejsapi: 1 },
      events: {
        onReady: () => {
          this.ready = true;
          this.setVolume(volume, muted);
          this.status("ready");
          this.tick();
        },
        onStateChange: (e) => this.onState(e.data),
        onError: (e) => this.onError(e.data),
        onAutoplayBlocked: () => this.hold(),
      },
    });
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  /** Take the player down: this screen stops listening. */
  detach() {
    this.attaching++;
    this.dead = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    try {
      this.player?.destroy();
    } catch {
      // already gone
    }
    this.host?.replaceChildren();
    this.player = null;
    this.host = null;
    this.ready = false;
    this.loaded = null;
    this.blocked = false;
    this.state = YT_STATE.unstarted;
    this.status("off");
  }

  /** Where the player is right now (for checking in a browser's console while developing). */
  diag() {
    try {
      return { video: this.loaded, state: this.player?.getPlayerState(), time: this.player?.getCurrentTime(), muted: this.player?.isMuted(), blocked: this.blocked };
    } catch {
      return null;
    }
  }

  /** The house's music changed (or the clock moved on). */
  follow(music: Music | undefined) {
    this.music = music;
    if (this.ready) this.tick();
  }

  /**
   * Autoplay with sound was refused. Muted video is always allowed, so carry on muted (kept in step like any other)
   * and ask for a click, which brings the sound in.
   */
  private hold() {
    if (this.blocked) return;
    this.blocked = true;
    this.status("blocked");
    this.run(() => {
      this.player?.mute();
      if (this.music?.playing) this.player?.playVideo();
    });
  }

  /** Walking about: the loudness this far from the speakers. */
  setMix(mix: number) {
    if (mix === this.mix) return;
    this.mix = mix;
    const { volume } = usePartyUi.getState();
    try {
      if (this.player && this.ready) this.player.setVolume(Math.round(volume * this.mix));
    } catch {
      // the player was torn down
    }
  }

  setVolume(volume: number, muted: boolean) {
    if (!this.player || !this.ready) return;
    try {
      this.player.setVolume(Math.round(volume * this.mix));
      if (muted || this.blocked) this.player.mute();
      else this.player.unMute();
    } catch {
      // the player was torn down
    }
  }

  /** "Enable music": the person clicked, so bring the sound in (and play, if it's stopped). */
  enable() {
    const wasBlocked = this.blocked;
    this.blocked = false;
    this.lastCmd = 0;
    this.lastProgress = performance.now();
    this.ownUntil = performance.now() + OWN_MS;
    const { volume, muted } = usePartyUi.getState();
    try {
      this.player?.setVolume(Math.round(volume * this.mix));
      if (!muted) this.player?.unMute();
      if (this.music?.current && this.music.playing) this.player?.playVideo();
    } catch {
      // not ready yet: the next tick will do it
    }
    if (wasBlocked) this.status("loading");
    this.tick();
  }

  private tick() {
    const p = this.player;
    if (!p || !this.ready || this.dead) return;
    const m = this.music;
    const now = performance.now();
    let obs;
    try {
      obs = { videoId: this.loaded, state: p.getPlayerState(), time: p.getCurrentTime() };
    } catch {
      return;
    }
    this.state = obs.state;
    // a playhead that moves along at about the right speed means it's really playing
    const step = obs.time - this.lastTime;
    if (obs.state === YT_STATE.playing || (step > 0.2 && step < 1.5)) this.lastProgress = now;
    if (m?.playing && m.current && obs.videoId === m.current.videoId && obs.state !== YT_STATE.playing && obs.state !== YT_STATE.ended) {
      // it should be playing and isn't: usually the browser wanting a click before it makes any sound
      const stuck = now - Math.max(this.lastProgress, this.loadedAt);
      if (!this.blocked && stuck > (obs.state === YT_STATE.buffering ? STALL_BUFFERING_MS : STALL_MS)) this.hold();
    }
    // someone turned the sound on with the player's own volume button: no longer held back
    try {
      if (this.blocked && obs.state === YT_STATE.playing && !p.isMuted()) this.blocked = false;
    } catch {
      // gone
    }
    // the label follows what the player is really doing (not only what it last announced)
    const label = obs.state === YT_STATE.playing ? "playing" : obs.state === YT_STATE.buffering ? "buffering" : obs.state === YT_STATE.paused ? "paused" : null;
    if (label && usePartyUi.getState().status !== "error") this.status(this.blocked ? "blocked" : label);
    // someone dragged the player's own progress bar: that's a seek for everybody
    if (m?.current && obs.videoId === m.current.videoId && this.lastAt && now > this.ownUntil && obs.state === YT_STATE.playing && userSeeked(this.lastTime, obs.time, (now - this.lastAt) / 1000)) {
      this.lastTime = obs.time;
      this.lastAt = now;
      this.send({ cmd: "seek", ms: Math.round(obs.time * 1000) });
      return;
    }
    this.lastTime = obs.time;
    this.lastAt = now;
    if (!m) return;
    if (now - this.lastCmd < OWN_MS) return;
    const expected = musicPosition(m, serverNow()) / 1000;
    const todo = plan(m.current, m.playing, expected, obs);
    if (todo.clear) {
      this.run(() => p.pauseVideo());
      this.loaded = null;
      this.status("ready");
      return;
    }
    if (todo.load) {
      this.loaded = todo.load.videoId;
      this.loadedAt = now;
      this.lastTime = todo.load.at;
      this.run(() => (todo.load!.play && !this.blocked ? p.loadVideoById({ videoId: todo.load!.videoId, startSeconds: todo.load!.at }) : p.cueVideoById({ videoId: todo.load!.videoId, startSeconds: todo.load!.at })));
      this.status("loading");
      return;
    }
    if (todo.seek !== undefined) {
      const to = todo.seek;
      this.run(() => p.seekTo(to, true));
      this.lastTime = to;
    }
    if (todo.play) this.run(() => p.playVideo());
    if (todo.pause) this.run(() => p.pauseVideo());
  }

  /** Do something to the player, and for a moment treat what it reports as our own doing. */
  private run(fn: () => void) {
    this.ownUntil = performance.now() + OWN_MS;
    this.lastCmd = performance.now();
    try {
      fn();
    } catch {
      // the player was torn down under us
    }
  }

  private onState(state: number) {
    this.state = state;
    const m = this.music;
    const track = m?.current;
    this.status(this.blocked ? "blocked" : state === YT_STATE.playing ? "playing" : state === YT_STATE.buffering ? "buffering" : state === YT_STATE.paused ? "paused" : "ready");
    if (!track || !this.loaded || this.loaded !== track.videoId) return;
    if (state === YT_STATE.ended) {
      this.send({ cmd: "ended", trackId: track.id });
      return;
    }
    // what they do with YouTube's own controls counts for the house, unless it's something we just did ourselves
    if (performance.now() < this.ownUntil) return;
    if (state === YT_STATE.paused && m!.playing) this.send({ cmd: "pause" });
    else if (state === YT_STATE.playing && !m!.playing) this.send({ cmd: "play" });
  }

  private onError(code: number) {
    const track = this.music?.current;
    const why = YT_ERROR_TEXT[code] ?? "YouTube couldn't play that video.";
    this.status("error", why);
    toast(`${why} Skipping it.`);
    // the house skips what won't play (once, whichever screen says so first)
    if (track && this.loaded === track.videoId) this.send({ cmd: "error", trackId: track.id, code });
  }
}
