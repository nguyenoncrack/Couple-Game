import { useEffect, useMemo, useRef } from "react";
import { holdAmbient } from "../../state/music";
import { partyCmd, useGame } from "../../state/game";
import { MusicController } from "./musicController";
import { statusText } from "./PartyPanel";
import { resetPartyUi, setMusicPrefs, usePartyUi } from "./partyUi";

/**
 * Where the shared music plays on this screen. YouTube's own player sits here in full, with its controls, and
 * nothing is ever drawn over it; it stays on screen for as long as this screen is listening. Joining the music is
 * a click ("Enable music"), which is also what lets the browser play sound. Leaving the house (or leaving the
 * music) takes the player down.
 */
export function MusicDock() {
  const music = useGame((s) => s.life?.party?.music);
  const listening = usePartyUi((s) => s.listening);
  const status = usePartyUi((s) => s.status);
  const message = usePartyUi((s) => s.message);
  const volume = usePartyUi((s) => s.volume);
  const muted = usePartyUi((s) => s.muted);
  const host = useRef<HTMLDivElement>(null);
  const ctrl = useMemo(() => new MusicController(partyCmd), []);
  if (import.meta.env.DEV) Object.assign(window, { __music: ctrl });

  // the player is up while there's something to play, and only then (no player left standing about with nothing in it)
  const showPlayer = listening && Boolean(music?.current);
  useEffect(() => {
    if (showPlayer && host.current) void ctrl.attach(host.current, usePartyUi.getState().volume, usePartyUi.getState().muted);
    else ctrl.detach();
  }, [showPlayer, ctrl]);
  useEffect(() => ctrl.follow(music), [music, ctrl]);
  useEffect(() => ctrl.setVolume(volume, muted), [volume, muted, ctrl]);
  // the lo-fi background music steps aside while this screen plays the party's
  const playing = Boolean(listening && music?.current && music.playing);
  useEffect(() => {
    holdAmbient(playing);
  }, [playing]);
  useEffect(
    () => () => {
      ctrl.detach();
      holdAmbient(false);
      resetPartyUi();
    },
    [ctrl],
  );

  if (!listening)
    return music?.current ? (
      <button className="pill party-enable" onClick={() => usePartyUi.setState({ listening: true })}>
        <span aria-hidden>♪</span> {music.playing ? "Music is playing" : "Music is paused"} · Enable music
      </button>
    ) : null;

  return (
    <section className="party-dock" aria-label="Shared music">
      {showPlayer ? <div className="party-player" ref={host} /> : <p className="party-idle">Nothing queued yet. Add a video from the Party panel's Music tab.</p>}
      <div className="party-dock-bar">
        <span className={`party-status ${status}`}>{music?.current ? statusText(status) : "Nothing queued"}</span>
        {music?.current && (
          <button className="btn" onClick={() => partyCmd({ cmd: music.playing ? "pause" : "play" })}>
            {music.playing ? "Pause" : "Play"}
          </button>
        )}
        {music?.current && (
          <button className="btn" onClick={() => partyCmd({ cmd: "next", trackId: music.current!.id })}>
            Next
          </button>
        )}
        <button className="btn" onClick={() => setMusicPrefs({ muted: !muted })} aria-pressed={muted}>
          {muted ? "Unmute" : "Mute"}
        </button>
        <button className="btn" onClick={() => usePartyUi.setState({ listening: false })}>
          Leave
        </button>
      </div>
      {status === "blocked" && (
        <button className="btn primary party-enable-now" onClick={() => ctrl.enable()}>
          Enable music
        </button>
      )}
      {message && <p className="party-problem">{message}</p>}
    </section>
  );
}
