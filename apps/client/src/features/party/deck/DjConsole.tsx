import {
  BUILD_BEATS,
  channelOf,
  DECK_TRACKS,
  deckBeat,
  deckTrack,
  dropCueOf,
  DEFAULT_BPM,
  DEFAULT_DECK,
  deckRunning,
  isRecording,
  marksOf,
  MAX_BPM,
  MAX_MARKS,
  MIN_BPM,
  MIX_BARS,
  MIX_STYLES,
  mixAt,
  mixDone,
  mixInto,
  mixOut,
  mixQueued,
  otherSide,
  sectionAt,
  sectionOf,
  trackBeats,
  trackPosition,
  type Deck,
  type DeckChannel,
  type DeckMix,
  type DeckSide,
  type DeckTrackId,
  type MixStyle,
  type PartyCmd,
  type Section,
} from "@cg/shared";
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { useShallow } from "zustand/react/shallow";
import { act, partyCmd, serverNow, useGame } from "../../../state/game";
import { useMusicOn } from "../../../state/music";
import { usePartyGear, useSlider, type GearInUse } from "../partyHooks";
import { BUILT_IN_PRESETS, removePreset, savePreset, setConsoleTab, setMixChoice, setMusicPrefs, usePartyUi, type MixPreset } from "../partyUi";
import type { DeckEngine } from "./deckEngine";
import { DjGuide } from "./DjGuide";
import { parseClock, preciseClock, secondsToBeats } from "./deckTime";
import { LightsPage } from "./LightsPage";
import { SetsPage } from "./SetsPage";
import { SoundPage } from "./SoundPage";
import { requestAnalysis, useAnalysis } from "./analysis/trackAnalysis";
import "./dj.css";

/**
 * The console you get while your character works the party gear. At the DJ booth it's the full deck: two
 * turntables, each with its own channel (volume and EQ), a place bar to jump around its record, and an eject; a
 * screen in the middle; a mixer of pads, a crossfader and a filter knob; transitions that take the music over to the
 * other deck; and the crate. At a music player it's the simple version: one record on air, play, skip and the crate.
 * Both have a lights page when the house has party lights. Everything on it is shared (both players work the same
 * deck) except the volume, mute and fade along the bottom, and your own saved transitions.
 */

type DeckSet = Extract<PartyCmd, { cmd: "deck" }>["set"];
const setDeck = (set: DeckSet) => partyCmd({ cmd: "deck", set });

const SECTION_TEXT: Record<Section, string> = { intro: "Intro", groove: "Groove", full: "Full", break: "Breakdown", rise: "Rising", build: "Build-up", drop: "Drop!" };
const EMPTY_COLOR = "#5a5566";
const SIDES: DeckSide[] = ["a", "b"];
const upper = (side: DeckSide) => side.toUpperCase();

type RecordingStatus = ReturnType<DeckEngine["recordingStatus"]>;
type RecordingStatuses = Record<DeckSide, RecordingStatus>;

/** A place in a record as a time: track beats at the default tempo, as m:ss (or h:mm:ss). */
export function trackClock(beats: number): string {
  const total = Math.max(0, Math.floor((beats * 60) / DEFAULT_BPM));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

interface ConsoleProps {
  deck: Deck | undefined;
  engine: DeckEngine;
  /** The booth's full deck, or a music player's simple one. */
  mode: GearInUse;
}

/** What the console shows of the deck right now, worked out from the shared clock. */
interface Clock {
  /** The beat, a few times a second (the bars and meters move every frame on their own). */
  beat: number;
  /** Where the crossfader really is (a transition moves it). */
  x: number;
  /** The deck on air (or the one a mix is heading for, once it's past halfway). */
  air: DeckSide;
  section: Section;
  heard: boolean;
  statuses: RecordingStatuses;
}

/** The part of its record the deck on air is in. */
function airSection(deck: Deck, beat: number, air: DeckSide): Section {
  const id = deck[air];
  const pos = trackPosition(deck, air, beat);
  if (!id || pos === null || isRecording(id)) return deck.playing ? sectionAt(beat, deck.drop) : "groove";
  return deck.playing ? sectionOf(pos, beat, deck.drop) : sectionAt(pos, null);
}

/** The deck's live readings: meters, place bars and beat lights every frame, the rest a few times a second. */
function useDeckClock(deck: Deck, engine: DeckEngine, root: RefObject<HTMLDivElement | null>): Clock {
  const read = (): Clock => {
    const beat = deckBeat(deck, serverNow());
    const x = mixAt(deck, beat).xfade;
    const air: DeckSide = x < 0.5 ? "a" : "b";
    return { beat, x, air, section: airSection(deck, beat, air), heard: engine.running, statuses: { a: engine.recordingStatus("a"), b: engine.recordingStatus("b") } };
  };
  const [clock, setClock] = useState(read);
  useEffect(() => {
    let raf = 0;
    let shown = -1;
    const step = () => {
      const now = read();
      const el = root.current;
      if (el) {
        const [a, b] = engine.levels();
        el.style.setProperty("--lv-a", a.toFixed(3));
        el.style.setProperty("--lv-b", b.toFixed(3));
        for (const side of SIDES) {
          const id = deck[side];
          const pos = trackPosition(deck, side, now.beat);
          el.style.setProperty(`--pos-${side}`, id && pos !== null ? (pos / trackBeats(id)).toFixed(4) : "0");
        }
        const airId = deck[now.air];
        const airPos = trackPosition(deck, now.air, now.beat);
        el.style.setProperty("--phrase", airId && airPos !== null ? (airPos / trackBeats(airId)).toFixed(4) : "0");
        el.style.setProperty("--xlive", now.x.toFixed(3));
        el.dataset.beat = String(deck.playing ? Math.floor(now.beat) % 4 : -1);
      }
      // the rest re-draws about eight times a second (or when something changes)
      const tick = Math.floor(now.beat * 4);
      setClock((was) =>
        tick !== shown || was.section !== now.section || was.heard !== now.heard || was.statuses.a !== now.statuses.a || was.statuses.b !== now.statuses.b || was.air !== now.air ? ((shown = tick), now) : was,
      );
      raf = requestAnimationFrame(step);
    };
    step();
    return () => cancelAnimationFrame(raf);
  }, [deck, engine, root]);
  return clock;
}

export function DjConsole({ deck: shared, engine, mode }: ConsoleProps) {
  const deck = shared ?? DEFAULT_DECK;
  const root = useRef<HTMLDivElement>(null);
  const clock = useDeckClock(deck, engine, root);
  const { section, heard } = clock;
  const { volume, muted, fade, tab: chosen } = usePartyUi(useShallow((s) => ({ volume: s.volume, muted: s.muted, fade: s.fade, tab: s.tab })));
  const gear = usePartyGear();
  const hasLights = gear.lights || gear.dance;
  const tab = (chosen === "lights" && !hasLights) || ((chosen === "sets" || chosen === "sound") && mode !== "dj") ? "music" : chosen;
  // at the booth, every record's waveform and beats get worked out in the background (the ones on the decks first)
  useEffect(() => {
    if (mode !== "dj") return;
    requestAnalysis(deck.a, true);
    requestAnalysis(deck.b, true);
    for (const t of DECK_TRACKS) requestAnalysis(t.id);
  }, [mode, deck.a, deck.b]);
  const musicOn = useMusicOn();
  const djs = useGame(useShallow((s) => Object.values(s.life?.avatars ?? {}).filter((a) => a.use?.action === "dj").map((a) => s.members.find((m) => m.id === a.memberId)?.name ?? "Someone")));
  const color = (side: DeckSide) => (deck[side] ? deckTrack(deck[side]).color : EMPTY_COLOR);
  const style = { "--a": color("a"), "--b": color("b"), "--spin": `${(1.8 * 124) / deck.bpm}s`, "--build": `${(BUILD_BEATS * 60) / deck.bpm}s` } as CSSProperties;
  const tabs = [
    { id: "music", label: mode === "dj" ? "Decks" : "Records" },
    ...(mode === "dj" ? [{ id: "sound", label: "Sound" } as const, { id: "sets", label: "My Sets" } as const] : []),
    ...(hasLights ? [{ id: "lights", label: "Lights" } as const] : []),
    { id: "guide", label: "Guide" },
  ] as const;

  return (
    <section ref={root} className={`dj dj-mode-${mode} ${deck.playing ? "is-playing" : ""} ${section === "drop" && deck.playing ? "is-drop" : ""}`} style={style} aria-label={mode === "dj" ? "DJ deck" : "Music player"}>
      <header className="dj-head">
        <span className="dj-logo">
          <span className="dj-led" aria-hidden /> {mode === "dj" ? "DJ deck" : "Music"}
        </span>
        <div className="dj-tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={`dj-tab ${tab === t.id ? "on" : ""}`} onClick={() => setConsoleTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <span className="dj-on">{djs.length ? `${djs.join(" & ")} on the decks` : deck.playing ? "Live" : "Ready"}</span>
        <button className="dj-chip dj-away" onClick={() => act({ do: "stop" })} title="Put the controls away (the music plays on)">
          Step away
        </button>
      </header>

      {tab === "guide" ? <DjGuide simple={mode !== "dj"} /> : tab === "sets" ? <SetsPage deck={deck} beat={clock.beat} air={clock.air} /> : tab === "sound" ? <SoundPage deck={deck} beat={clock.beat} x={clock.x} engine={engine} /> : tab === "lights" ? <LightsPage /> : mode === "dj" ? <DeckPage deck={deck} clock={clock} /> : <PlayerPage deck={deck} clock={clock} />}

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
        <span className="dj-note">{musicOn ? "Just you" : "Sound is switched off in the game"}</span>
      </footer>
      {!heard && deck.playing && musicOn && (
        <button className="dj-hear" onClick={() => engine.start()}>
          Tap to hear the music
        </button>
      )}
    </section>
  );
}

/** Where a picked record goes at the booth: an empty deck if there is one, otherwise the deck that isn't on air. */
function loadTarget(deck: Deck, air: DeckSide): DeckSide {
  const cued: DeckSide = air === "a" ? "b" : "a";
  if (!deck[cued]) return cued;
  if (!deck[air]) return air;
  return cued;
}

/** The booth's decks: both turntables with their channels, the screen, the mixer, transitions and the crate. */
function DeckPage({ deck, clock }: { deck: Deck; clock: Clock }) {
  const xfade = useSlider(deck.xfade, (v) => setDeck({ xfade: v }), 120);
  const filter = useSlider(deck.filter, (v) => setDeck({ filter: v }), 120);
  const { section, air, x, statuses, beat } = clock;
  const mixing = Boolean(deck.mix && !mixQueued(deck.mix, beat) && !mixDone(deck.mix, beat));
  const [selection, setSelection] = useState<DeckSide | "auto">("auto");
  const autoTarget = loadTarget(deck, air);
  const target = selection === "auto" ? autoTarget : selection;
  const dropping = deck.playing && (section === "build" || section === "drop");
  return (
    <>
      <div className="dj-top">
        <Turntable side="a" deck={deck} beat={beat} status={statuses.a} live={x < 0.98} cued={target === "a"} full />
        <div className="dj-screen">
          <Visualizer deck={deck} clock={clock} />
        </div>
        <Turntable side="b" deck={deck} beat={beat} status={statuses.b} live={x > 0.02} cued={target === "b"} full />
      </div>

      <div className="dj-mixer">
        <PlayPad deck={deck} />
        <div className={`dj-fader ${mixing ? "is-mixing" : ""}`}>
          <span className="dj-label">A</span>
          <input
            type="range"
            min={0}
            max={100}
            disabled={!deck.a || !deck.b}
            value={Math.round((deck.mix && !xfade.held ? x : xfade.value) * 100)}
            onChange={(e) => xfade.onChange(Number(e.target.value) / 100)}
            onPointerUp={xfade.onRelease}
            onKeyUp={xfade.onRelease}
            onBlur={xfade.onRelease}
            onDoubleClick={() => xfade.onChange(0.5)}
            aria-label="Crossfader, deck A to deck B (moving it stops a transition)"
          />
          <span className="dj-label">B</span>
        </div>
        <Knob label="Filter" value={filter.value} onChange={filter.onChange} onRelease={filter.onRelease} />
        <button className={`dj-pad dj-echo ${deck.echo ? "on" : ""}`} onClick={() => setDeck({ echo: !deck.echo })} aria-pressed={deck.echo}>
          Echo
        </button>
        <button className={`dj-pad dj-drop ${dropping ? section : ""}`} onClick={() => partyCmd({ cmd: "drop" })} disabled={!deck.playing || dropping} title="Add a build-up and crash to the mix">
          {section === "build" && deck.playing ? "Build…" : section === "drop" && deck.playing ? "Drop!" : "Drop FX"}
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

      <MixPanel deck={deck} clock={clock} />

      <div className="dj-load" role="group" aria-label="Choose which deck to load">
        <span>Load to</span>
        {(["auto", "a", "b"] as const).map((choice) => (
          <button key={choice} className={`dj-chip ${selection === choice ? "on" : ""}`} aria-pressed={selection === choice} onClick={() => setSelection(choice)}>
            {choice === "auto" ? `Auto (${upper(autoTarget)})` : upper(choice)}
          </button>
        ))}
      </div>
      <Crate
        label={`Records: pick one to load it onto deck ${upper(target)}`}
        tagOf={(id) => [deck.a === id ? "A" : "", deck.b === id ? "B" : ""].filter(Boolean).join("+")}
        onPick={(id) => setDeck({ [target]: id } as DeckSet)}
        title={`Load onto deck ${upper(target)}`}
      />
    </>
  );
}

const styleName = (style: MixStyle) => MIX_STYLES.find((m) => m.id === style)?.name ?? style;
const barsText = (bars: number) => `${bars} bar${bars === 1 ? "" : "s"}`;

/**
 * Transitions: one press takes the music over to the other deck, starting on the next bar line. Presets start one
 * straight away; below them you can pick a style and a length for the Mix pad, and keep that as a preset of your own.
 * A timed transition waits for a moment in the record on air ("at 2:45 on B, bring A in from 1:12"), with the
 * incoming record parked at its starting place until then.
 */
function MixPanel({ deck, clock }: { deck: Deck; clock: Clock }) {
  const { mixStyle, mixBars, presets } = usePartyUi(useShallow((s) => ({ mixStyle: s.mixStyle, mixBars: s.mixBars, presets: s.presets })));
  const [naming, setNaming] = useState<string | null>(null);
  const { beat, x } = clock;
  // (a finished transition has left the crossfader at its end, whatever the house last wrote down)
  const to: DeckSide = x < 0.5 ? "b" : "a";
  const live = deck.mix && !mixDone(deck.mix, beat) ? deck.mix : null;
  const timed = live && live.at !== undefined && mixQueued(live, beat) ? live : null;
  const mix = live && !timed ? live : null;
  const blocked = !deck.playing ? "Press Play to mix" : !deck[to] ? `Put a record on deck ${upper(to)} to mix to it` : null;
  const go = (style: MixStyle, bars: number) => {
    if (blocked || live) return;
    partyCmd({ cmd: "mix", style, bars });
  };
  const play = (p: MixPreset) => {
    setMixChoice({ mixStyle: p.style, mixBars: p.bars });
    go(p.style, p.bars);
  };
  const progress = mix && mix.start !== null ? Math.max(0, (beat - mix.start) / mix.beats) : 0;
  const all: (MixPreset & { mine?: number })[] = [...BUILT_IN_PRESETS, ...presets.map((p, i) => ({ ...p, mine: i }))];

  return (
    <div className={`dj-mixpanel ${mix ? "is-mixing" : ""}`} style={{ "--mixk": progress.toFixed(3) } as CSSProperties}>
      <div className="dj-mixrow dj-presets" role="group" aria-label="Transition presets">
        <span className="dj-label dj-mixlabel">Transitions</span>
        {all.map((p) => (
          <span key={`${p.mine ?? "b"}-${p.name}`} className={`dj-preset-wrap ${p.mine !== undefined ? "mine" : ""}`}>
            <button className={`dj-preset ${mix && mix.style === p.style && mix.beats === p.bars * 4 ? "on" : ""}`} onClick={() => play(p)} disabled={Boolean(blocked || live)} title={`${styleName(p.style)} over ${barsText(p.bars)}: ${MIX_STYLES.find((m) => m.id === p.style)?.hint ?? ""}`}>
              <b>{p.name}</b>
              <small>
                {styleName(p.style)} · {barsText(p.bars)}
              </small>
            </button>
            {p.mine !== undefined && (
              <button className="dj-preset-x" onClick={() => removePreset(p.mine!)} aria-label={`Delete the preset ${p.name}`} title="Delete this preset">
                ×
              </button>
            )}
          </span>
        ))}
      </div>
      <div className="dj-mixrow">
        <div className="dj-seg" role="radiogroup" aria-label="Transition style">
          {MIX_STYLES.map((m) => (
            <button key={m.id} role="radio" aria-checked={mixStyle === m.id} className={`dj-segbtn ${mixStyle === m.id ? "on" : ""}`} onClick={() => setMixChoice({ mixStyle: m.id })} title={m.hint}>
              {m.name}
            </button>
          ))}
        </div>
        <div className="dj-seg" role="radiogroup" aria-label="Transition length in bars">
          {MIX_BARS.map((n) => (
            <button key={n} role="radio" aria-checked={mixBars === n} className={`dj-segbtn ${mixBars === n ? "on" : ""}`} onClick={() => setMixChoice({ mixBars: n })} title={barsText(n)}>
              {n}
            </button>
          ))}
          <span className="dj-label dj-seg-unit">bars</span>
        </div>
        {naming === null ? (
          <button className="dj-chip" onClick={() => setNaming(`${styleName(mixStyle)} ${mixBars}`)} title="Keep this style and length as a transition preset (on this device)">
            + Save preset
          </button>
        ) : (
          <form
            className="dj-save"
            onSubmit={(e) => {
              e.preventDefault();
              savePreset(naming);
              setNaming(null);
            }}
          >
            <input autoFocus value={naming} maxLength={24} onChange={(e) => setNaming(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setNaming(null)} aria-label="Preset name" />
            <button className="dj-chip on" type="submit">
              Keep
            </button>
          </form>
        )}
        {mix ? (
          <button className="dj-pad dj-mixgo is-running" onClick={() => partyCmd({ cmd: "unmix" })} title="Stop the transition where it is">
            <span className="dj-mixbar" aria-hidden />
            {mix.start === null || beat < mix.start ? "Next bar…" : `Mixing ${Math.min(mix.beats / 4, Math.floor((beat - mix.start) / 4) + 1)}/${mix.beats / 4}`}
            <small>Stop</small>
          </button>
        ) : (
          <button className="dj-pad dj-mixgo" onClick={() => go(mixStyle, mixBars)} disabled={Boolean(blocked || timed)} title={timed ? "A timed transition is queued" : (blocked ?? `${styleName(mixStyle)} over ${barsText(mixBars)}`)}>
            Mix to {upper(to)} <span aria-hidden>➜</span>
          </button>
        )}
      </div>
      {timed ? <QueuedMix deck={deck} mix={timed} beat={beat} /> : !mix && <TimedMix deck={deck} beat={beat} to={to} style={mixStyle} bars={mixBars} />}
      {blocked && !live && <p className="dj-note dj-mixhint">{blocked} (or time one below)</p>}
      <p className="dj-note dj-mixhint">
        More than two songs?{" "}
        <button className="dj-linkbtn" onClick={() => setConsoleTab("sets")}>
          Link songs 1 ➜ 2 ➜ 3 ➜ … in My Sets
        </button>
      </p>
    </div>
  );
}

/** Queue a transition for a moment in the record on air, bringing the other record in from a place of your choosing. */
function TimedMix({ deck, beat, to, style, bars }: { deck: Deck; beat: number; to: DeckSide; style: MixStyle; bars: number }) {
  const out = otherSide(to);
  const outId = deck[out];
  const inId = deck[to];
  const [atText, setAtText] = useState("");
  const [inText, setInText] = useState("");
  const outPos = trackPosition(deck, out, beat) ?? 0;
  const inPos = trackPosition(deck, to, beat) ?? 0;
  const read = (text: string, id: DeckTrackId | null) => {
    const sec = text.trim() ? parseClock(text) : null;
    if (sec === null || !id) return null;
    const b = secondsToBeats(sec);
    return b < trackBeats(id) ? b : null;
  };
  const at = read(atText, outId);
  const inAt = inText.trim() ? read(inText, inId) : inPos;
  const outMoving = deckRunning(deck, out, beat);
  const past = at !== null && outMoving && at < outPos;
  const badAt = atText.trim() !== "" && (at === null || past);
  const badIn = inText.trim() !== "" && inAt === null;
  const ready = Boolean(outId && inId && at !== null && inAt !== null && !past);
  const queue = () => {
    if (!ready) return;
    partyCmd({ cmd: "mix", style, bars, at: at!, inAt: inAt! });
    setAtText("");
    setInText("");
  };
  if (!outId || !inId) return null;
  return (
    <form
      className="dj-mixrow dj-timed"
      onSubmit={(e) => {
        e.preventDefault();
        queue();
      }}
      aria-label="Timed transition"
    >
      <span className="dj-label dj-mixlabel">Timed</span>
      <label>
        At
        <input value={atText} onChange={(e) => setAtText(e.target.value)} placeholder={preciseClock(outPos)} className={badAt ? "bad" : ""} aria-invalid={badAt} aria-label={`When deck ${upper(out)} gets to (like 2:45)`} inputMode="decimal" />
        on {upper(out)}
      </label>
      <span aria-hidden>➜</span>
      <label>
        start {upper(to)} at
        <input value={inText} onChange={(e) => setInText(e.target.value)} placeholder={preciseClock(inPos)} className={badIn ? "bad" : ""} aria-invalid={badIn} aria-label={`Where deck ${upper(to)} comes in from (like 1:12)`} inputMode="decimal" />
      </label>
      <button className="dj-chip on" type="submit" disabled={!ready} title={past ? `Deck ${upper(out)} is already past that` : `Queue a ${styleName(style)} over ${barsText(bars)}`}>
        Queue {styleName(style)} · {barsText(bars)}
      </button>
      {past && <span className="dj-note">Deck {upper(out)} is already past {preciseClock(at!)}</span>}
    </form>
  );
}

/** The queued transition: what will happen and when, with Mix now and Cancel. */
function QueuedMix({ deck, mix, beat }: { deck: Deck; mix: DeckMix; beat: number }) {
  const out = mixOut(mix);
  const into = mixInto(mix);
  const waitSec = mix.start === null ? null : ((mix.start - beat) * 60) / deck.bpm;
  const when =
    mix.start === null ? `waiting: deck ${upper(out)} is paused` : `in ${trackClock(secondsToBeats(Math.ceil(Math.max(0, waitSec!))))}${deck.playing ? "" : " once you press Play"}`;
  return (
    <div className="dj-mixrow dj-queued" role="status" aria-label="Queued transition">
      <span className="dj-label dj-mixlabel">Queued</span>
      <span className="dj-queued-text">
        <span>
          At <b>{preciseClock(mix.at ?? 0)}</b> on {upper(out)} ➜ start {upper(into)} at <b>{preciseClock(mix.inAt ?? trackPosition(deck, into, beat) ?? 0)}</b> · {styleName(mix.style)} · {barsText(mix.beats / 4)}
        </span>
        <small>{when}</small>
      </span>
      <button className="dj-chip on" onClick={() => partyCmd({ cmd: "mixnow" })} title="Start the transition right now">
        Mix now
      </button>
      <button className="dj-chip" onClick={() => partyCmd({ cmd: "unmix" })} title={`Call it off (deck ${upper(into)} stays paused at its start)`}>
        Cancel
      </button>
    </div>
  );
}

/** A music player: whichever record is on air, play and skip, and a crate where a pick goes straight on. */
function PlayerPage({ deck, clock }: { deck: Deck; clock: Clock }) {
  const { air, statuses, beat } = clock;
  const on = deck[air];
  const pick = (id: DeckTrackId) => setDeck({ [air]: id, xfade: air === "a" ? 0 : 1, playing: true } as DeckSet);
  const skip = () => {
    const i = DECK_TRACKS.findIndex((t) => t.id === on);
    pick(DECK_TRACKS[(i + 1) % DECK_TRACKS.length]!.id);
  };
  return (
    <>
      <div className="dj-top dj-top-player">
        <Turntable side={air} deck={deck} beat={beat} status={statuses[air]} live cued={false} label="On air" />
        <div className="dj-screen">
          <Visualizer deck={deck} clock={clock} />
        </div>
      </div>
      <div className="dj-mixer">
        <PlayPad deck={deck} />
        <button className="dj-pad" onClick={skip}>
          <span aria-hidden>⏭</span> Skip
        </button>
        <span className="dj-note dj-mixer-note">Pick a record to put it on, and click the bar under it to jump. The DJ booth has the full deck.</span>
      </div>
      <Crate label="Records: pick one to play it" tagOf={(id) => (id === on ? "On" : "")} onPick={pick} title="Play this one" />
    </>
  );
}

function PlayPad({ deck }: { deck: Deck }) {
  const empty = !deck.a && !deck.b;
  return (
    <button className={`dj-pad dj-play ${deck.playing ? "on" : ""}`} onClick={() => setDeck({ playing: !deck.playing })} aria-pressed={deck.playing} disabled={empty && !deck.playing} title={empty ? "Put a record on first" : undefined}>
      <span aria-hidden>{deck.playing ? "❚❚" : "▶"}</span>
      {deck.playing ? "Pause" : "Play"}
    </button>
  );
}

/** The house's records as sleeves, in one row; `tagOf` says what to mark on one (where it's loaded). */
function Crate({ label, title, tagOf, onPick }: { label: string; title: string; tagOf: (id: DeckTrackId) => string; onPick: (id: DeckTrackId) => void }) {
  const analyzing = useAnalysis(useShallow((s) => DECK_TRACKS.filter((t) => s[t.id]?.status === "analyzing").map((t) => t.id)));
  return (
    <div className="dj-crate" role="list" aria-label={label}>
      {DECK_TRACKS.map((t) => {
        const tag = tagOf(t.id);
        return (
          <button key={t.id} role="listitem" className={`dj-sleeve ${tag ? "loaded" : ""}`} style={{ "--c": t.color } as CSSProperties} onClick={() => onPick(t.id)} title={`${title}: ${t.name}`}>
            <span className="dj-sleeve-art" aria-hidden />
            <span className="dj-sleeve-name">{t.name}</span>
            <span className="dj-sleeve-style">{analyzing.includes(t.id) ? "Analyzing…" : isRecording(t.id) ? `${t.style} · ${trackClock(trackBeats(t.id))}` : t.style}</span>
            {tag && <span className="dj-sleeve-tag">{tag}</span>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * One turntable: a record that turns while the deck plays, its name, a level meter and its place bar. At the booth
 * it also has its channel (EQ and volume) and an eject; an empty deck waits for a record.
 */
function Turntable({ side, deck, beat, live, cued, label, status, full }: { side: DeckSide; deck: Deck; beat: number; live: boolean; cued: boolean; label?: string; status: RecordingStatus; full?: boolean }) {
  const id = deck[side];
  const name = label ?? `Deck ${upper(side)}`;
  if (!id)
    return (
      <div className={`dj-table dj-${side} is-empty ${cued ? "cued" : ""}`}>
        <div className="dj-platter" aria-hidden>
          <div className="dj-vinyl dj-vinyl-empty" />
          <span className="dj-arm" />
        </div>
        <div className="dj-track">
          <span className="dj-deck-name">{name}</span>
          <b>Empty</b>
          <span>Pick a record below</span>
        </div>
      </div>
    );
  const t = deckTrack(id);
  return (
    <div className={`dj-table dj-${side} ${live ? "live" : ""} ${cued ? "cued" : ""}`}>
      {full && (
        <button className="dj-eject" onClick={() => setDeck({ [side]: null } as DeckSet)} aria-label={`Take the record off deck ${upper(side)}`} title="Take the record off (the other deck plays on its own)">
          ⏏
        </button>
      )}
      <div className="dj-platter" aria-hidden>
        <div className={`dj-vinyl ${deckRunning(deck, side, beat) ? "spin" : ""}`}>
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
        <span className="dj-deck-name">{name}</span>
        <b>{t.name}</b>
        <span>{status === "loading" ? "Loading…" : status === "error" ? "Could not load audio." : t.style}</span>
      </div>
      <PlaceBar key={id} deck={deck} side={side} id={id} beat={beat} drops={full} />
      {full && <ChannelStrip deck={deck} side={side} />}
    </div>
  );
}

/** What a deck's own Play button can do: pause it, play it, or nothing while it waits for a transition. */
function deckState(deck: Deck, side: DeckSide, beat: number): "running" | "held" | "parked" {
  const m = deck.mix;
  if (m && mixQueued(m, beat) && mixInto(m) === side && m.inAt !== undefined) return "parked";
  return deckRunning(deck, side, beat) ? "running" : "held";
}

/**
 * Where the deck is in its record: drag (or click, or arrow) to another part. A recording shows its time; a built-in
 * record its bar and section, with the sections marked. At the booth each deck also has its own Play and Pause, a
 * box to type an exact time into, and saved cue points to jump back to.
 */
function PlaceBar({ deck, side, id, beat, drops }: { deck: Deck; side: DeckSide; id: DeckTrackId; beat: number; drops?: boolean }) {
  const [draft, setDraft] = useState<number | null>(null);
  const len = trackBeats(id);
  const rec = isRecording(id);
  const current = trackPosition(deck, side, beat) ?? 0;
  const drop = dropCueOf(deck, side);
  const cues = marksOf(deck, id);
  const pos = draft ?? current;
  const clamp = (p: number) => Math.max(0, Math.min(len - 0.01, p));
  const jump = (p: number) => partyCmd({ cmd: "cue", side, track: id, pos: clamp(p) });
  const pickPosition = (e: PointerEvent<HTMLDivElement>) => {
    const bounds = e.currentTarget.getBoundingClientRect();
    return clamp(((e.clientX - bounds.left) / bounds.width) * len);
  };
  const by = rec ? (10 * DEFAULT_BPM) / 60 : 4;
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    if (e.repeat) return;
    if (e.key === "ArrowRight") jump(current + by);
    else if (e.key === "ArrowLeft") jump(current - by);
    else jump(e.key === "Home" ? 0 : len);
  };
  const text = rec ? `${trackClock(pos)} / ${trackClock(len)}` : `Bar ${Math.floor(pos / 4) + 1} of ${len / 4} · ${SECTION_TEXT[sectionAt(pos, null)]}`;
  const label = `deck ${upper(side)}`;
  const state = deckState(deck, side, beat);
  return (
    <div className="dj-place">
      <div
        className="dj-placebar"
        role="slider"
        tabIndex={0}
        aria-label={`Playback position on ${label}`}
        aria-valuemin={0}
        aria-valuemax={Math.round(len)}
        aria-valuenow={Math.round(pos)}
        aria-valuetext={text}
        onKeyDown={key}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          setDraft(pickPosition(e));
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) setDraft(pickPosition(e));
        }}
        onPointerUp={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) jump(pickPosition(e));
          setDraft(null);
        }}
        onLostPointerCapture={() => setDraft(null)}
      >
        <i className="dj-placefill" style={{ width: draft === null ? `calc(var(--pos-${side}, 0) * 100%)` : `${(pos / len) * 100}%` }} />
        {!rec && [8, 16, 24, 28].map((bar) => <i key={bar} className="dj-placemark" style={{ left: `${((bar * 4) / len) * 100}%` }} />)}
        {cues.map((c) => (
          <i key={c} className="dj-placemark dj-cue-mark" style={{ left: `${(c / len) * 100}%` }} />
        ))}
        {drop !== undefined && <i className="dj-placemark dj-drop-mark" style={{ left: `${(drop / len) * 100}%` }} />}
      </div>
      <span className="dj-placetext">
        {drops ? preciseClock(pos) : rec ? trackClock(pos) : text}
        {drops && <> / {rec ? trackClock(len) : `bar ${Math.floor(pos / 4) + 1} of ${len / 4}`}</>}
        {state === "held" && deck.playing && " · paused"}
        {state === "parked" && " · waiting to mix in"}
      </span>
      <div className="dj-transport">
        {drops && (
          <button
            className={`dj-chip dj-deckplay ${state === "running" ? "on" : ""}`}
            onClick={() => partyCmd({ cmd: "transport", side, playing: state !== "running" })}
            disabled={state === "parked"}
            aria-label={state === "running" ? `Pause ${label}` : `Play ${label}`}
            title={state === "parked" ? "Waiting for its transition (Mix now or Cancel it below)" : state === "running" ? `Pause ${label} (the other deck plays on)` : `Play ${label}`}
          >
            {state === "running" ? "❚❚ Pause" : "▶ Play"}
          </button>
        )}
        <button className="dj-chip" onClick={() => jump(0)} aria-label={`Restart ${label}`}>↶ Start</button>
        <button className="dj-chip" onClick={() => jump(current - by)} aria-label={`Jump back on ${label}`}>{rec ? "−10 s" : "−1 bar"}</button>
        <button className="dj-chip" onClick={() => jump(current + by)} aria-label={`Jump forward on ${label}`}>{rec ? "+10 s" : "+1 bar"}</button>
      </div>
      {drops && <CueRow side={side} id={id} cues={cues} label={label} jump={jump} at={() => trackPosition(deck, side, deckBeat(deck, serverNow())) ?? 0} />}
      {drops && (
        <div className="dj-transport">
          <button className="dj-chip" onClick={() => partyCmd({ cmd: "drop-cue", side, track: id, pos: trackPosition(deck, side, deckBeat(deck, serverNow())) ?? 0 })} aria-label={`Set drop on ${label}`}>Set drop</button>
          <button className="dj-chip dj-drop-cue" onClick={() => partyCmd({ cmd: "drop-cue", side, track: id })} disabled={drop === undefined} aria-label={`Drop now on ${label}`}>
            {drop === undefined ? "Drop now" : rec ? `Drop at ${trackClock(drop)}` : `Drop at bar ${Math.floor(drop / 4) + 1}`}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Type an exact time to go to (or to save as a cue), and the record's saved cues: click one to jump back to it.
 * Cues belong to the record, so they're there whenever it's loaded, on either deck.
 */
function CueRow({ side, id, cues, label, jump, at }: { side: DeckSide; id: DeckTrackId; cues: number[]; label: string; jump: (p: number) => void; at: () => number }) {
  const [typed, setTyped] = useState("");
  const len = trackBeats(id);
  const seconds = typed.trim() ? parseClock(typed) : null;
  const bad = typed.trim() !== "" && (seconds === null || secondsToBeats(seconds) >= len);
  const target = seconds !== null && !bad ? secondsToBeats(seconds) : null;
  const go = () => {
    if (target !== null) jump(target);
  };
  const save = () => {
    partyCmd({ cmd: "mark", track: id, pos: target ?? at() });
    setTyped("");
  };
  const full = cues.length >= MAX_MARKS;
  return (
    <>
      <form
        className="dj-transport dj-timebox"
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
      >
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="1:24.5"
          inputMode="decimal"
          aria-label={`Exact time on ${label} (like 1:24.5)`}
          aria-invalid={bad}
          className={bad ? "bad" : ""}
          title={bad ? `Not a time in this record (it's ${trackClock(len)} long)` : "Type a time like 1:24.5, then Go"}
        />
        <button className="dj-chip" type="submit" disabled={target === null}>
          Go
        </button>
        <button className="dj-chip" type="button" onClick={save} disabled={bad || full} title={full ? `Up to ${MAX_MARKS} cues per record` : target !== null ? `Save ${preciseClock(target)} as a cue` : "Save where the deck is now as a cue"}>
          Save cue
        </button>
      </form>
      {cues.length > 0 && (
        <div className="dj-cues" role="group" aria-label={`Saved cues on ${label}`}>
          {cues.map((c) => (
            <span key={c} className="dj-cue">
              <button onClick={() => jump(c)} title={`Jump ${label} to ${preciseClock(c)}`}>
                {preciseClock(c)}
              </button>
              <button className="dj-cue-x" onClick={() => partyCmd({ cmd: "mark", track: id, pos: c, remove: true })} aria-label={`Delete the cue at ${preciseClock(c)} on ${side.toUpperCase()}`}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </>
  );
}

/** A deck's own channel: high, mid and low EQ knobs and its volume. Shared, like the rest of the deck. */
function ChannelStrip({ deck, side }: { deck: Deck; side: DeckSide }) {
  const ch = channelOf(deck, side);
  const send = (p: Partial<DeckChannel>) => setDeck({ [side === "a" ? "chA" : "chB"]: p } as DeckSet);
  const high = useSlider(ch.high, (v) => send({ high: v }), 120);
  const mid = useSlider(ch.mid, (v) => send({ mid: v }), 120);
  const low = useSlider(ch.low, (v) => send({ low: v }), 120);
  const vol = useSlider(ch.vol, (v) => send({ vol: v }), 120);
  const hint = "left cuts it out, right lifts it";
  return (
    <div className="dj-channel" aria-label={`Deck ${upper(side)} channel`}>
      <Knob small label="Hi" hint={hint} value={high.value} onChange={high.onChange} onRelease={high.onRelease} />
      <Knob small label="Mid" hint={hint} value={mid.value} onChange={mid.onChange} onRelease={mid.onRelease} />
      <Knob small label="Low" hint={hint} value={low.value} onChange={low.onChange} onRelease={low.onRelease} />
      <label className="dj-chvol">
        <span className="dj-label">Vol</span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(vol.value * 100)}
          onChange={(e) => vol.onChange(Number(e.target.value) / 100)}
          onPointerUp={vol.onRelease}
          onKeyUp={vol.onRelease}
          onBlur={vol.onRelease}
          aria-label={`Deck ${upper(side)} volume`}
        />
      </label>
    </div>
  );
}

/** The screen between the decks: what's on air, its section (or time), the beat, how far through, and what's going on. */
function Visualizer({ deck, clock }: { deck: Deck; clock: Clock }) {
  const { x, air: airSide, section, beat } = clock;
  const name = (side: DeckSide) => (deck[side] ? deckTrack(deck[side]).name : "Empty");
  const air = x < 0.35 ? name("a") : x > 0.65 ? name("b") : `${name("a")} × ${name("b")}`;
  const airId = deck[airSide];
  const airPos = trackPosition(deck, airSide, beat);
  const recording = airId && isRecording(airId) && section !== "build" && section !== "drop";
  const label = !airId ? "No record" : recording && airPos !== null ? trackClock(airPos) : SECTION_TEXT[section];
  const mix = deck.mix && !mixDone(deck.mix, beat) ? deck.mix : null;
  return (
    <div className="dj-vis">
      <div className="dj-air">{deck.playing ? air : "Press play"}</div>
      <div className={`dj-section s-${recording ? "rec" : section}`}>{deck.playing ? label : "Paused"}</div>
      <div className="dj-beats" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <i key={i} data-i={i} />
        ))}
      </div>
      <div className="dj-phrase" aria-hidden>
        <i />
      </div>
      <div className="dj-fx">
        {mix && (
          <span className="dj-fx-mix">
            {mixQueued(mix, beat) ? "Queued" : styleName(mix.style)} → {upper(mixInto(mix))}
          </span>
        )}
        {deck.echo && <span>Echo</span>}
        {deck.filter < -0.05 && <span>Low-pass</span>}
        {deck.filter > 0.05 && <span>High-pass</span>}
      </div>
    </div>
  );
}

/** A knob: drag up or down (or use the arrow keys); a double-click puts it back in the middle. */
function Knob({ label, value, onChange, onRelease, hint = "left muffles, right thins", small }: { label: string; value: number; onChange: (v: number) => void; onRelease: () => void; hint?: string; small?: boolean }) {
  const drag = useRef<{ y: number; v: number } | null>(null);
  // (key presses can come faster than the knob re-draws: each one steps from the last, not from what's drawn)
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  }, [value]);
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
    if (e.key === "Home") onChange((latest.current = 0));
    else if (by !== null) onChange((latest.current = clamp(latest.current + by)));
    else return;
    e.preventDefault();
  };
  return (
    <div className={`dj-knob-wrap ${small ? "small" : ""}`}>
      <div
        className="dj-knob"
        role="slider"
        tabIndex={0}
        aria-label={`${label}: ${hint}`}
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
