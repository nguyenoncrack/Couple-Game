import { BUILD_BEATS, DECK_TRACKS, deckBeat, deckTrack, DEFAULT_DECK, MAX_BPM, MIN_BPM, PHRASE_BEATS, sectionAt, type Deck, type DeckTrackId, type Music, type PartyCmd, type Section } from "@cg/shared";
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { useShallow } from "zustand/react/shallow";
import { partyCmd, serverNow, useGame } from "../../../state/game";
import { useSlider } from "../PartyPanel";
import { openDeck, setMusicPrefs, usePartyUi } from "../partyUi";
import type { DeckEngine } from "./deckEngine";
import "./dj.css";

/**
 * The DJ console: two turntables with the house's built-in records, a screen in the middle, and a mixer of chunky
 * pads, a crossfader and a filter knob. Everything on it is shared (both players work the same deck) except the
 * volume, mute and fade along the bottom. When a YouTube video plays, YouTube's own player takes the screen (it has
 * to stay in view while it plays, at 200 px or more), and the decks wait.
 */

type DeckSet = Extract<PartyCmd, { cmd: "deck" }>["set"];
const setDeck = (set: DeckSet) => partyCmd({ cmd: "deck", set });

const SECTION_TEXT: Record<Section, string> = { intro: "Intro", groove: "Groove", full: "Full", break: "Breakdown", rise: "Rising", build: "Build-up", drop: "Drop!" };

interface ConsoleProps {
  deck: Deck | undefined;
  music: Music | undefined;
  engine: DeckEngine;
  /** YouTube is playing here: its player is on the screen. */
  showYouTube: boolean;
  ytHost: RefObject<HTMLDivElement | null>;
  onEnableYouTube: () => void;
}

/** The deck's live readings, worked out each frame from the shared clock (not shared any further). */
function useDeckClock(deck: Deck, engine: DeckEngine, meters: RefObject<HTMLDivElement | null>) {
  const [section, setSection] = useState<Section>("intro");
  const [heard, setHeard] = useState(true);
  useEffect(() => {
    let raf = 0;
    const step = () => {
      const beat = deckBeat(deck, serverNow());
      const s = deck.playing ? sectionAt(beat, deck.drop) : sectionAt(beat, null);
      setSection(s);
      setHeard(engine.running);
      const el = meters.current;
      if (el) {
        const [a, b] = engine.levels();
        el.style.setProperty("--lv-a", a.toFixed(3));
        el.style.setProperty("--lv-b", b.toFixed(3));
        el.style.setProperty("--beat", String(Math.floor(beat) % 4));
        el.style.setProperty("--phrase", ((beat % PHRASE_BEATS) / PHRASE_BEATS).toFixed(4));
        el.dataset.beat = String(deck.playing ? Math.floor(beat) % 4 : -1);
      }
      raf = requestAnimationFrame(step);
    };
    step();
    return () => cancelAnimationFrame(raf);
  }, [deck, engine, meters]);
  return { section, heard };
}

export function DjConsole({ deck: shared, music, engine, showYouTube, ytHost, onEnableYouTube }: ConsoleProps) {
  const deck = shared ?? DEFAULT_DECK;
  const root = useRef<HTMLDivElement>(null);
  const { section, heard } = useDeckClock(deck, engine, root);
  const { volume, muted, fade, status } = usePartyUi(useShallow((s) => ({ volume: s.volume, muted: s.muted, fade: s.fade, status: s.status })));
  const djs = useGame(useShallow((s) => Object.values(s.life?.avatars ?? {}).filter((a) => a.use?.action === "dj").map((a) => s.members.find((m) => m.id === a.memberId)?.name ?? "Someone")));
  const xfade = useSlider(deck.xfade, (v) => setDeck({ xfade: v }), 120);
  const filter = useSlider(deck.filter, (v) => setDeck({ filter: v }), 120);
  const cued: "a" | "b" = deck.xfade < 0.5 ? "b" : "a";
  const dropping = deck.playing && (section === "build" || section === "drop");
  const style = { "--a": deckTrack(deck.a).color, "--b": deckTrack(deck.b).color, "--spin": `${(1.8 * 124) / deck.bpm}s`, "--build": `${(BUILD_BEATS * 60) / deck.bpm}s` } as CSSProperties;

  return (
    <section ref={root} className={`dj ${deck.playing ? "is-playing" : ""} ${section === "drop" && deck.playing ? "is-drop" : ""}`} style={style} aria-label="DJ deck">
      <header className="dj-head">
        <span className="dj-logo">
          <span className="dj-led" aria-hidden /> DJ deck
        </span>
        <span className="dj-on">{djs.length ? `${djs.join(" & ")} on the decks` : deck.playing ? "Live" : showYouTube ? "YouTube on air" : "Ready"}</span>
        <button className="dj-mini" onClick={() => usePartyUi.setState({ deckOpen: false })} disabled={showYouTube} title={showYouTube ? "YouTube's player stays in view while it plays" : "Make it small"} aria-label="Make the deck small">
          –
        </button>
      </header>

      <div className="dj-top">
        <Turntable side="a" id={deck.a} playing={deck.playing} live={deck.xfade < 0.98} cued={cued === "a"} />
        <div className={`dj-screen ${showYouTube ? "yt" : ""}`}>
          {showYouTube ? (
            <>
              <div className="party-player dj-yt" ref={ytHost} />
              {status === "blocked" && (
                <button className="dj-pad dj-yt-enable" onClick={onEnableYouTube}>
                  Turn the sound on
                </button>
              )}
            </>
          ) : (
            <Visualizer deck={deck} section={section} music={music} />
          )}
        </div>
        <Turntable side="b" id={deck.b} playing={deck.playing} live={deck.xfade > 0.02} cued={cued === "b"} />
      </div>

      <div className="dj-mixer">
        <button className={`dj-pad dj-play ${deck.playing ? "on" : ""}`} onClick={() => setDeck({ playing: !deck.playing })} aria-pressed={deck.playing}>
          <span aria-hidden>{deck.playing ? "❚❚" : "▶"}</span>
          {deck.playing ? "Pause" : "Play"}
        </button>
        <div className="dj-fader">
          <span className="dj-label">A</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(xfade.value * 100)}
            onChange={(e) => xfade.onChange(Number(e.target.value) / 100)}
            onPointerUp={xfade.onRelease}
            onKeyUp={xfade.onRelease}
            onBlur={xfade.onRelease}
            onDoubleClick={() => xfade.onChange(0.5)}
            aria-label="Crossfader, deck A to deck B"
          />
          <span className="dj-label">B</span>
        </div>
        <Knob label="Filter" value={filter.value} onChange={filter.onChange} onRelease={filter.onRelease} />
        <button className={`dj-pad dj-echo ${deck.echo ? "on" : ""}`} onClick={() => setDeck({ echo: !deck.echo })} aria-pressed={deck.echo}>
          Echo
        </button>
        <button className={`dj-pad dj-drop ${dropping ? section : ""}`} onClick={() => partyCmd({ cmd: "drop" })} disabled={!deck.playing || dropping} title="Build up for two bars, then drop">
          {section === "build" && deck.playing ? "Build…" : section === "drop" && deck.playing ? "Drop!" : "Drop"}
        </button>
        <div className="dj-tempo" aria-label="Tempo">
          <button className="dj-nudge" onClick={() => setDeck({ bpm: Math.max(MIN_BPM, deck.bpm - 2) })} disabled={deck.bpm <= MIN_BPM} aria-label="Slower">
            −
          </button>
          <span className="dj-bpm">
            {deck.bpm}
            <small>BPM</small>
          </span>
          <button className="dj-nudge" onClick={() => setDeck({ bpm: Math.min(MAX_BPM, deck.bpm + 2) })} disabled={deck.bpm >= MAX_BPM} aria-label="Faster">
            +
          </button>
        </div>
      </div>

      <div className="dj-crate" role="list" aria-label={`Records: pick one to load it onto deck ${cued.toUpperCase()}`}>
        {DECK_TRACKS.map((t) => {
          const on = [deck.a === t.id ? "A" : "", deck.b === t.id ? "B" : ""].filter(Boolean).join("+");
          return (
            <button key={t.id} role="listitem" className={`dj-sleeve ${on ? "loaded" : ""}`} style={{ "--c": t.color } as CSSProperties} onClick={() => setDeck({ [cued]: t.id } as DeckSet)} title={`Load onto deck ${cued.toUpperCase()}`}>
              <span className="dj-sleeve-art" aria-hidden />
              <span className="dj-sleeve-name">{t.name}</span>
              <span className="dj-sleeve-style">{t.style}</span>
              {on && <span className="dj-sleeve-tag">{on}</span>}
            </button>
          );
        })}
      </div>

      <footer className="dj-foot">
        <label className="dj-vol">
          <span>Volume</span>
          <input type="range" min={0} max={100} value={volume} onChange={(e) => setMusicPrefs({ volume: Number(e.target.value) })} aria-label="Volume, just for you" />
        </label>
        <button className={`dj-chip ${muted ? "on" : ""}`} onClick={() => setMusicPrefs({ muted: !muted })} aria-pressed={muted}>
          {muted ? "Muted" : "Mute"}
        </button>
        <button className={`dj-chip ${fade ? "on" : ""}`} onClick={() => setMusicPrefs({ fade: !fade })} aria-pressed={fade} title="Quieter the further you walk from the speakers">
          Fade
        </button>
        <span className="dj-note">Just you</span>
        <button className="dj-chip dj-leave" onClick={() => usePartyUi.setState({ listening: false, deckOpen: false })}>
          Leave
        </button>
      </footer>
      {!heard && deck.playing && !showYouTube && (
        <button className="dj-hear" onClick={() => engine.start()}>
          Tap to hear the music
        </button>
      )}
    </section>
  );
}

/** One turntable: a record that turns while the deck plays, with the record's name, and a level meter. */
function Turntable({ side, id, playing, live, cued }: { side: "a" | "b"; id: DeckTrackId; playing: boolean; live: boolean; cued: boolean }) {
  const t = deckTrack(id);
  return (
    <div className={`dj-table dj-${side} ${live ? "live" : ""} ${cued ? "cued" : ""}`}>
      <div className="dj-platter" aria-hidden>
        <div className={`dj-vinyl ${playing ? "spin" : ""}`}>
          <span className="dj-label-dot" />
        </div>
        <span className="dj-arm" />
      </div>
      <div className="dj-meter" aria-hidden>
        {Array.from({ length: 8 }, (_, i) => (
          <i key={i} style={{ "--i": i } as CSSProperties} />
        ))}
      </div>
      <div className="dj-track">
        <span className="dj-deck-name">Deck {side.toUpperCase()}</span>
        <b>{t.name}</b>
        <span>{cued ? "Cued: pick a record" : t.style}</span>
      </div>
    </div>
  );
}

/** The screen between the decks: what's on air, the section, the beat and how far round the phrase it is. */
function Visualizer({ deck, section, music }: { deck: Deck; section: Section; music: Music | undefined }) {
  const air = deck.xfade < 0.35 ? deckTrack(deck.a).name : deck.xfade > 0.65 ? deckTrack(deck.b).name : `${deckTrack(deck.a).name} × ${deckTrack(deck.b).name}`;
  return (
    <div className="dj-vis">
      <div className="dj-air">{deck.playing ? air : "Press play"}</div>
      <div className={`dj-section s-${section}`}>{deck.playing ? SECTION_TEXT[section] : "Paused"}</div>
      <div className="dj-beats" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <i key={i} data-i={i} />
        ))}
      </div>
      <div className="dj-phrase" aria-hidden>
        <i />
      </div>
      <div className="dj-fx">
        {deck.echo && <span>Echo</span>}
        {deck.filter < -0.05 && <span>Low-pass</span>}
        {deck.filter > 0.05 && <span>High-pass</span>}
      </div>
      {music?.current && !music.playing && (
        <button className="dj-yt-chip" onClick={() => partyCmd({ cmd: "play" })} title="Play the YouTube video (the decks wait)">
          ▶ YouTube
        </button>
      )}
    </div>
  );
}

/** A knob: drag up or down (or use the arrow keys); a double-click puts it back in the middle. */
function Knob({ label, value, onChange, onRelease }: { label: string; value: number; onChange: (v: number) => void; onRelease: () => void }) {
  const drag = useRef<{ y: number; v: number } | null>(null);
  const clamp = (v: number) => Math.round(Math.min(1, Math.max(-1, v)) * 100) / 100;
  const angle = value * 135;
  const down = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, v: value };
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current) onChange(clamp(drag.current.v + (drag.current.y - e.clientY) / 90));
  };
  const up = () => {
    drag.current = null;
    onRelease();
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const by = e.key === "ArrowUp" || e.key === "ArrowRight" ? 0.1 : e.key === "ArrowDown" || e.key === "ArrowLeft" ? -0.1 : null;
    if (e.key === "Home") onChange(0);
    else if (by !== null) onChange(clamp(value + by));
    else return;
    e.preventDefault();
  };
  return (
    <div className="dj-knob-wrap">
      <div
        className="dj-knob"
        role="slider"
        tabIndex={0}
        aria-label={`${label}: left muffles, right thins`}
        aria-valuemin={-1}
        aria-valuemax={1}
        aria-valuenow={value}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={key}
        onKeyUp={onRelease}
        onDoubleClick={() => {
          onChange(0);
          onRelease();
        }}
      >
        <span className="dj-knob-cap" style={{ transform: `rotate(${angle}deg)` }} />
      </div>
      <span className="dj-label">{label}</span>
    </div>
  );
}

/** The deck made small: a turning record, what's on, and a way back in. */
export function DeckBar({ deck, music, listening }: { deck: Deck | undefined; music: Music | undefined; listening: boolean }) {
  const d = deck ?? DEFAULT_DECK;
  const youtube = Boolean(music?.current && music.playing);
  const playing = d.playing || youtube;
  const label = d.playing ? deckTrack(d.xfade < 0.5 ? d.a : d.b).name : youtube ? "YouTube" : "DJ deck";
  return (
    <button className={`dj-bar ${playing ? "is-playing" : ""}`} onClick={openDeck} style={{ "--a": deckTrack(d.a).color, "--spin": `${(1.8 * 124) / d.bpm}s` } as CSSProperties}>
      <span className={`dj-vinyl small ${d.playing ? "spin" : ""}`} aria-hidden>
        <span className="dj-label-dot" />
      </span>
      <span className="dj-bar-text">
        <b>{label}</b>
        <span>{!listening && playing ? "Music is playing · tap to join" : playing ? "Playing · open the deck" : "Open the deck"}</span>
      </span>
    </button>
  );
}
