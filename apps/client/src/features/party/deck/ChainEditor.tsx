import { DECK_TRACKS, deckRunning, deckTrack, MAX_SET_STEPS, MIX_BARS, MIX_STYLES, mixDone, mixQueued, trackBeats, trackPosition, type Deck, type DeckSide, type DeckTrackId, type MixStyle, type SetStep } from "@cg/shared";
import { useState, type CSSProperties } from "react";
import { partyCmd } from "../../../state/game";
import { saveSet, usePartyUi } from "../partyUi";
import { autoLink, linkAll, linkProblem } from "./analysis/chain";
import { readyAnalysis, useAnalysis } from "./analysis/trackAnalysis";
import { parseClock, preciseClock, secondsToBeats } from "./deckTime";

/**
 * Link songs: a chain of records, each handing over to the next (1 ➜ 2 ➜ 3 ➜ …). It starts from the record on air
 * and whatever is already queued after it. Add records, reorder them, and set each link's time, style and length (or
 * let Auto work it out from the records' beats and energy). *Link to what's playing* carries the mix on into the
 * chain without stopping; start playback from any numbered record to hear its remaining links.
 */

const upper = (side: DeckSide) => side.toUpperCase();

export function ChainEditor({ deck, beat, air }: { deck: Deck; beat: number; air: DeckSide }) {
  const analyses = useAnalysis();
  const sets = usePartyUi((s) => s.sets);
  const [draft, setDraft] = useState<SetStep[] | null>(null);
  const [name, setName] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const onAir = deck[air];
  const analysis = (id: DeckTrackId) => readyAnalysis(analyses[id]);

  // what's in the decks: the record on air, and what the set has queued after it
  const s = deck.set;
  const base: SetStep[] =
    s && onAir && s.steps[s.step]?.track === onAir
      ? s.steps.slice(s.step).map((x) => ({ ...x, cues: [] }))
      : onAir
        ? [{ track: onAir, from: deck[air === "a" ? "entryA" : "entryB"] ?? 0, cues: [] }]
        : [];
  const steps = draft ?? base;
  const live = steps.length > 0 && steps[0]!.track === onAir;
  const onAirPos = trackPosition(deck, air, beat) ?? 0;
  const running = deckRunning(deck, air, beat);
  const mixing = Boolean(deck.mix && !mixQueued(deck.mix, beat) && !mixDone(deck.mix, beat));
  /** Where a step's record starts, for checking its link: the record on air from where it is now. */
  const startOf = (i: number, forLive: boolean) => (i === 0 && forLive && running ? onAirPos : steps[i]!.from);
  const problems = (forLive: boolean) => steps.map((x, i) => (i < steps.length - 1 ? linkProblem(x, startOf(i, forLive)) : null));
  const liveProblems = problems(true);
  const startProblems = problems(false);

  const edit = (next: SetStep[]) => {
    setDraft(next);
    setNote(null);
  };
  const setStep = (i: number, patch: Partial<SetStep>) => edit(steps.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const setLink = (i: number, patch: Partial<NonNullable<SetStep["next"]>>) => {
    const cur = steps[i]!;
    setStep(i, { next: { at: cur.next?.at ?? 0, style: cur.next?.style ?? "blend", bars: cur.next?.bars ?? 8, ...patch } });
  };
  /** Work one link out again (the one from step i to the next). */
  const relink = (list: SetStep[], i: number): SetStep[] => {
    const cur = list[i];
    const next = list[i + 1];
    if (!cur || !next) return list;
    const link = autoLink(cur.track, i === 0 && live && running ? onAirPos : cur.from, next.track, deck.bpm, analysis(cur.track), analysis(next.track));
    return list.map((x, j) => (j === i ? { ...x, next: { at: link.at, style: link.style, bars: link.bars } } : j === i + 1 ? { ...x, from: link.inFrom } : x));
  };
  const add = (id: DeckTrackId) => {
    if (steps.length >= MAX_SET_STEPS) return;
    const list = [...steps.map((x) => ({ ...x })), { track: id, from: 0, cues: [] }];
    edit(list.length > 1 ? relink(list, list.length - 2) : list);
  };
  const remove = (i: number) => {
    let list = steps.filter((_, j) => j !== i).map((x) => ({ ...x }));
    if (i === list.length) delete list[list.length - 1]?.next;
    else if (i > 0) list = relink(list, i - 1);
    edit(list);
  };
  const move = (i: number, by: -1 | 1) => {
    const j = i + by;
    if (j < 1 || j >= steps.length || i < 1) return;
    const list = steps.map((x) => ({ ...x }));
    [list[i], list[j]] = [list[j]!, list[i]!];
    // the links around the two that swapped are worked out again
    let out = list;
    for (const k of [Math.min(i, j) - 1, Math.min(i, j), Math.max(i, j)]) if (k >= 0 && k < out.length - 1) out = relink(out, k);
    delete out[out.length - 1]?.next;
    edit(out);
  };
  const autoAll = () => edit(linkAll(steps, deck.bpm, analysis, live && running ? onAirPos : undefined));

  const canLink = live && steps.length > 1 && !mixing && liveProblems.every((p) => !p);
  const canStartAt = (i: number) => steps.length > i && startProblems.slice(i).every((p) => !p);
  const linkUp = () => {
    if (!canLink) return;
    partyCmd({ cmd: "setchain", steps });
    setDraft(null);
    setNote(`Linked: ${steps.length} records, one after another`);
  };
  const playFrom = (i: number) => {
    if (!canStartAt(i)) return;
    partyCmd({ cmd: "setload", set: { name: name.trim() || "Chain", steps }, step: i, playing: true });
    setDraft(null);
    setNote(`Playing from track ${i + 1}`);
  };
  const save = () => {
    if (steps.length < 1) return;
    const n = name.trim() || `Chain ${sets.length + 1}`;
    saveSet({ name: n, steps });
    setNote(`Saved “${n}” in My Sets`);
  };

  return (
    <section className="dj-chain" aria-label="Link songs">
      <h3>
        Link songs <small>{steps.length > 1 ? `${steps.length} records · ${steps.length - 1} link${steps.length === 2 ? "" : "s"}` : "1 ➜ 2 ➜ 3 ➜ …"}</small>
      </h3>
      {!steps.length && <p className="dj-note">Put a record on the decks (or pick the first one below) to start a chain.</p>}
      <ol className="dj-chainlist">
        {steps.map((x, i) => {
          const t = deckTrack(x.track);
          const problem = (live ? liveProblems : startProblems)[i];
          const onAirHere = i === 0 && live;
          return (
            <li key={`${i}-${x.track}`} className="dj-chainstep" style={{ "--c": t.color } as CSSProperties}>
              <div className="dj-chainrec">
                <span className="dj-chainnum">{i + 1}</span>
                <b>{t.name}</b>
                {onAirHere ? (
                  <span className="dj-note">on air (deck {upper(air)}) · {preciseClock(onAirPos)}</span>
                ) : (
                  <ClockBox label="starts at" value={x.from} max={trackBeats(x.track)} onSet={(v) => setStep(i, { from: v })} />
                )}
                <span className="dj-chainbtns">
                  {(draft || !s) && (
                    <button className="dj-chip" onClick={() => playFrom(i)} disabled={!canStartAt(i)} aria-label={`Play from track ${i + 1}: ${t.name}`}>
                      ▶
                    </button>
                  )}
                  {i > 0 && (
                    <>
                      <button className="dj-chip" onClick={() => move(i, -1)} disabled={i < 2} aria-label={`Move ${t.name} earlier`}>
                        ↑
                      </button>
                      <button className="dj-chip" onClick={() => move(i, 1)} disabled={i === steps.length - 1} aria-label={`Move ${t.name} later`}>
                        ↓
                      </button>
                    </>
                  )}
                  <button className="dj-chip" onClick={() => remove(i)} aria-label={`Take ${t.name} out of the chain`} title={onAirHere ? "Start the chain from another song (then play it from the start)" : "Take it out of the chain"}>
                    ×
                  </button>
                </span>
              </div>
              {x.next && i < steps.length - 1 && (
                <div className={`dj-chainlink ${problem ? "bad" : ""}`}>
                  <span aria-hidden>➜</span>
                  <ClockBox label="at" value={x.next.at} max={trackBeats(x.track)} onSet={(v) => setLink(i, { at: v })} />
                  <select value={x.next.style} onChange={(e) => setLink(i, { style: e.target.value as MixStyle })} aria-label={`Link ${i + 1} style`}>
                    {MIX_STYLES.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  <select value={x.next.bars} onChange={(e) => setLink(i, { bars: Number(e.target.value) })} aria-label={`Link ${i + 1} length`}>
                    {MIX_BARS.map((n) => (
                      <option key={n} value={n}>
                        {n} bar{n === 1 ? "" : "s"}
                      </option>
                    ))}
                  </select>
                  <button className="dj-chip" onClick={() => edit(relink(steps, i))} title="Work this link out from the two records' beats and energy">
                    Auto
                  </button>
                  {problem && <span className="dj-note dj-bad">{problem}</span>}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <div className="dj-mixrow dj-chainadd">
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) add(e.target.value as DeckTrackId);
          }}
          disabled={steps.length >= MAX_SET_STEPS}
          aria-label="Add a song to the end of the chain"
        >
          <option value="">{steps.length ? "+ Add a song…" : "Pick the first song…"}</option>
          {DECK_TRACKS.map((t) => (
            <option key={t.id} value={t.id} disabled={steps[steps.length - 1]?.track === t.id}>
              {t.name}
              {analyses[t.id]?.status === "analyzing" ? " (analyzing…)" : ""}
            </option>
          ))}
        </select>
        <button className="dj-chip" onClick={autoAll} disabled={steps.length < 2} title="Work every link out from the records' beats and energy">
          Auto-link all
        </button>
        {draft && (
          <button className="dj-chip" onClick={() => setDraft(null)} title="Back to what's in the decks">
            Reset
          </button>
        )}
      </div>
      <div className="dj-mixrow dj-chaingo">
        <button className="dj-chip on" onClick={linkUp} disabled={!canLink} title={!live ? "The first song isn't the one on air: play the chain from the start instead" : mixing ? "Wait for the transition under way to finish" : "Carry the mix on into the chain, without stopping"}>
          Link to what's playing
        </button>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={`Chain ${sets.length + 1}`} maxLength={32} aria-label="Chain name" />
        <button className="dj-chip" onClick={save} disabled={!steps.length} title="Keep it in My Sets (on this device)">
          Save
        </button>
        {note && (
          <span className="dj-note" role="status">
            {note}
          </span>
        )}
      </div>
    </section>
  );
}

/** A time to type, shown as m:ss.t. */
function ClockBox({ label, value, max, onSet }: { label: string; value: number; max: number; onSet: (beats: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  const sec = text !== null && text.trim() ? parseClock(text) : null;
  const bad = text !== null && (sec === null || secondsToBeats(sec) >= max);
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
      />
    </label>
  );
}
