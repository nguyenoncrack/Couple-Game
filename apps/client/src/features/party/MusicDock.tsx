import { deckBeat, mixDone, positionAt } from "@cg/shared";
import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { holdAmbient, useMusicOn } from "../../state/music";
import { partyCmd, serverNow, useGame } from "../../state/game";
import { DeckEngine } from "./deck/deckEngine";
import { DjConsole } from "./deck/DjConsole";
import { useGearInUse } from "./partyHooks";
import { resetPartyUi, usePartyUi } from "./partyUi";
import { easeGain, levelAtHeight, musicGain, musicSources } from "./spatialMix";

/**
 * The party's music on this screen. The deck's built-in tracks are made here in Web Audio whenever the house's deck
 * is playing, for everyone in the house, with no joining in: like the game's own music it starts on your first
 * click or key press, and the game's music switch silences it. It comes from the speakers, so it fades as your
 * character walks away. The controls only come up while your character is working the gear: the DJ console at the
 * booth, its simpler cousin at a music player. Leaving the house takes it all down.
 */
export function MusicDock() {
  const deck = useGame((s) => s.life?.party?.deck);
  const { volume, muted, fade } = usePartyUi(useShallow((s) => ({ volume: s.volume, muted: s.muted, fade: s.fade })));
  const musicOn = useMusicOn();
  const using = useGearInUse();
  const engine = useMemo(() => new DeckEngine(serverNow), []);
  if (import.meta.env.DEV) Object.assign(window, { __deck: engine });

  useEffect(() => engine.follow(deck), [deck, engine]);

  // a set moves on when its transition finishes: the house puts the next record on the free deck, queued to come in
  useEffect(() => {
    const set = deck?.set;
    if (!deck || !set?.steps[set.step]?.next || !set.steps[set.step + 1]) return;
    const m = deck.mix;
    if (!m) return void partyCmd({ cmd: "setstep" });
    if (m.start === null || !deck.playing) return;
    if (mixDone(m, deckBeat(deck, serverNow()))) return void partyCmd({ cmd: "setstep" });
    const ms = ((m.start + m.beats - deckBeat(deck, serverNow())) * 60_000) / deck.bpm;
    const timer = setTimeout(() => partyCmd({ cmd: "setstep" }), ms + 60);
    return () => clearTimeout(timer);
  }, [deck]);

  const audible = Boolean(deck?.playing) && musicOn;
  // once the sound has started it stays up (a paused deck makes none); the browser lets it start after any click
  useEffect(() => {
    if (!audible) return;
    engine.start();
    const kick = () => {
      if (!engine.running) engine.start();
    };
    window.addEventListener("pointerdown", kick);
    window.addEventListener("keydown", kick);
    return () => {
      window.removeEventListener("pointerdown", kick);
      window.removeEventListener("keydown", kick);
    };
  }, [audible, engine]);

  // the sound comes from the speakers: it's full beside them and fades as this player's character walks away
  const view = useGame((s) => s.view);
  const sources = useMemo(() => (view ? musicSources(view) : []), [view]);
  useEffect(() => {
    if (!audible) {
      engine.setOutput(0, 1);
      return;
    }
    let gain = 1;
    const step = () => {
      const { me, life } = useGame.getState();
      const avatar = me ? life?.avatars[me] : undefined;
      let target = 1;
      if (fade && avatar) {
        const at = positionAt(avatar, serverNow());
        target = musicGain(sources, at.x, at.z, levelAtHeight(at.y));
      }
      gain = easeGain(gain, target);
      engine.setOutput(muted ? 0 : volume / 100, gain);
    };
    step();
    const timer = setInterval(step, 250);
    return () => clearInterval(timer);
  }, [audible, fade, sources, engine, muted, volume]);

  // the lo-fi background music steps aside while the party's plays
  useEffect(() => {
    holdAmbient(audible);
  }, [audible]);
  useEffect(
    () => () => {
      engine.stop();
      holdAmbient(false);
      resetPartyUi();
    },
    [engine],
  );

  if (!using) return null;
  return <DjConsole deck={deck} engine={engine} mode={using} />;
}
