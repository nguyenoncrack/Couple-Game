import {
  deckBeat,
  deckRunning,
  deckTrack,
  defaultHandover,
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
  type SetStep,
} from "@cg/shared";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { serverNow } from "../../../../state/game";
import { BUILT_IN_PRESETS, usePartyUi, type SavedSet } from "../../partyUi";
import { suggestMixes, type Suggestion } from "../analysis/suggest";
import { readyAnalysis, useAnalysis } from "../analysis/trackAnalysis";
import type { DeckEngine } from "../deckEngine";
import { beatsToSeconds, parseClock, preciseClock, secondsToBeats } from "../deckTime";
import { startPreview, stopPreview, usePreview, type PreviewPlan } from "../preview";
import { SetList } from "./SetList";
import { addSongs, autoLinks, linkProblem, liveList, moveSong, onAirSide, pairKey, removeSong, safeSeek, sameSteps, type EditContext } from "./setPlan";
import { TrackLane } from "./TrackLane";
import { draftKey, flagForReview, markReviewed, say, sendTracked, setDraft, setPanel, useWorkspace, type Draft } from "./workspaceStore";

/**
 * The DJ booth's one screen. Along the top, what everyone hears: the record on air, what's up next and when it mixes
 * in, and Play. Beside it the set list (see `SetList`). In the middle, the transition you're working on, as two
 * waveforms with its points on them, the controls you use most, and suggested transitions for that pair. Live
 * controls change the music for everyone; rehearsals (Cue, Preview) are only for you. Sound FX and exact timing open
 * in a small panel beside it, which keeps your place when it closes.
 */

const styleName = (style: MixStyle) => MIX_STYLES.find((m) => m.id === style)?.name ?? style;
const barsText = (bars: number) => `${bars} bar${bars === 1 ? "" : "s"}`;
/** Four bars back, for Rewind. */
const REWIND_BEATS = 16;

interface Props {
  deck: Deck;
  beat: number;
  engine: DeckEngine;
  /** The mixer and each deck's channel, for the Sound FX panel. */
  fx: ReactNode;
}

export function Workspace({ deck, beat, engine, fx }: Props) {
  const analyses = useAnalysis();
  const analysis = (id: DeckTrackId) => readyAnalysis(analyses[id]);
  const volume = usePartyUi((s) => s.volume);
  const ws = useWorkspace(useShallow((s) => ({ pair: s.pair, selected: s.selected, draft: s.draft, panel: s.panel, zoom: s.zoom, onPoints: s.onPoints })));
  const preview = usePreview((s) => s.on);
  // a rehearsal stops when you leave the decks
  useEffect(() => stopPreview, []);

  const list = liveList(deck, beat);
  const { steps, onAir } = list;
  const side = onAirSide(deck, beat);
  const free = otherSide(side);
  const onAirPos = onAir !== null ? trackPosition(deck, side, beat) : null;
  const live = deck.mix && !mixDone(deck.mix, beat) ? deck.mix : null;
  const mixing = Boolean(live && !mixQueued(live, beat));
  const queued = live && mixQueued(live, beat) ? live : null;
  const n = steps.length;
  const pair = n >= 2 ? Math.min(ws.pair, n - 2) : 0;
  const selected = Math.min(ws.selected, Math.max(0, n - 1));
  const ctx: EditContext = { bpm: deck.bpm, analysis, onAir, onAirPos };
  const sent = deck;

  /** Put a changed list on the decks: around the record on air, or (with nothing on) paused at its first song. */
  const commit = (next: SetStep[], nextOnAir: number | null, text: { pending: string; done: string; failed: string }, then?: () => void) => {
    if (onAir === null || nextOnAir === null) {
      sendTracked({ cmd: "setload", set: { name: deck.set?.name ?? "", steps: next } }, text, (d) => sameSteps(d.set?.steps, next), then);
      return;
    }
    const here = next[nextOnAir]!;
    const problem = next[nextOnAir + 1] ? linkProblem(here, onAirPos ?? here.from) : null;
    if (problem) {
      say(`${text.failed}: the transition out of track ${nextOnAir + 1} (on air) has ${problem}. Pick a later time.`, "failed");
      return;
    }
    sendTracked({ cmd: "setedit", steps: next, step: nextOnAir, was: list.was }, text, (d) => sameSteps(d.set?.steps, next), then);
  };

  const add = (ids: DeckTrackId[]) => {
    const e = addSongs(steps, ids, ctx);
    const added = e.steps.length - n;
    const what = added === 1 ? deckTrack(ids[0]!).name : `${added} songs`;
    const where = added === 1 ? `track ${n + 1}` : `tracks ${n + 1}–${n + added}`;
    commit(e.steps, e.onAir, { pending: `Adding ${what}…`, done: `Added ${what} as ${where}`, failed: `Couldn't add ${what}` });
  };
  const move = (i: number, by: -1 | 1) => {
    const e = moveSong(steps, i, by, ctx);
    const keys = e.relinked.map((k) => pairKey(e.steps, k)).filter((k): k is string => Boolean(k));
    const name = deckTrack(steps[i]!.track).name;
    commit(
      e.steps,
      e.onAir,
      { pending: `Moving ${name}…`, done: `Moved ${name} to track ${i + by + 1}. ${keys.length} transition${keys.length === 1 ? "" : "s"} changed: check ${keys.length === 1 ? "it" : "them"} before ${keys.length === 1 ? "it plays" : "they play"}`, failed: `Couldn't move ${name}` },
      () => {
        flagForReview(keys);
        if (selected === i) useWorkspace.setState({ selected: i + by });
      },
    );
  };
  const remove = (i: number) => {
    const e = removeSong(steps, i, ctx);
    const keys = e.relinked.map((k) => pairKey(e.steps, k)).filter((k): k is string => Boolean(k));
    const name = deckTrack(steps[i]!.track).name;
    commit(e.steps, e.onAir, { pending: `Taking out ${name}…`, done: `Took out ${name}.${keys.length ? ` Track ${i} now goes straight into track ${i + 1}: check that transition` : ""}`, failed: `Couldn't take out ${name}` }, () => flagForReview(keys));
  };
  const auto = (i: number | null) => {
    const e = autoLinks(steps, i, ctx);
    if (!e.relinked.length) return say(i === null ? "No transitions to work out" : `Couldn't work out the ${i + 1} → ${i + 2} transition`, "failed");
    const keys = e.relinked.map((k) => pairKey(e.steps, k)).filter((k): k is string => Boolean(k));
    const what = i === null ? `${e.relinked.length} transition${e.relinked.length === 1 ? "" : "s"}` : `the ${i + 1} → ${i + 2} transition`;
    commit(e.steps, e.onAir, { pending: `Working out ${what}…`, done: `Worked out ${what} from the songs' beats and energy`, failed: `Couldn't change ${what}` }, () => {
      for (const k of keys) markReviewed(k);
      const d = useWorkspace.getState().draft;
      if (d && e.relinked.some((k) => d.key.startsWith(`${k}:`))) setDraft(null);
    });
  };
  const jump = (i: number) => {
    const step = steps[i];
    if (!step) return;
    const after = steps[i + 1];
    const done = `Track ${i + 1} is live${deck.playing ? "" : " (paused: press Play)"}.${after ? ` Up next: track ${i + 2} from ${preciseClock(after.from)}` : ""}`;
    const text = { pending: `Moving everyone to track ${i + 1}…`, done, failed: `Couldn't jump to track ${i + 1}` };
    const landed = (d: Deck) => d !== sent && d.set?.step === i && d[onAirSide(d, deckBeat(d, serverNow()))] === step.track;
    if (list.shared) sendTracked({ cmd: "setjump", step: i, track: step.track }, text, landed);
    else sendTracked({ cmd: "setload", set: { name: "", steps }, step: i, playing: deck.playing ? true : undefined }, text, landed);
  };
  const loadSaved = (set: SavedSet, play: boolean) =>
    sendTracked(
      { cmd: "setload", set: { name: set.name, steps: set.steps }, playing: play ? true : undefined },
      { pending: `Loading “${set.name}”…`, done: play ? `Playing “${set.name}” from the top` : `“${set.name}” is on the decks, paused at its first song`, failed: `Couldn't load “${set.name}”` },
      (d) => sameSteps(d.set?.steps, set.steps),
      () => useWorkspace.setState({ pair: 0, selected: 0, draft: null }),
    );

  // the pair being worked on, and its transition: unsaved changes, or what's saved
  const outStep = steps[pair];
  const inStep = steps[pair + 1];
  const dk = outStep && inStep ? draftKey(pair, outStep.track, inStep.track) : null;
  const draft = ws.draft && ws.draft.key === dk ? ws.draft : null;
  const saved = outStep && inStep ? (outStep.next ?? defaultHandover(outStep.track, outStep.from)) : null;
  const cur: Omit<Draft, "key"> | null = draft ?? (saved && inStep ? { at: saved.at, inAt: inStep.from, style: saved.style, bars: saved.bars, pick: null } : null);
  const update = (patch: Partial<Draft>) => {
    if (!cur || !dk) return;
    setDraft({ key: dk, at: cur.at, inAt: cur.inAt, style: cur.style, bars: cur.bars, pick: cur.pick, ...patch });
  };
  const pairLive = pair === onAir;
  /** The incoming record already on air: where it came in is history. */
  const inFixed = pair + 1 === onAir;
  const outFrom = pairLive ? (onAirPos ?? outStep?.from ?? 0) : (outStep?.from ?? 0);
  const problem = outStep && cur ? linkProblem({ ...outStep, next: { at: cur.at, style: cur.style, bars: cur.bars } }, outFrom) : null;
  const pairMixing = pairLive && mixing;

  const save = () => {
    if (!cur || !outStep || !inStep) return;
    const at = cur.at;
    const inAt = inFixed ? inStep.from : cur.inAt;
    const next = steps.map((s, i) => (i === pair ? { ...s, next: { at, style: cur.style, bars: cur.bars } } : i === pair + 1 ? { ...s, from: inAt } : s));
    const key = pairKey(steps, pair);
    commit(
      next,
      onAir,
      { pending: `Saving the ${pair + 1} → ${pair + 2} transition…`, done: `Saved: track ${pair + 1} fades at ${preciseClock(at)}, track ${pair + 2} starts at ${preciseClock(inAt)}`, failed: `Didn't save the ${pair + 1} → ${pair + 2} transition` },
      () => {
        setDraft(null);
        markReviewed(key);
      },
    );
  };

  // suggestions for the pair (worked out again every few seconds while its first record is the live one)
  const outA = outStep ? analysis(outStep.track) : null;
  const inA = inStep ? analysis(inStep.track) : null;
  const bucket = Math.floor(beatsToSeconds(outFrom) / 4);
  const inCues = inStep ? marksOf(deck, inStep.track) : [];
  const suggestions = useMemo(
    () => (outA && inA ? suggestMixes({ out: "a", outPos: secondsToBeats(bucket * 4), bpm: deck.bpm, outA, inA, inCues, names: { out: `Track ${pair + 1}`, into: `Track ${pair + 2}` } }) : []),
    [outA, inA, bucket, deck.bpm, inCues.join(","), pair],
  );

  // rehearsals: only you hear them
  const rehearse = (key: string, label: string, plan: PreviewPlan, again = false) => {
    if (!again && preview?.key === key) return stopPreview();
    startPreview(key, label, engine, deck, plan, volume / 100);
  };
  const mixPlan = (c: Pick<Draft, "at" | "inAt" | "style" | "bars">): PreviewPlan | null => (outStep && inStep ? { out: outStep.track, into: inStep.track, at: c.at, inAt: inFixed ? inStep.from : c.inAt, style: c.style, bars: c.bars } : null);
  const previewMix = (again = false, c = cur) => {
    const plan = c && mixPlan(c);
    if (plan) rehearse(`mix-${pair}`, `track ${pair + 1} → ${pair + 2}`, plan, again);
  };
  const cueRow = selected === pair || selected === pair + 1 ? selected : pair + 1;
  const cueStep = steps[cueRow];
  const cueFrom = cueRow === pair + 1 && cur && !inFixed ? cur.inAt : (cueStep?.from ?? 0);
  const cue = () => cueStep && rehearse(`cue-${cueRow}`, `track ${cueRow + 1} from ${preciseClock(cueFrom)}`, { into: cueStep.track, inAt: cueFrom });
  const rewindPreview = () => {
    if (preview?.key.startsWith("cue")) cue();
    else previewMix(true);
  };
  const rehearsing = Boolean(preview);

  // live controls: everyone hears them
  const onAirId = deck[side];
  const togglePlay = () => {
    const want = !deck.playing;
    sendTracked({ cmd: "deck", set: { playing: want } }, { pending: want ? "Starting the music…" : "Pausing…", done: want ? `Playing${onAir !== null ? ` track ${onAir + 1}` : ""} for everyone` : "Paused for everyone", failed: "The deck didn't respond" }, (d) => d.playing === want);
  };
  const rewind = () => {
    if (!onAirId || onAirPos === null || onAir === null) return;
    const to = Math.max(0, onAirPos - REWIND_BEATS);
    sendTracked({ cmd: "cue", side, track: onAirId, pos: to }, { pending: "Rewinding…", done: `Track ${onAir + 1} went back to ${preciseClock(to)} for everyone`, failed: "Couldn't rewind" }, (d) => d !== sent && (trackPosition(d, side, deckBeat(d, serverNow())) ?? Infinity) < onAirPos - 4);
  };
  const canMixNow = Boolean(queued) || (!live && deck.playing && Boolean(deck[free]));
  const mixNow = () => {
    const label = onAir !== null && steps[onAir + 1] ? `track ${onAir + 1} → ${onAir + 2}` : "to the other deck";
    const text = { pending: "Starting the transition…", done: `Mixing ${label} now`, failed: "The transition didn't start" };
    const started = (d: Deck) => d !== sent && (!d.mix || !mixQueued(d.mix, deckBeat(d, serverNow())));
    if (queued) sendTracked({ cmd: "mixnow" }, text, started);
    else sendTracked({ cmd: "mix", style: steps[onAir ?? 0]?.next?.style ?? "blend", bars: steps[onAir ?? 0]?.next?.bars ?? 8 }, text, (d) => d !== sent && Boolean(d.mix));
  };

  const laneLive = (i: number, id: DeckTrackId): (() => number | null) | null => {
    const at = (s: DeckSide) => () => trackPosition(deck, s, deckBeat(deck, serverNow()));
    if (i === onAir) return at(side);
    // the record up next is parked on the other deck: it's only live once its transition has started
    if (onAir !== null && i === onAir + 1 && deck[free] === id)
      return () => {
        const b = deckBeat(deck, serverNow());
        return deck.mix && !mixQueued(deck.mix, b) ? trackPosition(deck, free, b) : null;
      };
    return null;
  };

  return (
    <div className={`dj-work ${ws.panel ? "has-panel" : ""}`}>
      <LiveStrip deck={deck} beat={beat} steps={steps} onAir={onAir} onAirPos={onAirPos} side={side} onPlay={togglePlay} rehearsing={rehearsing} />

      <section className="dj-pair" aria-label="The transition you're working on">
        {n >= 2 && outStep && inStep && cur ? (
          <>
            <header className="dj-pair-head">
              <h3>
                Transition: track {pair + 1} → {pair + 2}
              </h3>
              {pairLive && <span className="dj-badge air">{pairMixing ? "Mixing now" : "Next live transition"}</span>}
              {draft && <span className="dj-badge">Unsaved</span>}
            </header>
            <TrackLane
              id={outStep.track}
              num={pair + 1}
              role="out"
              selected={selected === pair}
              state={analyses[outStep.track]}
              zoom={ws.zoom}
              onPoints={ws.onPoints}
              point={cur.at}
              saved={outStep.next?.at ?? null}
              span={cur.bars * 4}
              live={laneLive(pair, outStep.track)}
              cues={marksOf(deck, outStep.track)}
              setPoint={(p) => update({ at: p })}
              onSelect={() => useWorkspace.setState({ selected: pair })}
            />
            <TrackLane
              id={inStep.track}
              num={pair + 2}
              role="into"
              selected={selected === pair + 1}
              state={analyses[inStep.track]}
              zoom={ws.zoom}
              onPoints={ws.onPoints}
              point={inFixed ? inStep.from : cur.inAt}
              saved={inStep.from}
              span={cur.bars * 4}
              live={laneLive(pair + 1, inStep.track)}
              cues={marksOf(deck, inStep.track)}
              setPoint={(p) => !inFixed && update({ inAt: p })}
              onSelect={() => useWorkspace.setState({ selected: pair + 1 })}
            />
            <div className="dj-points" aria-label="The transition's points">
              <span className="dj-point out">
                Track {pair + 1} fades at <b>{preciseClock(cur.at)}</b>
              </span>
              <span className="dj-point in">
                Track {pair + 2} starts at <b>{preciseClock(inFixed ? inStep.from : cur.inAt)}</b>
              </span>
              <span className="dj-point">
                {styleName(cur.style)} · {barsText(cur.bars)} ({((cur.bars * 4 * 60) / deck.bpm).toFixed(1)} s)
              </span>
              {problem && <span className="dj-badge bad">Fades {problem === "already gone by" ? "before the record gets there" : problem}</span>}
              <span className="dj-points-btns">
                <button className="dj-chip on" onClick={save} disabled={!draft || Boolean(problem) || pairMixing} title={pairMixing ? "This transition is under way" : draft ? "Save it into the set (it plays like this from now on)" : "Nothing changed yet"}>
                  Save transition
                </button>
                {draft && (
                  <button className="dj-chip" onClick={() => (setDraft(null), say(`Put the ${pair + 1} → ${pair + 2} transition back as it was saved`))}>
                    Discard
                  </button>
                )}
              </span>
            </div>
          </>
        ) : (
          <p className="dj-note dj-pair-empty">{n === 1 ? "Add a song after track 1 to work on a transition." : "Add songs to the set to start."}</p>
        )}

        <div className="dj-controls">
          <div className="dj-ctlgroup live" role="group" aria-label="Live controls: everyone hears these">
            <span className="dj-ctllabel">Live · everyone hears</span>
            <button className={`dj-pad dj-play ${deck.playing ? "on" : ""}`} onClick={togglePlay} disabled={onAir === null && !deck.playing} aria-pressed={deck.playing}>
              <span aria-hidden>{deck.playing ? "❚❚" : "▶"}</span> {deck.playing ? "Pause" : "Play"}
            </button>
            <button className="dj-pad" onClick={rewind} disabled={onAir === null} title="Back 4 bars on the record on air (everyone hears it)">
              <span aria-hidden>⏪</span> Rewind
            </button>
            <button className="dj-pad dj-mixnow" onClick={mixNow} disabled={!canMixNow} title={queued ? "Start the queued transition now, on the next beat" : canMixNow ? "Mix to the other deck now" : "Nothing to mix to: add a song after the one on air"}>
              <span aria-hidden>⏭</span> Mix now
            </button>
          </div>
          <div className="dj-ctlgroup private" role="group" aria-label="Rehearsal: only you hear this">
            <span className="dj-ctllabel">Only you hear this</span>
            <button className={`dj-pad ${preview?.key.startsWith("cue") ? "on" : ""}`} onClick={cue} disabled={!cueStep} title={cueStep ? `Hear track ${cueRow + 1} from ${preciseClock(cueFrom)}, just you` : undefined}>
              <span aria-hidden>🎧</span> {preview?.key.startsWith("cue") ? "Stop" : cueStep ? `Cue ${cueRow + 1}` : "Cue"}
            </button>
            <button className={`dj-pad ${preview?.key.startsWith("mix") ? "on" : ""}`} onClick={() => previewMix()} disabled={!cur} title="Hear this transition from a few seconds before it, just you">
              <span aria-hidden>🎧</span> {preview?.key.startsWith("mix") ? "Stop" : "Preview mix"}
            </button>
          </div>
          <div className="dj-ctlgroup" role="group" aria-label="Panels">
            <button className={`dj-chip ${ws.panel === "fx" ? "on" : ""}`} onClick={() => setPanel("fx")} aria-expanded={ws.panel === "fx"}>
              Sound FX
            </button>
            <button className={`dj-chip ${ws.panel === "timing" ? "on" : ""}`} onClick={() => setPanel("timing")} aria-expanded={ws.panel === "timing"} disabled={!cur}>
              Adjust timing
            </button>
          </div>
        </div>
        <StatusLine />
        {preview && (
          <p className="dj-note dj-previewing" role="status">
            🎧 Only you hear this: rehearsing {preview.label}. {onAir !== null ? `Everyone else hears track ${onAir + 1}, ${deckTrack(steps[onAir]!.track).name}${deck.playing ? "" : " (paused)"}.` : ""}
          </p>
        )}
      </section>

      <SetList list={list} onAirPos={onAirPos} mixing={mixing} name={deck.set?.name ?? null} onAdd={add} onMove={move} onRemove={remove} onJump={jump} onLoad={loadSaved} onAuto={auto} />

      {n >= 2 && outStep && inStep && cur && (
        <Suggestions
          pair={pair}
          list={suggestions}
          waiting={!outA || !inA}
          failed={[analyses[outStep.track], analyses[inStep.track]].some((s) => s?.status === "error")}
          picked={cur.pick}
          previewKey={preview?.key ?? null}
          outFrom={outFrom}
          onPick={(s) => update({ at: s.at, inAt: inFixed ? inStep.from : s.inAt, style: s.style, bars: s.bars, pick: s.id })}
          onPreview={(s) => previewMix(false, { at: s.at, inAt: s.inAt, style: s.style, bars: s.bars, pick: s.id })}
          onRewind={rewindPreview}
          onTiming={() => useWorkspace.setState({ panel: "timing" })}
          onSave={save}
          canSave={Boolean(draft) && !problem && !pairMixing}
        />
      )}

      {ws.panel && (
        <aside className="dj-panel" aria-label={ws.panel === "fx" ? "Sound FX" : "Adjust timing"}>
          <header className="dj-panel-head">
            <h3>{ws.panel === "fx" ? "Sound FX" : `Timing: track ${pair + 1} → ${pair + 2}`}</h3>
            <span className="dj-note">{ws.panel === "fx" ? "Live · everyone hears" : "Saved when you press Save transition"}</span>
            <button className="dj-chip" onClick={() => useWorkspace.setState({ panel: null })} aria-label="Close the panel">
              ×
            </button>
          </header>
          {ws.panel === "fx" ? fx : cur && outStep && inStep ? <TimingPanel cur={cur} out={outStep.track} into={inStep.track} pair={pair} inFixed={inFixed} update={update} deck={deck} side={side} onAir={onAir} onAirPos={onAirPos} /> : null}
        </aside>
      )}
    </div>
  );
}

/** What everyone hears: the record on air, where it is, what's up next and when, and Play. */
function LiveStrip({ deck, beat, steps, onAir, onAirPos, side, onPlay, rehearsing }: { deck: Deck; beat: number; steps: SetStep[]; onAir: number | null; onAirPos: number | null; side: DeckSide; onPlay: () => void; rehearsing: boolean }) {
  const now = onAir !== null ? steps[onAir] : null;
  const next = onAir !== null ? steps[onAir + 1] : null;
  const m = deck.mix && !mixDone(deck.mix, beat) ? deck.mix : null;
  const running = now && deckRunning(deck, side, beat);
  let when = "";
  if (m && next) {
    if (!mixQueued(m, beat)) when = `mixing in now · bar ${Math.min(m.beats / 4, Math.floor((beat - m.start!) / 4) + 1)} of ${m.beats / 4}`;
    else if (m.start === null) when = `mixes in at ${preciseClock(m.at ?? 0)} (waiting: the record is paused)`;
    else {
      const sec = Math.max(0, ((m.start - beat) * 60) / deck.bpm);
      when = `mixes in at ${preciseClock(m.at ?? 0)} · in ${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}${deck.playing ? "" : " once playing"}`;
    }
  } else if (next) when = "no transition queued";
  return (
    <section className={`dj-livebar ${rehearsing ? "is-rehearsing" : ""}`} aria-label="Live: everyone hears this">
      <span className="dj-ctllabel">
        <span className="dj-live-dot" aria-hidden /> Live · everyone hears this
      </span>
      <div className="dj-live-now">
        {now ? (
          <>
            <span className="dj-row-tag air">On air</span>
            <b>
              Track {onAir! + 1} · {deckTrack(now.track).name}
            </b>
            <span className="dj-live-clock">
              {preciseClock(onAirPos ?? 0)} / {preciseClock(trackBeats(now.track))}
              {!deck.playing ? " · paused" : !running ? " · held" : ""}
            </span>
          </>
        ) : (
          <span className="dj-note">Nothing on the decks</span>
        )}
      </div>
      {next && (
        <div className="dj-live-next">
          <span className="dj-row-tag next">Up next</span>
          <span>
            Track {onAir! + 2} · {deckTrack(next.track).name}
          </span>
          <small>{when}</small>
        </div>
      )}
      <button className={`dj-pad dj-play dj-live-play ${deck.playing ? "on" : ""}`} onClick={onPlay} disabled={!now && !deck.playing} aria-pressed={deck.playing} aria-label={deck.playing ? "Pause for everyone" : "Play for everyone"}>
        <span aria-hidden>{deck.playing ? "❚❚" : "▶"}</span>
      </button>
      {now && deck[side] === now.track ? (
        <SongSlider deck={deck} side={side} track={now.track} num={onAir! + 1} pos={onAirPos} fadeAt={m && next && mixQueued(m, beat) ? (m.at ?? null) : null} />
      ) : (
        <div className="dj-live-progress" aria-hidden>
          <i />
        </div>
      )}
    </section>
  );
}

/**
 * Move through the song on air, for everyone: drag the slider (it shows where you'll land) and let go, or step back
 * and forward 10 seconds (a bar on a built-in record). A tick marks where the next transition starts; a jump stops a
 * bar short of it, so the rest of the set stays (Mix now goes on to the next song).
 */
function SongSlider({ deck, side, track, num, pos, fadeAt }: { deck: Deck; side: DeckSide; track: DeckTrackId; num: number; pos: number | null; fadeAt: number | null }) {
  const [drag, setDrag] = useState<number | null>(null);
  const len = trackBeats(track);
  const rec = isRecording(track);
  const by = rec ? secondsToBeats(10) : 4;
  const shown = drag ?? pos ?? 0;
  const go = (to: number) => {
    const want = Math.max(0, Math.min(len - 0.01, to));
    const safe = safeSeek(deck, side, want, deckBeat(deck, serverNow()));
    const short = safe < want - 0.01;
    sendTracked(
      { cmd: "cue", side, track, pos: safe },
      {
        pending: `Moving track ${num} to ${preciseClock(safe)}…`,
        done: short ? `Track ${num} went to ${preciseClock(safe)}, just before its transition (Mix now goes on to the next song)` : `Track ${num} went to ${preciseClock(safe)} for everyone`,
        failed: "The song didn't move",
      },
      (d) => Math.abs((trackPosition(d, side, deckBeat(d, serverNow())) ?? -1e9) - safe) < 6,
    );
  };
  const letGo = () => {
    if (drag !== null) go(drag);
    setDrag(null);
  };
  return (
    <div className="dj-live-seek">
      <button className="dj-chip" onClick={() => go((pos ?? 0) - by)} aria-label={`Back ${rec ? "10 seconds" : "a bar"} on track ${num}`}>
        {rec ? "−10 s" : "−1 bar"}
      </button>
      <span className="dj-live-seekbar" style={{ "--k": (shown / len).toFixed(4) } as CSSProperties}>
        <input
          type="range"
          min={0}
          max={len}
          step={rec ? 0.25 : 4}
          value={shown}
          onChange={(e) => setDrag(Number(e.target.value))}
          onPointerUp={letGo}
          onKeyUp={letGo}
          onBlur={() => setDrag(null)}
          aria-label={`Move through track ${num} (everyone hears it)`}
          aria-valuetext={preciseClock(shown)}
        />
        {fadeAt !== null && <i className="dj-live-seekmark" style={{ left: `${(fadeAt / len) * 100}%` }} title={`The next transition starts at ${preciseClock(fadeAt)}`} />}
      </span>
      <button className="dj-chip" onClick={() => go((pos ?? 0) + by)} aria-label={`Forward ${rec ? "10 seconds" : "a bar"} on track ${num}`}>
        {rec ? "+10 s" : "+1 bar"}
      </button>
      <span className="dj-live-seektime">{drag !== null ? `Go to ${preciseClock(drag)}` : `${preciseClock(shown)} / ${preciseClock(len)}`}</span>
    </div>
  );
}

/** How the last command went: on its way, done, or not. */
function StatusLine() {
  const status = useWorkspace((s) => s.status);
  if (!status) return null;
  const icon = status.state === "pending" ? "…" : status.state === "done" ? "✓" : "✕";
  return (
    <p className={`dj-status ${status.state}`} role="status" aria-live="polite">
      <span aria-hidden>{icon}</span> {status.text}
    </p>
  );
}

function Suggestions(props: {
  pair: number;
  list: Suggestion[];
  waiting: boolean;
  failed: boolean;
  picked: string | null;
  previewKey: string | null;
  outFrom: number;
  onPick: (s: Suggestion) => void;
  onPreview: (s: Suggestion) => void;
  onRewind: () => void;
  onTiming: () => void;
  onSave: () => void;
  canSave: boolean;
}) {
  const { pair, list, picked } = props;
  return (
    <section className="dj-suggest" aria-label="Suggested transitions">
      <h3 className="dj-label">
        Suggestions: track {pair + 1} → {pair + 2}
      </h3>
      {props.failed ? (
        <p className="dj-note">One of the records couldn't be analyzed, so there are no suggestions. You can still set the points on the waveforms.</p>
      ) : props.waiting ? (
        <p className="dj-note">Analyzing… suggestions appear when both records are done (they play as usual meanwhile).</p>
      ) : !list.length ? (
        <p className="dj-note">Nothing left to suggest: track {pair + 1} is too near its end. Set the points on the waveforms instead.</p>
      ) : (
        <ol className="dj-suggest-list">
          {list.map((s) => {
            const on = picked === s.id;
            const playing = props.previewKey === `mix-${pair}`;
            return (
              <li key={s.id} className={`dj-suggestion ${on ? "is-picked" : ""}`}>
                <div className="dj-suggest-text">
                  <b>{s.text}</b>
                  {s.approximate && <span className="dj-approx">Approximate</span>}
                  <small>{s.reason}</small>
                </div>
                {on ? (
                  <div className="dj-suggest-btns">
                    <button className={`dj-chip ${playing ? "on" : ""}`} onClick={() => props.onPreview(s)} title="Only you hear this">
                      {playing ? "■ Stop" : "🎧 Preview"}
                    </button>
                    <button className="dj-chip" onClick={props.onRewind} title="Play the preview again from a few seconds before the transition (only you)">
                      ⟲ Rewind preview
                    </button>
                    <button className="dj-chip" onClick={props.onTiming} title="Fine-tune the points, style and length">
                      Adjust timing
                    </button>
                    <button className="dj-chip on" onClick={props.onSave} disabled={!props.canSave}>
                      Save transition
                    </button>
                  </div>
                ) : (
                  <div className="dj-suggest-btns">
                    <button className="dj-chip" onClick={() => props.onPick(s)} disabled={s.at <= props.outFrom} title="Put its points on the waveforms">
                      Pick
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/** Exact timing for the pair: typed times and nudges for both points, the style and length, and the view. */
function TimingPanel({
  cur,
  out,
  into,
  pair,
  inFixed,
  update,
  deck,
  side,
  onAir,
  onAirPos,
}: {
  cur: Omit<Draft, "key">;
  out: DeckTrackId;
  into: DeckTrackId;
  pair: number;
  inFixed: boolean;
  update: (patch: Partial<Draft>) => void;
  deck: Deck;
  side: DeckSide;
  onAir: number | null;
  onAirPos: number | null;
}) {
  const presets = usePartyUi((s) => s.presets);
  const { zoom, onPoints } = useWorkspace(useShallow((s) => ({ zoom: s.zoom, onPoints: s.onPoints })));
  const clamp = (id: DeckTrackId, p: number) => Math.max(0, Math.min(trackBeats(id) - 0.01, p));
  const nudges = (id: DeckTrackId, value: number, set: (v: number) => void, label: string) => (
    <span className="dj-nudges" role="group" aria-label={`Nudge ${label}`}>
      {[-4, -1, 1, 4].map((by) => (
        <button key={by} className="dj-chip" onClick={() => set(clamp(id, value + by))} aria-label={`${label} ${by > 0 ? "later" : "earlier"} by ${Math.abs(by) === 4 ? "a bar" : "a beat"}`}>
          {by < 0 ? "−" : "+"}
          {Math.abs(by) === 4 ? "bar" : "beat"}
        </button>
      ))}
    </span>
  );
  const zooms = [1, 2, 4, 8, 16, 32, 64];
  return (
    <div className="dj-timing">
      <div className="dj-timing-row">
        <TimeBox label={`Track ${pair + 1} fades at`} id={out} value={cur.at} onSet={(v) => update({ at: v })} />
        {nudges(out, cur.at, (v) => update({ at: v }), `track ${pair + 1}'s fade`)}
      </div>
      <div className="dj-timing-row">
        <TimeBox label={`Track ${pair + 2} starts at`} id={into} value={cur.inAt} onSet={(v) => update({ inAt: v })} disabled={inFixed} />
        {!inFixed && nudges(into, cur.inAt, (v) => update({ inAt: v }), `track ${pair + 2}'s start`)}
      </div>
      <div className="dj-seg" role="radiogroup" aria-label="Transition style">
        {MIX_STYLES.map((m) => (
          <button key={m.id} role="radio" aria-checked={cur.style === m.id} className={`dj-segbtn ${cur.style === m.id ? "on" : ""}`} onClick={() => update({ style: m.id })} title={m.hint}>
            {m.name}
          </button>
        ))}
      </div>
      <div className="dj-seg" role="radiogroup" aria-label="Transition length in bars">
        {MIX_BARS.map((b) => (
          <button key={b} role="radio" aria-checked={cur.bars === b} className={`dj-segbtn ${cur.bars === b ? "on" : ""}`} onClick={() => update({ bars: b })}>
            {b}
          </button>
        ))}
        <span className="dj-label dj-seg-unit">bars</span>
      </div>
      <div className="dj-timing-presets" role="group" aria-label="Presets">
        {[...BUILT_IN_PRESETS, ...presets].map((p) => (
          <button key={`${p.name}-${p.style}-${p.bars}`} className={`dj-chip ${cur.style === p.style && cur.bars === p.bars ? "on" : ""}`} onClick={() => update({ style: p.style, bars: p.bars })}>
            {p.name}
          </button>
        ))}
      </div>
      <div className="dj-timing-row">
        <span className="dj-seg" role="group" aria-label="Zoom">
          <button className="dj-segbtn" onClick={() => useWorkspace.setState({ zoom: zooms[Math.max(0, zooms.indexOf(zoom) - 1)]! })} disabled={zoom <= 1} aria-label="Zoom out">
            −
          </button>
          <span className="dj-label dj-zoom">{zoom}×</span>
          <button className="dj-segbtn" onClick={() => useWorkspace.setState({ zoom: zooms[Math.min(zooms.length - 1, zooms.indexOf(zoom) + 1)]! })} disabled={zoom >= 64} aria-label="Zoom in">
            +
          </button>
        </span>
        <button className={`dj-chip ${onPoints ? "on" : ""}`} aria-pressed={onPoints} onClick={() => useWorkspace.setState({ onPoints: !onPoints })} title="Centre the waveforms on the transition's points, or on the playheads">
          {onPoints ? "Centred on the points" : "Following the playheads"}
        </button>
      </div>
      {onAir !== null && deck[side] && <LiveSeek deck={deck} side={side} num={onAir + 1} pos={onAirPos ?? 0} />}
    </div>
  );
}

/** A typed time, m:ss.t. */
function TimeBox({ label, id, value, onSet, disabled }: { label: string; id: DeckTrackId; value: number; onSet: (beats: number) => void; disabled?: boolean }) {
  const [text, setText] = useState<string | null>(null);
  const sec = text !== null && text.trim() ? parseClock(text) : null;
  const bad = text !== null && (sec === null || secondsToBeats(sec) >= trackBeats(id));
  const commit = () => {
    if (text !== null && !bad && sec !== null) onSet(Math.round(secondsToBeats(sec) * 1000) / 1000);
    setText(null);
  };
  return (
    <label className="dj-pointbox">
      {label}
      <input
        value={text ?? preciseClock(value)}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setText(null);
        }}
        className={bad ? "bad" : ""}
        aria-invalid={bad}
        inputMode="decimal"
        disabled={disabled}
      />
    </label>
  );
}

/** Move the record on air to a typed time (everyone hears it). */
function LiveSeek({ deck, side, num, pos }: { deck: Deck; side: DeckSide; num: number; pos: number }) {
  const [text, setText] = useState("");
  const id = deck[side]!;
  const sec = text.trim() ? parseClock(text) : null;
  const bad = text.trim() !== "" && (sec === null || secondsToBeats(sec) >= trackBeats(id));
  const go = () => {
    if (sec === null || bad) return;
    const to = safeSeek(deck, side, secondsToBeats(sec), deckBeat(deck, serverNow()));
    sendTracked({ cmd: "cue", side, track: id, pos: to }, { pending: `Moving track ${num}…`, done: `Track ${num} moved to ${preciseClock(to)} for everyone`, failed: `Couldn't move track ${num}` }, (d) => d !== deck);
    setText("");
  };
  return (
    <form
      className="dj-timing-row dj-liveseek"
      onSubmit={(e) => {
        e.preventDefault();
        go();
      }}
    >
      <label className="dj-pointbox">
        Live: move track {num} to
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={preciseClock(pos)} className={bad ? "bad" : ""} aria-invalid={bad} inputMode="decimal" />
      </label>
      <button className="dj-chip" type="submit" disabled={sec === null || bad} title="Everyone hears this">
        Go
      </button>
    </form>
  );
}
