export function DjGuide({ simple }: { simple: boolean }) {
  return (
    <div className="dj-guide">
      <h2>{simple ? "Using the music player" : "Mix your first set"}</h2>
      <dl>
        <dt>Load a record</dt>
        <dd>{simple ? "Pick any record to play it. Skip goes to the next record in the crate." : "Choose Load to A or B, then pick a record. Auto fills an empty deck first, then picks the deck opposite the crossfader. Press Play and slide the crossfader toward the deck you want to hear."}</dd>
        <dt>Find your spot</dt>
        <dd>Drag the timeline to anywhere in the song, or use Start and the jump buttons. Recordings jump by 10 seconds and built-in tracks jump by one bar. You can cue a track while paused.</dd>
        {!simple && (
          <>
            <dt>Drop at the right moment</dt>
            <dd>Move to the part you want, then press Set drop. Drop at that time jumps to it and puts that deck on air. Drop FX adds a build-up and crash to the mix.</dd>
            <dt>Shape the mix</dt>
            <dd>Use each deck’s volume and EQ to balance the mix. Filter and Echo affect the mix, and BPM changes playback speed.</dd>
            <dt>Transition between tracks</dt>
            <dd>Load both decks and press Play. Pick a transition preset or set a style and length, then press Mix to start it on the next bar.</dd>
          </>
        )}
        {!simple && (
          <>
            <dt>Take a record off</dt>
            <dd>Eject (⏏) clears that deck and leaves the record in the crate. If the other deck has a track loaded, it takes over.</dd>
          </>
        )}
        <dt>Control what you hear</dt>
        <dd>The mixer is shared with your partner. Volume, Mute, and Fade affect your device.</dd>
      </dl>
    </div>
  );
}
