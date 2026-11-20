export function DjGuide({ simple }: { simple: boolean }) {
  return (
    <div className="dj-guide">
      <h2>{simple ? "Using the music player" : "Mix your first set"}</h2>
      {simple ? (
        <dl>
          <dt>Load a record</dt>
          <dd>Pick any record to play it. Skip goes to the next record in the crate.</dd>
          <dt>Find your spot</dt>
          <dd>Drag the timeline to anywhere in the song, or use Start and the jump buttons. Recordings jump by 10 seconds and built-in tracks jump by one bar. You can cue a track while paused.</dd>
          <dt>Control what you hear</dt>
          <dd>Volume, Mute, and Fade affect your device.</dd>
        </dl>
      ) : (
        <dl>
          <dt>Build a set</dt>
          <dd>Press + Add songs, tick several songs in the order you want them, and add them in one go. Move them with ↑ ↓, take one out with ×, and press Save set to keep it on this device.</dd>
          <dt>Play it</dt>
          <dd>Play starts the song marked On air for everyone. Each transition plays by itself when the song gets there, and the next song comes in. Jump live on any song moves everyone’s music to it and cues the song after it.</dd>
          <dt>Move through a song</dt>
          <dd>Drag the slider in the live bar at the top to go forward or back in the song on air (everyone hears it), or use −10 s and +10 s. The orange tick is where the next transition starts; a jump stops just before it, so Mix now goes on to the next song.</dd>
          <dt>Work on a transition</dt>
          <dd>Press Edit mix between two songs to put them on the waveforms (the live set keeps playing). Click a waveform to set where the first song fades and where the next one starts, or pick a suggestion. Save transition puts it into the set.</dd>
          <dt>Rehearse in private</dt>
          <dd>Cue and Preview mix play just for you, with the live music turned down for you. Your partner keeps hearing the party.</dd>
          <dt>Check moved songs</dt>
          <dd>Moving or removing a song changes the transitions around it. They’re marked New pair: check it until you look at them or press ✓.</dd>
          <dt>Sound FX and timing</dt>
          <dd>Sound FX has the crossfader, filter, echo, drop and each deck’s EQ (everyone hears them). Adjust timing has exact times, style, length and presets. Closing them keeps your work.</dd>
          <dt>More controls</dt>
          <dd>Under the workspace are the full decks: both turntables (drag the bar under each, play or pause one deck, type a time, save cues, set a drop, EQ, eject), the mixer, Transitions (presets, style and length, Mix to the other deck, or time one for later, with Mix now and Cancel) and Load a record onto deck A or B. Fold any part away with its heading.</dd>
          <dt>Let it work out transitions</dt>
          <dd>Auto on a transition in the set list works it out again from the two songs’ beats and energy; Auto-link all does every one still to come.</dd>
          <dt>Control what you hear</dt>
          <dd>The music and the set are shared with your partner. Volume, Mute, and Fade affect your device.</dd>
        </dl>
      )}
    </div>
  );
}
