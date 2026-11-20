import { DECK_TRACKS, deckTrack, isRecording, MAX_SET_STEPS, MIX_STYLES, trackBeats, type DeckTrackId, type MixStyle, type SetStep } from "@cg/shared";
import { useState, type CSSProperties } from "react";
import { useShallow } from "zustand/react/shallow";
import { deleteSet, duplicateSet, MAX_SETS, renameSet, saveSet, usePartyUi, type SavedSet } from "../../partyUi";
import { useAnalysis } from "../analysis/trackAnalysis";
import { beatsToSeconds, preciseClock } from "../deckTime";
import { artistOf, canMove, linkProblem, pairKey, type LiveList } from "./setPlan";
import { draftKey, focusPair, markReviewed, say, selectRow, useWorkspace } from "./workspaceStore";

/**
 * The set list: the records in order, numbered, with the one on air and the one up next marked. Add songs (several
 * at once), move them, take them out and save the set, all here. Between each pair, *Edit mix* puts that transition
 * on the waveforms; each record has *Jump live*, which moves everyone's music to it.
 */

const styleName = (style: MixStyle) => MIX_STYLES.find((m) => m.id === style)?.name ?? style;
const mmss = (beats: number) => {
  const t = Math.round(beatsToSeconds(beats));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

export function durationText(id: DeckTrackId): string {
  return isRecording(id) ? mmss(trackBeats(id)) : `${mmss(trackBeats(id))} loop`;
}

interface Props {
  list: LiveList;
  /** Where the record on air is now. */
  onAirPos: number | null;
  /** A transition is under way (the record it brings in has to stay next). */
  mixing: boolean;
  name: string | null;
  onAdd: (ids: DeckTrackId[]) => void;
  onMove: (i: number, by: -1 | 1) => void;
  onRemove: (i: number) => void;
  onJump: (i: number) => void;
  onLoad: (set: SavedSet, play: boolean) => void;
  /** Work a transition out again (or every one from the record on air on, with null). */
  onAuto: (i: number | null) => void;
}

export function SetList({ list, onAirPos, mixing, name, onAdd, onMove, onRemove, onJump, onLoad, onAuto }: Props) {
  const { steps, onAir } = list;
  const { pair, selected, review, draft } = useWorkspace(useShallow((s) => ({ pair: s.pair, selected: s.selected, review: s.review, draft: s.draft })));
  const [adding, setAdding] = useState(false);
  const full = steps.length >= MAX_SET_STEPS;
  const next = onAir !== null && onAir + 1 < steps.length ? onAir + 1 : null;
  /** Moving or removing a record that a transition under way depends on isn't allowed. */
  const locked = (i: number) => mixing && onAir !== null && (i === onAir + 1 || i === onAir);

  return (
    <section className="dj-setlist" aria-label="Set list">
      <header className="dj-setlist-head">
        <h3>
          {name ?? "Set"} <small>{steps.length ? `${steps.length} song${steps.length === 1 ? "" : "s"}` : "empty"}</small>
        </h3>
        <button className={`dj-chip ${adding ? "on" : ""}`} onClick={() => setAdding(!adding)} disabled={full && !adding} aria-expanded={adding} title={full ? `Up to ${MAX_SET_STEPS} songs in a set` : "Pick songs from the library to add to the end"}>
          + Add songs
        </button>
      </header>
      {adding && <SongPicker room={MAX_SET_STEPS - steps.length} last={steps[steps.length - 1]?.track ?? null} onDone={() => setAdding(false)} onAdd={onAdd} />}
      {!steps.length ? (
        <p className="dj-note dj-setlist-empty">Add songs to start a set. The first one goes on the decks, paused, ready to play.</p>
      ) : (
        <ol className="dj-rows">
          {steps.map((s, i) => {
            const t = deckTrack(s.track);
            const key = pairKey(steps, i);
            const linkOpen = pair === i;
            const unsaved = draft?.key === draftKey(i, s.track, steps[i + 1]?.track ?? "");
            // (a transition under way is past its own start, and that's fine)
            const problem = s.next && i === onAir && !mixing ? linkProblem(s, onAirPos ?? s.from) : null;
            const tag = i === onAir ? "On air" : i === next ? "Up next" : onAir !== null && i < onAir ? "Played" : null;
            return (
              <li key={`${i}-${s.track}`} className="dj-rowwrap">
                <div className={`dj-row ${i === onAir ? "is-onair" : ""} ${i === next ? "is-next" : ""} ${i === selected ? "is-selected" : ""} ${onAir !== null && i < onAir ? "is-played" : ""}`} style={{ "--c": t.color } as CSSProperties}>
                  <button className="dj-row-main" onClick={() => selectRow(i)} aria-pressed={i === selected} aria-current={i === onAir ? "true" : undefined} title="Select it to edit or rehearse (only you hear rehearsals)">
                    <span className="dj-row-num">{i + 1}</span>
                    <span className="dj-row-text">
                      <b>{t.name}</b>
                      <small>
                        {artistOf(s.track)} · {durationText(s.track)}
                      </small>
                    </span>
                    {tag && <span className={`dj-row-tag ${tag === "On air" ? "air" : tag === "Up next" ? "next" : ""}`}>{tag}</span>}
                  </button>
                  <span className="dj-row-tools">
                    <button className="dj-chip dj-jump" onClick={() => onJump(i)} title={`Move everyone's music to track ${i + 1} and cue the song after it`}>
                      Jump live
                    </button>
                    <button className="dj-chip" onClick={() => onMove(i, -1)} disabled={!canMove(steps, i, -1, onAir) || locked(i) || locked(i - 1)} aria-label={`Move track ${i + 1} up`}>
                      ↑
                    </button>
                    <button className="dj-chip" onClick={() => onMove(i, 1)} disabled={!canMove(steps, i, 1, onAir) || locked(i) || locked(i + 1)} aria-label={`Move track ${i + 1} down`}>
                      ↓
                    </button>
                    <button className="dj-chip" onClick={() => onRemove(i)} disabled={i === onAir || locked(i)} aria-label={`Remove track ${i + 1}`} title={i === onAir ? "It's on air: jump to another song first" : "Take it out of the set"}>
                      ×
                    </button>
                  </span>
                </div>
                {s.next && steps[i + 1] && (
                  <div className={`dj-link ${linkOpen ? "is-open" : ""} ${key && review.includes(key) ? "is-review" : ""} ${problem ? "is-bad" : ""}`}>
                    <button className="dj-chip dj-editmix" onClick={(e) => editMix(i, e.currentTarget)} aria-pressed={linkOpen} title={`Put the ${i + 1} → ${i + 2} transition on the waveforms (the live set keeps playing)`}>
                      Edit mix {i + 1} → {i + 2}
                    </button>
                    <span className="dj-link-text">
                      fades at {preciseClock(s.next.at)} · {styleName(s.next.style)} {s.next.bars} bar{s.next.bars === 1 ? "" : "s"}
                    </span>
                    <button
                      className="dj-chip dj-auto"
                      onClick={() => onAuto(i)}
                      disabled={(onAir !== null && i < onAir) || (mixing && i === onAir)}
                      title="Work this transition out again from the two songs' beats and energy"
                      aria-label={`Work out the ${i + 1} → ${i + 2} transition automatically`}
                    >
                      Auto
                    </button>
                    {unsaved && <span className="dj-badge">Unsaved</span>}
                    {problem && <span className="dj-badge bad">Already gone by</span>}
                    {key && review.includes(key) && (
                      <span className="dj-badge review">
                        New pair: check it
                        <button
                          className="dj-badge-x"
                          onClick={() => {
                            markReviewed(key);
                            say(`Kept the ${i + 1} → ${i + 2} transition as it is`);
                          }}
                          aria-label={`Keep the ${i + 1} → ${i + 2} transition as it is`}
                          title="It's fine as it is"
                        >
                          ✓
                        </button>
                      </span>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {steps.length > 1 && (
        <div className="dj-mixrow dj-setlist-tools">
          <button className="dj-chip" onClick={() => onAuto(null)} title="Work every transition from the song on air to the end out again from the songs' beats and energy">
            Auto-link all
          </button>
          <span className="dj-note">Redo every transition automatically</span>
        </div>
      )}
      <SaveBar steps={steps} name={name} />
      <SavedSets onLoad={onLoad} />
    </section>
  );
}

/** Put a transition on the waveforms. On a phone they're above the list, so bring them into view. */
function editMix(i: number, from: HTMLElement) {
  focusPair(i);
  if (!window.matchMedia("(max-width: 720px)").matches) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  from.closest(".dj-work")?.querySelector(".dj-pair")?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
}

/** The library, to tick several songs and add them in one go (in the order ticked). */
function SongPicker({ room, last, onAdd, onDone }: { room: number; last: DeckTrackId | null; onAdd: (ids: DeckTrackId[]) => void; onDone: () => void }) {
  const [picked, setPicked] = useState<DeckTrackId[]>([]);
  const analyzing = useAnalysis(useShallow((s) => DECK_TRACKS.filter((t) => s[t.id]?.status === "analyzing").map((t) => t.id)));
  const toggle = (id: DeckTrackId) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < room ? [...p, id] : p));
  return (
    <div className="dj-picker" role="group" aria-label="Library: tick songs to add">
      <ul>
        {DECK_TRACKS.map((t) => {
          const n = picked.indexOf(t.id);
          return (
            <li key={t.id}>
              <label className={n >= 0 ? "on" : ""} style={{ "--c": t.color } as CSSProperties}>
                <input type="checkbox" checked={n >= 0} onChange={() => toggle(t.id)} disabled={n < 0 && picked.length >= room} />
                <span className="dj-picker-order" aria-hidden>
                  {n >= 0 ? n + 1 : ""}
                </span>
                <span className="dj-row-text">
                  <b>{t.name}</b>
                  <small>
                    {artistOf(t.id)} · {durationText(t.id)}
                    {analyzing.includes(t.id) ? " · analyzing…" : ""}
                    {last === t.id && !picked.length ? " · last in the set" : ""}
                  </small>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <div className="dj-mixrow">
        <button
          className="dj-chip on"
          disabled={!picked.length}
          onClick={() => {
            onAdd(picked);
            setPicked([]);
            onDone();
          }}
        >
          Add {picked.length || ""} song{picked.length === 1 ? "" : "s"}
        </button>
        <button className="dj-chip" onClick={onDone}>
          Cancel
        </button>
        <span className="dj-note">{room <= 0 ? "The set is full" : `Room for ${room} more`}</span>
      </div>
    </div>
  );
}

function SaveBar({ steps, name }: { steps: SetStep[]; name: string | null }) {
  const sets = usePartyUi((s) => s.sets);
  const [text, setText] = useState("");
  const fallback = name ?? `Set ${sets.length + 1}`;
  const save = () => {
    if (!steps.length) return;
    const n = text.trim() || fallback;
    saveSet({ name: n, steps });
    setText("");
    say(`Saved “${n}” on this device (${steps.length} song${steps.length === 1 ? "" : "s"})`);
  };
  return (
    <form
      className="dj-mixrow dj-savebar"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder={fallback} maxLength={32} aria-label="Set name" />
      <button className="dj-chip on" type="submit" disabled={!steps.length} title="Keep this set on this device (saving the same name again updates it)">
        Save set
      </button>
    </form>
  );
}

function SavedSets({ onLoad }: { onLoad: (set: SavedSet, play: boolean) => void }) {
  const sets = usePartyUi((s) => s.sets);
  const [open, setOpen] = useState(false);
  if (!sets.length) return null;
  return (
    <details className="dj-saved" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Saved sets ({sets.length})</summary>
      <ul>
        {sets.map((s) => (
          <SavedRow key={s.id} set={s} full={sets.length >= MAX_SETS} onLoad={onLoad} />
        ))}
      </ul>
    </details>
  );
}

/** One saved set: load or play it, see its songs, rename, copy or delete it (delete asks first). */
function SavedRow({ set, full, onLoad }: { set: SavedSet; full: boolean; onLoad: (set: SavedSet, play: boolean) => void }) {
  const [mode, setMode] = useState<"idle" | "songs" | "rename" | "delete">("idle");
  const [text, setText] = useState(set.name);
  return (
    <li className="dj-saved-row">
      <span className="dj-saved-main">
        <span className="dj-row-text">
          <b>{set.name}</b>
          <small>
            {set.steps.length} song{set.steps.length === 1 ? "" : "s"}
          </small>
        </span>
        {mode === "delete" ? (
          <>
            <button className="dj-chip dj-danger" onClick={() => deleteSet(set.id)}>
              Delete
            </button>
            <button className="dj-chip" onClick={() => setMode("idle")}>
              Keep
            </button>
          </>
        ) : (
          <>
            <button className="dj-chip" onClick={() => onLoad(set, false)} title="Replace the set on the decks with this one, paused at its first song">
              Load
            </button>
            <button className="dj-chip on" onClick={() => onLoad(set, true)} title="Replace the set on the decks with this one and play it from the top (everyone hears it)">
              Play
            </button>
            <button className={`dj-chip ${mode === "songs" ? "on" : ""}`} onClick={() => setMode(mode === "songs" ? "idle" : "songs")} aria-expanded={mode === "songs"} title="Show its songs">
              Songs
            </button>
            <button className="dj-chip" onClick={() => (setText(set.name), setMode(mode === "rename" ? "idle" : "rename"))} aria-expanded={mode === "rename"}>
              Rename
            </button>
            <button className="dj-chip" onClick={() => duplicateSet(set.id)} disabled={full} title={full ? `Up to ${MAX_SETS} saved sets` : "Make a copy of it, next to it"}>
              Duplicate
            </button>
            <button className="dj-chip" onClick={() => setMode("delete")} aria-label={`Delete the saved set ${set.name}`}>
              ×
            </button>
          </>
        )}
      </span>
      {mode === "rename" && (
        <form
          className="dj-mixrow dj-savebar"
          onSubmit={(e) => {
            e.preventDefault();
            renameSet(set.id, text);
            setMode("idle");
          }}
        >
          <input autoFocus value={text} maxLength={32} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setMode("idle")} aria-label={`New name for ${set.name}`} />
          <button className="dj-chip on" type="submit">
            Rename
          </button>
        </form>
      )}
      {mode === "songs" && (
        <ol className="dj-saved-songs">
          {set.steps.map((st, k) => (
            <li key={k}>
              {deckTrack(st.track).name} <small>{artistOf(st.track)}</small>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}
