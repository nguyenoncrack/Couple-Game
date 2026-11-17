import { deckTrack, marksOf, MIX_STYLES, trackPosition, type Deck, type DeckSet, type DeckSide, type SetStep } from "@cg/shared";
import { useState } from "react";
import { partyCmd } from "../../../state/game";
import { deleteSet, duplicateSet, renameSet, saveSet, setConsoleTab, usePartyUi, type SavedSet } from "../partyUi";
import { preciseClock } from "./deckTime";

/**
 * My Sets: the set in the decks (one you loaded, or the one your mixing records as you go: each record, where it
 * started, and each transition's time, style and length), saved to this device with its cue points, and your saved
 * sets to load, rename, copy or delete. A loaded set opens paused, with its first transition queued.
 */

const styleName = (id: string) => MIX_STYLES.find((m) => m.id === id)?.name ?? id;

/** The set in the decks as it would be saved: its records with their cue points. A single record if nothing's mixed yet. */
function currentSet(deck: Deck, beat: number, air: DeckSide): SetStep[] {
  const steps = deck.set?.steps;
  if (steps?.length) return steps.map((s) => ({ ...s, cues: marksOf(deck, s.track) }));
  const id = deck[air];
  if (!id) return [];
  const from = deck[air === "a" ? "entryA" : "entryB"] ?? trackPosition(deck, air, beat) ?? 0;
  return [{ track: id, from, cues: marksOf(deck, id) }];
}

export function SetsPage({ deck, beat, air }: { deck: Deck; beat: number; air: DeckSide }) {
  const sets = usePartyUi((s) => s.sets);
  const steps = currentSet(deck, beat, air);
  const [name, setName] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  // (a set saved here, or loaded, goes by its name)
  const same = sets.find((s) => JSON.stringify(s.steps) === JSON.stringify(steps));
  const known = deck.set?.name ?? same?.name ?? null;
  const suggested = known ?? `Set ${sets.length + 1}`;
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!steps.length) return;
    const set: DeckSet = { name: name ?? suggested, steps };
    saveSet(set);
    setSaved(set.name.trim() || "My set");
    setName(null);
  };
  const replacing = sets.some((s) => s.name === (name ?? suggested).trim());

  return (
    <div className="dj-sets">
      <section className="dj-setnow" aria-label="The set in the decks">
        <h3>
          In the decks{known ? `: ${known}` : deck.set ? ": this mix (not saved yet)" : ""}
        </h3>
        {steps.length ? (
          <SetSteps steps={steps} at={deck.set ? deck.set.step : 0} />
        ) : (
          <p className="dj-note">Put a record on to start a set.</p>
        )}
        {!deck.set && steps.length > 0 && <p className="dj-hint">Mix to the other deck (a timed transition, a preset or the Mix pad) and the set records itself here.</p>}
        <form className="dj-mixrow dj-setsave" onSubmit={save}>
          <input value={name ?? suggested} onChange={(e) => setName(e.target.value)} maxLength={32} aria-label="Set name" />
          <button className="dj-chip on dj-savebtn" type="submit" disabled={!steps.length} title={replacing ? "Replaces your set with this name" : "Keep this set on this device"}>
            Save Set
          </button>
          {replacing && <span className="dj-note">Replaces the saved set with this name</span>}
          {saved && !replacing && <span className="dj-note" role="status">Saved “{saved}”</span>}
        </form>
      </section>

      <section className="dj-mysets" aria-label="My Sets">
        <h3>My Sets</h3>
        {sets.length === 0 ? <p className="dj-note">No saved sets yet. Saved sets stay on this device.</p> : sets.map((s) => <SavedSetRow key={s.id} set={s} />)}
      </section>
    </div>
  );
}

function SetSteps({ steps, at }: { steps: SetStep[]; at: number }) {
  return (
    <ol className="dj-setsteps">
      {steps.map((s, i) => (
        <li key={i} className={i === at ? "on" : i < at ? "done" : ""}>
          <span className="dj-setdot" style={{ background: deckTrack(s.track).color }} aria-hidden />
          <b>{deckTrack(s.track).name}</b>
          <span>from {preciseClock(s.from)}</span>
          {s.cues.length > 0 && <span className="dj-setcues">{s.cues.length} cue{s.cues.length === 1 ? "" : "s"}</span>}
          {s.next && (
            <span className="dj-sethand">
              at {preciseClock(s.next.at)}: {styleName(s.next.style)}, {s.next.bars} bar{s.next.bars === 1 ? "" : "s"} ➜
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

function SavedSetRow({ set }: { set: SavedSet }) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [open, setOpen] = useState(false);
  const load = () => {
    partyCmd({ cmd: "setload", set: { name: set.name, steps: set.steps } });
    setConsoleTab("music");
  };
  const summary = `${set.steps.length} record${set.steps.length === 1 ? "" : "s"}${set.steps.length > 1 ? ` · ${set.steps.length - 1} transition${set.steps.length === 2 ? "" : "s"}` : ""}`;
  return (
    <div className="dj-setrow">
      {renaming === null ? (
        <button className="dj-setname" onClick={() => setOpen(!open)} aria-expanded={open} title="Show its records">
          <b>{set.name}</b>
          <small>{summary}</small>
        </button>
      ) : (
        <form
          className="dj-save"
          onSubmit={(e) => {
            e.preventDefault();
            renameSet(set.id, renaming);
            setRenaming(null);
          }}
        >
          <input autoFocus onFocus={(e) => e.currentTarget.select()} value={renaming} maxLength={32} onChange={(e) => setRenaming(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setRenaming(null)} aria-label={`New name for ${set.name}`} />
          <button className="dj-chip on" type="submit">
            Rename
          </button>
        </form>
      )}
      <div className="dj-setbtns">
        {confirm ? (
          <>
            <span className="dj-note">Delete “{set.name}”?</span>
            <button className="dj-chip dj-danger" onClick={() => deleteSet(set.id)}>
              Delete
            </button>
            <button className="dj-chip" onClick={() => setConfirm(false)}>
              Keep
            </button>
          </>
        ) : (
          <>
            <button className="dj-chip on" onClick={load} title="Put it in the decks, paused at the start">
              Load
            </button>
            <button className="dj-chip" onClick={() => setRenaming(set.name)} disabled={renaming !== null}>
              Rename
            </button>
            <button className="dj-chip" onClick={() => duplicateSet(set.id)}>
              Duplicate
            </button>
            <button className="dj-chip" onClick={() => setConfirm(true)}>
              Delete
            </button>
          </>
        )}
      </div>
      {open && <SetSteps steps={set.steps} at={-1} />}
    </div>
  );
}
