import { BUILD_BEATS, DECK_TRACKS, deckBeat, deckTrack, DEFAULT_DECK, MAX_BPM, MIN_BPM, PHRASE_BEATS, sectionAt, type Deck, type DeckTrackId, type PartyCmd, type Section } from "@cg/shared";
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { useShallow } from "zustand/react/shallow";
import { act, partyCmd, serverNow, useGame } from "../../../state/game";
import { useMusicOn } from "../../../state/music";
import { usePartyGear, useSlider, type GearInUse } from "../partyHooks";
import { setConsoleTab, setMusicPrefs, usePartyUi } from "../partyUi";
import type { DeckEngine } from "./deckEngine";
import { LightsPage } from "./LightsPage";
import "./dj.css";

/**
 * The console you get while your character works the party gear. At the DJ booth it's the full deck: two
 * turntables with the house's built-in records, a screen in the middle, and a mixer of chunky pads, a crossfader and
 * a filter knob. At a music player it's the simple version: one record on, play, skip and a crate to pick from. Both
 * have a lights page when the house has party lights. Everything on it is shared (both players work the same deck)
 * except the volume, mute and fade along the bottom. Stepping away puts it away; the music plays on.
 */

type DeckSet = Extract<PartyCmd, { cmd: "deck" }>["set"];
const setDeck = (set: DeckSet) => partyCmd({ cmd: "deck", set });

const SECTION_TEXT: Record<Section, string> = { intro: "Intro", groove: "Groove", full: "Full", break: "Breakdown", rise: "Rising", build: "Build-up", drop: "Drop!" };

interface ConsoleProps {
  deck: Deck | undefined;
  engine: DeckEngine;
  /** The booth's full deck, or a music player's simple one. */
  mode: GearInUse;
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

export function DjConsole({ deck: shared, engine, mode }: ConsoleProps) {
  const deck = shared ?? DEFAULT_DECK;
  const root = useRef<HTMLDivElement>(null);
  const { section, heard } = useDeckClock(deck, engine, root);
  const { volume, muted, fade, tab: chosen } = usePartyUi(useShallow((s) => ({ volume: s.volume, muted: s.muted, fade: s.fade, tab: s.tab })));
  const gear = usePartyGear();
  const hasLights = gear.lights || gear.dance;
  const tab = hasLights ? chosen : "music";
  const musicOn = useMusicOn();
  const djs = useGame(useShallow((s) => Object.values(s.life?.avatars ?? {}).filter((a) => a.use?.action === "dj").map((a) => s.members.find((m) => m.id === a.memberId)?.name ?? "Someone")));
  const style = { "--a": deckTrack(deck.a).color, "--b": deckTrack(deck.b).color, "--spin": `${(1.8 * 124) / deck.bpm}s`, "--build": `${(BUILD_BEATS * 60) / deck.bpm}s` } as CSSProperties;
  const tabs = [
    { id: "music", label: mode === "dj" ? "Decks" : "Records" },
    { id: "lights", label: "Lights" },
  ] as const;

  return (
    <section ref={root} className={`dj dj-mode-${mode} ${deck.playing ? "is-playing" : ""} ${section === "drop" && deck.playing ? "is-drop" : ""}`} style={style} aria-label={mode === "dj" ? "DJ deck" : "Music player"}>
      <header className="dj-head">
        <span className="dj-logo">
          <span className="dj-led" aria-hidden /> {mode === "dj" ? "DJ deck" : "Music"}
        </span>
        {hasLights && (
          <div className="dj-tabs" role="tablist">
            {tabs.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className={`dj-tab ${tab === t.id ? "on" : ""}`} onClick={() => setConsoleTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
        )}
        <span className="dj-on">{djs.length ? `${djs.join(" & ")} on the decks` : deck.playing ? "Live" : "Ready"}</span>
        <button className="dj-chip dj-away" onClick={() => act({ do: "stop" })} title="Put the controls away (the music plays on)">
          Step away
        </button>
      </header>

      {tab === "lights" ? <LightsPage /> : mode === "dj" ? <DeckPage deck={deck} section={section} /> : <PlayerPage deck={deck} section={section} />}

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
        <span className="dj-note">{musicOn ? "Just you" : "Music is switched off in the game"}</span>
      </footer>
      {!heard && deck.playing && musicOn && (
        <button className="dj-hear" onClick={() => engine.start()}>
          Tap to hear the music
        </button>
      )}
    </section>
  );
}

/** The booth's decks: both turntables, the screen, the mixer and the crate (a record goes onto the cued deck). */
function DeckPage({ deck, section }: { deck: Deck; section: Section }) {
  const xfade = useSlider(deck.xfade, (v) => setDeck({ xfade: v }), 120);
  const filter = useSlider(deck.filter, (v) => setDeck({ filter: v }), 120);
  const cued: "a" | "b" = deck.xfade < 0.5 ? "b" : "a";
  const dropping = deck.playing && (section === "build" || section === "drop");
  return (
    <>
      <div className="dj-top">
        <Turntable side="a" id={deck.a} playing={deck.playing} live={deck.xfade < 0.98} cued={cued === "a"} />
        <div className="dj-screen">
          <Visualizer deck={deck} section={section} />
        </div>
        <Turntable side="b" id={deck.b} playing={deck.playing} live={deck.xfade > 0.02} cued={cued === "b"} />
      </div>

      <div className="dj-mixer">
        <PlayPad deck={deck} />
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

      <Crate label={`Records: pick one to load it onto deck ${cued.toUpperCase()}`} tagOf={(id) => [deck.a === id ? "A" : "", deck.b === id ? "B" : ""].filter(Boolean).join("+")} onPick={(id) => setDeck({ [cued]: id } as DeckSet)} title={`Load onto deck ${cued.toUpperCase()}`} />
    </>
  );
}

/** A music player: whichever record is on air, play and skip, and a crate where a pick goes straight on. */
function PlayerPage({ deck, section }: { deck: Deck; section: Section }) {
  const air: "a" | "b" = deck.xfade < 0.5 ? "a" : "b";
  const on = deck[air];
  const pick = (id: DeckTrackId) => setDeck({ [air]: id, xfade: air === "a" ? 0 : 1, playing: true } as DeckSet);
  const skip = () => {
    const i = DECK_TRACKS.findIndex((t) => t.id === on);
    pick(DECK_TRACKS[(i + 1) % DECK_TRACKS.length]!.id);
  };
  return (
    <>
      <div className="dj-top dj-top-player">
        <Turntable side={air} id={on} playing={deck.playing} live cued={false} label="On air" />
        <div className="dj-screen">
          <Visualizer deck={deck} section={section} />
        </div>
      </div>
      <div className="dj-mixer">
        <PlayPad deck={deck} />
        <button className="dj-pad" onClick={skip}>
          <span aria-hidden>⏭</span> Skip
        </button>
        <span className="dj-note dj-mixer-note">Pick a record to put it on. The DJ booth has the full deck.</span>
      </div>
      <Crate label="Records: pick one to play it" tagOf={(id) => (id === on ? "On" : "")} onPick={pick} title="Play this one" />
    </>
  );
}

function PlayPad({ deck }: { deck: Deck }) {
  return (
    <button className={`dj-pad dj-play ${deck.playing ? "on" : ""}`} onClick={() => setDeck({ playing: !deck.playing })} aria-pressed={deck.playing}>
      <span aria-hidden>{deck.playing ? "❚❚" : "▶"}</span>
      {deck.playing ? "Pause" : "Play"}
    </button>
  );
}

/** The house's records as sleeves; `tagOf` says what to mark on one (where it's loaded). */
function Crate({ label, title, tagOf, onPick }: { label: string; title: string; tagOf: (id: DeckTrackId) => string; onPick: (id: DeckTrackId) => void }) {
  return (
    <div className="dj-crate" role="list" aria-label={label}>
      {DECK_TRACKS.map((t) => {
        const tag = tagOf(t.id);
        return (
          <button key={t.id} role="listitem" className={`dj-sleeve ${tag ? "loaded" : ""}`} style={{ "--c": t.color } as CSSProperties} onClick={() => onPick(t.id)} title={title}>
            <span className="dj-sleeve-art" aria-hidden />
            <span className="dj-sleeve-name">{t.name}</span>
            <span className="dj-sleeve-style">{t.style}</span>
            {tag && <span className="dj-sleeve-tag">{tag}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** One turntable: a record that turns while the deck plays, with the record's name, and a level meter. */
function Turntable({ side, id, playing, live, cued, label }: { side: "a" | "b"; id: DeckTrackId; playing: boolean; live: boolean; cued: boolean; label?: string }) {
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
        <span className="dj-deck-name">{label ?? `Deck ${side.toUpperCase()}`}</span>
        <b>{t.name}</b>
        <span>{cued ? "Cued: pick a record" : t.style}</span>
      </div>
    </div>
  );
}

/** The screen between the decks: what's on air, the section, the beat and how far round the phrase it is. */
function Visualizer({ deck, section }: { deck: Deck; section: Section }) {
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
