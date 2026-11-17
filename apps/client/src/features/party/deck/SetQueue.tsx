import { DECK_TRACKS, deckTrack, MAX_SET_STEPS, type Deck, type DeckTrackId } from "@cg/shared";
import { partyCmd } from "../../../state/game";
import { setConsoleTab } from "../partyUi";

export function SetQueue({ set }: { set: Deck["set"] }) {
  const full = (set?.steps.length ?? 0) >= MAX_SET_STEPS;
  return (
    <section className="dj-setqueue" aria-label="Set queue">
      <div className="dj-mixrow">
        <h3>{set?.name ?? "Set queue"}</h3>
        <select
          aria-label="Add a song to the set queue"
          value=""
          disabled={full}
          onChange={(e) => {
            if (e.target.value) partyCmd({ cmd: "setappend", track: e.target.value as DeckTrackId });
          }}
        >
          <option value="">{full ? "Queue full" : "+ Queue a song…"}</option>
          {DECK_TRACKS.map((track) => (
            <option key={track.id} value={track.id}>{track.name}</option>
          ))}
        </select>
        <button className="dj-chip" onClick={() => setConsoleTab("sets")}>Edit links</button>
      </div>
      {set && (
        <ol className="dj-queue-tracks">
          {set.steps.map(({ track }, i) => (
            <li key={i}>
              <button
                className={`dj-chip ${i === set.step ? "on" : ""}`}
                aria-current={i === set.step ? "step" : undefined}
                aria-label={`Jump to track ${i + 1}: ${deckTrack(track).name}`}
                onClick={() => partyCmd({ cmd: "setjump", step: i, track })}
              >
                <span>{i + 1}</span> {deckTrack(track).name}
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
