import {
  deckBeat,
  deckTrack,
  DEFAULT_BPM,
  deckRunning,
  dropCueOf,
  isRecording,
  marksOf,
  MIX_BARS,
  MIX_STYLES,
  mixDone,
  mixQueued,
  otherSide,
  trackBeats,
  trackPosition,
  type Deck,
  type DeckSide,
  type DeckTrackId,
  type MixStyle,
} from "@cg/shared";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import { partyCmd, serverNow } from "../../../state/game";
import { setMixChoice, usePartyUi } from "../partyUi";
import type { Analysis } from "./analysis/analyze";
import { suggestMixes, type Suggestion } from "./analysis/suggest";
import { readyAnalysis, requestAnalysis, useAnalysis, type AnalysisState } from "./analysis/trackAnalysis";
import type { DeckEngine } from "./deckEngine";
import { parseClock, preciseClock, secondsToBeats } from "./deckTime";
import { previewPosition, startPreview, stopPreview, usePreview, type PreviewPlan } from "./preview";

/**
 * The Sound panel: both records as waveforms, with where each deck is, its timestamps, its cue and drop points and
 * (when the beat is steady) its bars. Click or drag to move a deck; zoom in to place things exactly. Set where the
 * record on air starts fading out and where the other one comes in, see the overlap, listen to it privately, and
 * queue it. Below, suggested transitions worked out from each record's tempo, beats and energy.
 */

const upper = (side: DeckSide) => side.toUpperCase();
const toSeconds = (beats: number) => (beats * 60) / DEFAULT_BPM;
const ZOOMS = [1, 2, 4, 8, 16, 32, 64] as const;
const styleName = (style: MixStyle) => MIX_STYLES.find((m) => m.id === style)?.name ?? style;
const barsText = (bars: number) => `${bars} bar${bars === 1 ? "" : "s"}`;

/** What clicking a waveform does: move the deck there, or set the transition's points. */
type Mode = "seek" | "points";

interface Points {
  at: number | null;
  inAt: number | null;
}

export function SoundPage({ deck, beat, x, engine }: { deck: Deck; beat: number; x: number; engine: DeckEngine }) {
  const { mixStyle, mixBars, volume } = usePartyUi(useShallow((s) => ({ mixStyle: s.mixStyle, mixBars: s.mixBars, volume: s.volume })));
  const analyses = useAnalysis();
  const preview = usePreview((s) => s.on);
  const [zoom, setZoom] = useState<number>(1);
  const [mode, setMode] = useState<Mode>("points");
  const [focus, setFocus] = useState(false);
  // the deck on air goes out; the other comes in (as the Mix pad and the reducer see it)
  const into: DeckSide = x < 0.5 ? "b" : "a";
  const out = otherSide(into);
  const outId = deck[out];
  const inId = deck[into];
  const pairKey = `${deck.a}|${deck.b}|${out}`;
  const [draft, setDraft] = useState<Points & { key: string }>({ at: null, inAt: null, key: pairKey });
  const points: Points = draft.key === pairKey ? draft : { at: null, inAt: null };
  const setPoints = (p: Partial<Points>) => setDraft({ ...points, ...p, key: pairKey });

  useEffect(() => {
    requestAnalysis(deck.a, true);
    requestAnalysis(deck.b, true);
  }, [deck.a, deck.b]);
  // a preview stops when you leave the page
  useEffect(() => stopPreview, []);

  const live = deck.mix && !mixDone(deck.mix, beat) ? deck.mix : null;
  const queued = live && live.at !== undefined && mixQueued(live, beat) ? live : null;
  const running = live && !queued ? live : null;
  // what the waveforms show: your points, or the queued transition's
  const shownAt = points.at ?? queued?.at ?? null;
  const shownIn = points.inAt ?? queued?.inAt ?? null;
  const shownBars = points.at !== null || points.inAt !== null || !queued ? mixBars : queued.beats / 4;
  const span = shownBars * 4;

  const outA = outId ? readyAnalysis(analyses[outId]) : null;
  const inA = inId ? readyAnalysis(analyses[inId]) : null;
  const outPos = trackPosition(deck, out, beat) ?? 0;
  const inPos = trackPosition(deck, into, beat) ?? 0;
  // (worked out again every few seconds as the record plays, so a suggestion that's gone by drops off)
  const bucket = Math.floor(toSeconds(outPos) / 4);
  const inMarks = marksOf(deck, inId);
  const suggestions = useMemo(
    () => (outA && inA ? suggestMixes({ out, outPos: secondsToBeats(bucket * 4), bpm: deck.bpm, outA, inA, inCues: inMarks }) : []),
    [outA, inA, out, bucket, deck.bpm, inMarks.join(",")],
  );

  const outRunning = deckRunning(deck, out, beat);
  const at = shownAt;
  const inAt = shownIn ?? inPos;
  const past = at !== null && outRunning && at < outPos;
  const blocked = !outId || !inId ? "Put a record on both decks" : running ? "A transition is under way" : at === null ? `Set where deck ${upper(out)} starts fading` : past ? `Deck ${upper(out)} is already past ${preciseClock(at)}` : null;
  const queue = (q: { at: number; inAt: number; style: MixStyle; bars: number }) => {
    if (!outId || !inId || running) return;
    // (one replaces the one queued)
    if (queued) partyCmd({ cmd: "unmix" });
    partyCmd({ cmd: "mix", style: q.style, bars: q.bars, at: q.at, inAt: q.inAt });
    setMixChoice({ mixStyle: q.style, mixBars: q.bars });
    setDraft({ at: null, inAt: null, key: pairKey });
  };
  const listen = (key: string, label: string, plan: PreviewPlan) => {
    if (preview?.key === key) return stopPreview();
    startPreview(key, label, engine, deck, plan, volume / 100);
  };
  const edit = (s: Suggestion) => {
    setDraft({ at: s.at, inAt: s.inAt, key: pairKey });
    setMixChoice({ mixStyle: s.style, mixBars: s.bars });
    setMode("points");
    setFocus(true);
    if (zoom < 4) setZoom(4);
  };

  return (
    <div className="dj-sound">
      <div className="dj-mixrow dj-sound-tools">
        <div className="dj-seg" role="radiogroup" aria-label="Clicking a waveform">
          <button role="radio" aria-checked={mode === "points"} className={`dj-segbtn ${mode === "points" ? "on" : ""}`} onClick={() => setMode("points")} title={`Click deck ${upper(out)} to set where it starts fading, deck ${upper(into)} for where it comes in`}>
            Set points
          </button>
          <button role="radio" aria-checked={mode === "seek"} className={`dj-segbtn ${mode === "seek" ? "on" : ""}`} onClick={() => setMode("seek")} title="Click or drag to move a deck to that place">
            Seek
          </button>
        </div>
        <div className="dj-seg" role="group" aria-label="Zoom">
          <button className="dj-segbtn" onClick={() => setZoom(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom as never) - 1)]!)} disabled={zoom <= 1} aria-label="Zoom out">
            −
          </button>
          <span className="dj-label dj-zoom">{zoom}×</span>
          <button className="dj-segbtn" onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom as never) + 1)]!)} disabled={zoom >= 64} aria-label="Zoom in">
            +
          </button>
        </div>
        <button className={`dj-chip ${focus ? "on" : ""}`} aria-pressed={focus} onClick={() => setFocus(!focus)} title="Centre the zoomed waveforms on the transition's points, not on where the decks are">
          {focus ? "On the points" : "Following"}
        </button>
        <span className="dj-note">Shift-click for off the beat</span>
      </div>

      {(["a", "b"] as const).map((side) => (
        <WaveLane
          key={side}
          deck={deck}
          side={side}
          role={side === out ? "out" : "into"}
          state={deck[side] ? analyses[deck[side]] : undefined}
          zoom={zoom}
          mode={mode}
          focus={focus}
          point={side === out ? shownAt : shownIn}
          queuedPoint={queued ? (side === out ? (queued.at ?? null) : (queued.inAt ?? null)) : null}
          span={span}
          setPoint={(p) => setPoints(side === out ? { at: p } : { inAt: p })}
        />
      ))}

      <div className="dj-mixrow dj-sound-edit" aria-label="Transition points">
        <PointBox label={`Fade ${upper(out)} at`} id={outId} value={points.at ?? queued?.at ?? null} onSet={(p) => setPoints({ at: p })} placeholder={preciseClock(outPos)} />
        <span aria-hidden>➜</span>
        <PointBox label={`Start ${upper(into)} at`} id={inId} value={points.inAt ?? queued?.inAt ?? null} onSet={(p) => setPoints({ inAt: p })} placeholder={preciseClock(inPos)} />
        <div className="dj-seg" role="radiogroup" aria-label="Transition style">
          {MIX_STYLES.map((m) => (
            <button key={m.id} role="radio" aria-checked={mixStyle === m.id} className={`dj-segbtn ${mixStyle === m.id ? "on" : ""}`} onClick={() => setMixChoice({ mixStyle: m.id })} title={m.hint}>
              {m.name}
            </button>
          ))}
        </div>
        <div className="dj-seg" role="radiogroup" aria-label="Transition length in bars">
          {MIX_BARS.map((n) => (
            <button key={n} role="radio" aria-checked={mixBars === n} className={`dj-segbtn ${mixBars === n ? "on" : ""}`} onClick={() => setMixChoice({ mixBars: n })}>
              {n}
            </button>
          ))}
          <span className="dj-label dj-seg-unit">bars</span>
        </div>
      </div>
      <div className="dj-mixrow dj-sound-go">
        <span className="dj-note dj-overlap">
          Overlap {barsText(mixBars)} · {((mixBars * 4 * 60) / deck.bpm).toFixed(1)} s at {deck.bpm} BPM
        </span>
        <button className={`dj-chip ${preview?.key === "cue" ? "on" : ""}`} disabled={!inId} onClick={() => listen("cue", `Deck ${upper(into)} from ${preciseClock(inAt)}`, { into, inAt })} title="Hear the incoming record from its start point, just you (the party plays on)">
          {preview?.key === "cue" ? "■ Stop" : `▶ Preview ${upper(into)} cue`}
        </button>
        <button
          className={`dj-chip ${preview?.key === "mix" ? "on" : ""}`}
          disabled={!outId || !inId || at === null}
          onClick={() => at !== null && listen("mix", `${styleName(mixStyle)} at ${preciseClock(at)}`, { into, inAt, at, style: mixStyle, bars: mixBars })}
          title="Hear the transition from a few seconds before it, just you"
        >
          {preview?.key === "mix" ? "■ Stop" : "▶ Preview transition"}
        </button>
        <button className="dj-chip on" disabled={Boolean(blocked)} onClick={() => at !== null && queue({ at, inAt, style: mixStyle, bars: mixBars })} title={blocked ?? "Queue it (it starts when the record gets there)"}>
          {queued && (points.at !== null || points.inAt !== null) ? "Replace queued" : queued ? "Queued ✓" : "Queue transition"}
        </button>
        {(points.at !== null || points.inAt !== null) && (
          <button className="dj-chip" onClick={() => setDraft({ at: null, inAt: null, key: pairKey })}>
            Clear
          </button>
        )}
      </div>
      {blocked && blocked !== "A transition is under way" && <p className="dj-note dj-mixhint">{blocked}</p>}
      {preview && <p className="dj-note dj-previewing">Previewing {preview.label}: only you hear it, and the party is turned down for you meanwhile.</p>}
      {queued && (
        <p className="dj-note">
          Queued: at <b>{preciseClock(queued.at ?? 0)}</b> on {upper(out)} ➜ {upper(into)} from <b>{preciseClock(queued.inAt ?? inPos)}</b> · {styleName(queued.style)} · {barsText(queued.beats / 4)}
        </p>
      )}

      <Suggestions deck={deck} out={out} into={into} outId={outId} inId={inId} outState={outId ? analyses[outId] : undefined} inState={inId ? analyses[inId] : undefined} list={suggestions} preview={preview?.key ?? null} disabled={Boolean(running)} onPreview={(s) => listen(s.id, s.text, { into, inAt: s.inAt, at: s.at, style: s.style, bars: s.bars })} onEdit={edit} onApply={(s) => queue(s)} />
    </div>
  );
}

/** A typed time for one of the transition's points. */
function PointBox({ label, id, value, onSet, placeholder }: { label: string; id: DeckTrackId | null; value: number | null; onSet: (p: number | null) => void; placeholder: string }) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? (value === null ? "" : preciseClock(value));
  const sec = text !== null && text.trim() ? parseClock(text) : null;
  const bad = text !== null && text.trim() !== "" && (sec === null || !id || secondsToBeats(sec) >= trackBeats(id));
  const commit = () => {
    if (text === null) return;
    if (!text.trim()) onSet(null);
    else if (!bad && sec !== null) onSet(secondsToBeats(sec));
    setText(null);
  };
  return (
    <label className="dj-pointbox">
      {label}
      <input
        value={shown}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setText(null);
        }}
        className={bad ? "bad" : ""}
        aria-invalid={bad}
        inputMode="decimal"
        disabled={!id}
      />
    </label>
  );
}

/** A record's analysis, as a line: its tempo and how sure, or how far it has got. */
function analysisText(id: DeckTrackId, state: AnalysisState | undefined): string {
  if (!state || state.status === "analyzing") return `Analyzing…${state?.status === "analyzing" && state.progress > 0.02 ? ` ${Math.round(state.progress * 100)}%` : ""}`;
  if (state.status === "error") return "Couldn't analyze (it still plays)";
  const a = state.analysis;
  if (!isRecording(id)) return `${DEFAULT_BPM} BPM · built-in`;
  return a.reliable ? `${a.bpm.toFixed(1)} BPM · beat grid` : `~${Math.round(a.bpm)} BPM · no steady grid`;
}

interface LaneProps {
  deck: Deck;
  side: DeckSide;
  role: "out" | "into";
  state: AnalysisState | undefined;
  zoom: number;
  mode: Mode;
  focus: boolean;
  point: number | null;
  queuedPoint: number | null;
  span: number;
  setPoint: (p: number | null) => void;
}

/** One deck's waveform. */
function WaveLane(props: LaneProps) {
  const { deck, side, role, state, mode, point } = props;
  const id = deck[side];
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef(props);
  latest.current = props;
  /** While dragging: the view, held still, and where the deck would go. */
  const drag = useRef<{ view: [number, number]; seek: number | null } | null>(null);
  const lastView = useRef<[number, number]>([0, 1]);

  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const p = latest.current;
      const id = p.deck[p.side];
      const w = cv.clientWidth;
      const h = cv.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
      }
      const g = cv.getContext("2d");
      if (!g || !w) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      if (!id) return;
      const len = trackBeats(id);
      const pos = drag.current?.seek ?? trackPosition(p.deck, p.side, deckBeat(p.deck, serverNow())) ?? 0;
      const view = drag.current?.view ?? viewOf(len, p.zoom, p.focus && p.point !== null ? p.point + (p.role === "out" ? p.span / 2 : 0) : pos);
      lastView.current = view;
      draw(g, w, h, {
        len,
        a: readyAnalysis(p.state),
        progress: p.state?.status === "analyzing" ? p.state.progress : null,
        view,
        pos,
        preview: previewPosition(p.side),
        color: deckTrack(id).color,
        cues: marksOf(p.deck, id),
        drop: dropCueOf(p.deck, p.side),
        point: p.point,
        queued: p.queuedPoint,
        role: p.role,
        span: p.span,
      });
    };
    frame();
    return () => cancelAnimationFrame(raf);
    // (an empty deck draws on another canvas)
  }, [Boolean(id)]);

  if (!id) {
    return (
      <div className={`dj-lane dj-${side} is-empty`}>
        <div className="dj-lane-head">
          <b>Deck {upper(side)}</b> <span>Empty: load a record on the Decks page</span>
        </div>
        <canvas ref={canvas} className="dj-wave" aria-hidden />
      </div>
    );
  }
  const len = trackBeats(id);
  const a = readyAnalysis(state);
  const at = (e: PointerEvent<HTMLCanvasElement>, view: [number, number]) => {
    const r = e.currentTarget.getBoundingClientRect();
    const b = view[0] + ((e.clientX - r.left) / r.width) * (view[1] - view[0]);
    return Math.max(0, Math.min(len - 0.01, e.shiftKey ? b : snap(a, b)));
  };
  const seek = (p: number) => partyCmd({ cmd: "cue", side, track: id, pos: p });
  const current = () => trackPosition(deck, side, deckBeat(deck, serverNow())) ?? 0;
  const key = (e: KeyboardEvent<HTMLCanvasElement>) => {
    const by = isRecording(id) ? secondsToBeats(e.shiftKey ? 1 : 10) : 4;
    const step = e.key === "ArrowRight" ? by : e.key === "ArrowLeft" ? -by : null;
    if (step === null) return;
    e.preventDefault();
    if (mode === "points") props.setPoint(Math.max(0, Math.min(len - 0.01, (point ?? current()) + step)));
    else seek(Math.max(0, Math.min(len - 0.01, current() + step)));
  };
  const t = deckTrack(id);
  return (
    <div className={`dj-lane dj-${side} ${role}`} style={{ "--c": t.color } as CSSProperties}>
      <div className="dj-lane-head">
        <b>Deck {upper(side)}</b>
        <span className="dj-lane-role">{role === "out" ? "On air · fades out" : "Comes in"}</span>
        <span className="dj-lane-name">{t.name}</span>
        <span className={`dj-lane-info ${state?.status ?? "analyzing"}`}>{analysisText(id, state)}</span>
        <LaneClock deck={deck} side={side} len={len} />
      </div>
      <canvas
        ref={canvas}
        className={`dj-wave mode-${mode}`}
        tabIndex={0}
        role="slider"
        aria-label={mode === "points" ? (role === "out" ? `Deck ${upper(side)}: where it starts fading out` : `Deck ${upper(side)}: where it comes in`) : `Deck ${upper(side)} position`}
        aria-valuemin={0}
        aria-valuemax={Math.round(toSeconds(len))}
        aria-valuenow={Math.round(toSeconds(mode === "points" ? (point ?? 0) : current()))}
        aria-valuetext={mode === "points" ? (point === null ? "not set" : preciseClock(point)) : preciseClock(current())}
        onKeyDown={key}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          const view = lastView.current;
          const p = at(e, view);
          drag.current = { view, seek: mode === "seek" ? p : null };
          if (mode === "points") props.setPoint(p);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
          const p = at(e, d.view);
          if (mode === "seek") d.seek = p;
          else props.setPoint(p);
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          if (d && mode === "seek") seek(at(e, d.view));
          drag.current = null;
        }}
        onLostPointerCapture={() => (drag.current = null)}
      />
      <div className="dj-lane-foot">
        {mode === "points" ? (
          <>
            <button className="dj-chip" onClick={() => props.setPoint(snap(a, current()))}>
              {role === "out" ? "Fade from here" : "Come in from here"}
            </button>
            {marksOf(deck, id).map((c) => (
              <button key={c} className="dj-chip dj-cue-chip" onClick={() => props.setPoint(c)} title={`Use the cue at ${preciseClock(c)}`}>
                ◆ {preciseClock(c)}
              </button>
            ))}
          </>
        ) : (
          <>
            <button className="dj-chip" onClick={() => partyCmd({ cmd: "mark", track: id, pos: current() })} title="Save where the deck is as a cue">
              Save cue
            </button>
            {marksOf(deck, id).map((c) => (
              <button key={c} className="dj-chip dj-cue-chip" onClick={() => seek(c)} title={`Jump to ${preciseClock(c)}`}>
                ◆ {preciseClock(c)}
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/** A deck's time, kept up to date a few times a second. */
function LaneClock({ deck, side, len }: { deck: Deck; side: DeckSide; len: number }) {
  const el = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const tick = () => {
      if (el.current) el.current.textContent = `${preciseClock(trackPosition(deck, side, deckBeat(deck, serverNow())) ?? 0)} / ${preciseClock(len)}`;
    };
    tick();
    const t = window.setInterval(tick, 100);
    return () => window.clearInterval(t);
  }, [deck, side, len]);
  return <span ref={el} className="dj-lane-clock" />;
}

/** The part of a record a waveform shows, centred on `center` where it can be. */
export function viewOf(len: number, zoom: number, center: number): [number, number] {
  const span = Math.max(4, len / zoom);
  if (span >= len) return [0, len];
  const from = Math.max(0, Math.min(len - span, center - span / 2));
  return [from, from + span];
}

/** The nearest beat to a place (track beats), when the record has a steady one. */
export function snap(a: Analysis | null, b: number): number {
  if (!a?.reliable) return b;
  const p = 60 / a.bpm;
  const s = toSeconds(b);
  const k = Math.round((s - a.beat) / p);
  const t = a.beat + k * p;
  return t < 0 ? b : Math.round(secondsToBeats(t) * 1000) / 1000;
}

interface DrawWhat {
  len: number;
  a: Analysis | null;
  progress: number | null;
  view: [number, number];
  pos: number;
  preview: number | null;
  color: string;
  cues: number[];
  drop: number | undefined;
  point: number | null;
  queued: number | null;
  role: "out" | "into";
  span: number;
}

const TICKS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200];

function clockLabel(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  const whole = Math.abs(r - Math.round(r)) < 1e-6;
  return `${m}:${(whole ? String(Math.round(r)) : r.toFixed(1)).padStart(whole ? 2 : 4, "0")}`;
}

function draw(g: CanvasRenderingContext2D, w: number, h: number, o: DrawWhat) {
  const [v0, v1] = o.view;
  const x = (b: number) => ((b - v0) / (v1 - v0)) * w;
  const mid = (h - 14) / 2;
  const top = 2;
  // the overlap
  if (o.point !== null) {
    const x0 = x(o.point);
    const x1 = x(o.point + o.span);
    g.fillStyle = o.role === "out" ? "rgba(255, 176, 46, 0.18)" : "rgba(141, 255, 58, 0.14)";
    g.fillRect(x0, 0, x1 - x0, h - 14);
  }
  // bars and phrases, when the beat is steady
  const a = o.a;
  if (a?.reliable) {
    const beatB = secondsToBeats(60 / a.bpm);
    const perBeat = w / ((v1 - v0) / beatB);
    if (perBeat * 4 > 5) {
      const first = Math.ceil((v0 - secondsToBeats(a.beat)) / beatB);
      const downK = Math.round((a.downbeat - a.beat) / (60 / a.bpm));
      for (let k = first; ; k++) {
        const b = secondsToBeats(a.beat) + k * beatB;
        if (b > v1) break;
        const n = (((k - downK) % 32) + 32) % 32;
        const bar = n % 4 === 0;
        if (!bar && perBeat < 10) continue;
        g.fillStyle = n === 0 ? "rgba(255,255,255,0.32)" : bar ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.06)";
        g.fillRect(Math.round(x(b)), top, 1, h - 14 - top);
      }
    }
  }
  // the waveform
  if (a && a.peaks.length) {
    const cols = a.peaks.length;
    const perPx = (toSeconds(v1 - v0) * 25) / w;
    g.globalAlpha = 1;
    for (let px = 0; px < w; px++) {
      const s0 = toSeconds(v0) * 25 + px * perPx;
      const c0 = Math.floor(s0);
      const c1 = Math.max(c0 + 1, Math.floor(s0 + perPx));
      let peak = 0;
      let low = 0;
      let n = 0;
      for (let c = Math.max(0, c0); c < Math.min(cols, c1); c++) {
        if (a.peaks[c]! > peak) peak = a.peaks[c]!;
        low += a.lows[c]!;
        n++;
      }
      if (!n) continue;
      const hh = (peak / 255) * (mid - 2);
      const bass = hh * Math.min(1, low / n / 255 + 0.15);
      const played = (v0 + ((px + 0.5) / w) * (v1 - v0)) < o.pos;
      g.globalAlpha = played ? 0.45 : 0.9;
      g.fillStyle = "rgba(243, 237, 224, 0.55)";
      g.fillRect(px, mid - hh, 1, hh * 2);
      g.fillStyle = o.color;
      g.fillRect(px, mid - bass, 1, bass * 2);
    }
    g.globalAlpha = 1;
  } else {
    g.fillStyle = "rgba(165, 159, 178, 0.35)";
    g.fillRect(0, mid, w, 1);
    g.fillStyle = "#a59fb2";
    g.font = "600 12px system-ui, sans-serif";
    g.fillText(`Analyzing…${o.progress && o.progress > 0.02 ? ` ${Math.round(o.progress * 100)}%` : ""} (it plays meanwhile)`, 10, mid - 6);
  }
  // times along the bottom
  const secs = toSeconds(v1 - v0);
  const step = TICKS.find((t) => (t / secs) * w >= 64) ?? 1200;
  g.font = "10px ui-monospace, monospace";
  g.fillStyle = "rgba(165, 159, 178, 0.9)";
  for (let t = Math.ceil(toSeconds(v0) / step) * step; t <= toSeconds(v1); t += step) {
    const px = x(secondsToBeats(t));
    g.fillRect(Math.round(px), h - 14, 1, 4);
    g.fillText(clockLabel(t), px + 2, h - 3);
  }
  // cues and the drop
  const marker = (b: number, color: string, label?: string) => {
    const px = Math.round(x(b));
    if (px < -40 || px > w + 40) return;
    g.fillStyle = color;
    g.fillRect(px, 0, 1, h - 14);
    g.beginPath();
    g.moveTo(px - 4, 0);
    g.lineTo(px + 4, 0);
    g.lineTo(px, 6);
    g.fill();
    if (label) {
      g.font = "700 10px system-ui, sans-serif";
      g.fillText(label, px + 3, 16);
    }
  };
  for (const c of o.cues) marker(c, "#ffd166");
  if (o.drop !== undefined) marker(o.drop, "#ff3d9a", "DROP");
  if (o.queued !== null && o.queued !== o.point) marker(o.queued, "rgba(24, 224, 232, 0.8)", "QUEUED");
  if (o.point !== null) {
    const px = Math.round(x(o.point));
    g.fillStyle = o.role === "out" ? "#ffb02e" : "#8dff3a";
    g.fillRect(px - 1, 0, 3, h - 14);
    g.font = "700 10px system-ui, sans-serif";
    const label = `${o.role === "out" ? "FADE" : "IN"} ${preciseClock(o.point)}`;
    g.fillText(label, Math.min(w - g.measureText(label).width - 2, px + 4), h - 18);
  }
  // the private preview, and where the deck is
  if (o.preview !== null) {
    g.fillStyle = "#18e0e8";
    const px = Math.round(x(o.preview));
    for (let y = 0; y < h - 14; y += 6) g.fillRect(px, y, 2, 3);
  }
  g.fillStyle = "#ffffff";
  g.fillRect(Math.round(x(o.pos)) - 1, 0, 2, h - 14);
}

/** The suggested transitions, each with Preview, Edit and Apply. */
function Suggestions({
  deck,
  out,
  into,
  outId,
  inId,
  outState,
  inState,
  list,
  preview,
  disabled,
  onPreview,
  onEdit,
  onApply,
}: {
  deck: Deck;
  out: DeckSide;
  into: DeckSide;
  outId: DeckTrackId | null;
  inId: DeckTrackId | null;
  outState: AnalysisState | undefined;
  inState: AnalysisState | undefined;
  list: Suggestion[];
  preview: string | null;
  disabled: boolean;
  onPreview: (s: Suggestion) => void;
  onEdit: (s: Suggestion) => void;
  onApply: (s: Suggestion) => void;
}) {
  const waiting = [outState, inState].some((s) => !s || s.status === "analyzing");
  const failed = [outState, inState].some((s) => s?.status === "error");
  return (
    <section className="dj-suggest" aria-label="Suggested mix">
      <h3 className="dj-label">
        Suggested mix: {upper(out)} ➜ {upper(into)}
      </h3>
      {!outId || !inId ? (
        <p className="dj-note">Load a record on both decks for suggestions.</p>
      ) : waiting ? (
        <p className="dj-note">Analyzing… suggestions appear when both records are done (they play as usual meanwhile).</p>
      ) : failed ? (
        <p className="dj-note">One of the records couldn't be analyzed, so there are no suggestions for it. You can still set the points by hand.</p>
      ) : !list.length ? (
        <p className="dj-note">Nothing left to suggest: deck {upper(out)} is too near its end. Move it back, or set the points by hand.</p>
      ) : (
        <ol className="dj-suggest-list">
          {list.map((s) => (
            <li key={s.id} className="dj-suggestion">
              <div className="dj-suggest-text">
                <b>{s.text}</b>
                {s.approximate && <span className="dj-approx">Approximate</span>}
                <small>{s.reason}</small>
              </div>
              <div className="dj-suggest-btns">
                <button className={`dj-chip ${preview === s.id ? "on" : ""}`} onClick={() => onPreview(s)} title="Hear it, just you">
                  {preview === s.id ? "■ Stop" : "▶ Preview"}
                </button>
                <button className="dj-chip" onClick={() => onEdit(s)} title="Put it on the waveforms to adjust">
                  Edit
                </button>
                <button className="dj-chip on" onClick={() => onApply(s)} disabled={disabled || (deckRunning(deck, out, deckBeat(deck, serverNow())) && s.at < (trackPosition(deck, out, deckBeat(deck, serverNow())) ?? 0))} title="Queue it (it doesn't start until the record gets there)">
                  Apply
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
