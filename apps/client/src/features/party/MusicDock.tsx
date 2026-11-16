import { positionAt } from "@cg/shared";
import { useEffect, useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { holdAmbient } from "../../state/music";
import { partyCmd, serverNow, useGame } from "../../state/game";
import { DeckEngine } from "./deck/deckEngine";
import { DeckBar, DjConsole } from "./deck/DjConsole";
import { MusicController } from "./musicController";
import { usePartyGear } from "./PartyPanel";
import { resetPartyUi, usePartyUi } from "./partyUi";
import { easeGain, levelAtHeight, musicGain, musicSources } from "./spatialMix";

/**
 * Where the shared music plays on this screen: the DJ console (or, made small, a bar). The deck's built-in tracks
 * are made here in Web Audio; a YouTube video plays in YouTube's own player on the console's screen, which is up
 * only while the video plays and stays in view for as long as it does. Joining the music is a click (opening the
 * deck), which is also what lets the browser play sound. Leaving the house takes it all down.
 */
export function MusicDock() {
  const music = useGame((s) => s.life?.party?.music);
  const deck = useGame((s) => s.life?.party?.deck);
  const gear = usePartyGear();
  const { listening, volume, muted, fade, deckOpen } = usePartyUi(useShallow((s) => ({ listening: s.listening, volume: s.volume, muted: s.muted, fade: s.fade, deckOpen: s.deckOpen })));
  const host = useRef<HTMLDivElement | null>(null);
  const ctrl = useMemo(() => new MusicController(partyCmd), []);
  const engine = useMemo(() => new DeckEngine(serverNow), []);
  if (import.meta.env.DEV) Object.assign(window, { __music: ctrl, __deck: engine });

  const youtubeOn = Boolean(music?.current && music.playing);
  // YouTube's player is up while a video plays and this screen is listening, and only then; it has to be seen, so
  // the console opens for it
  const showYouTube = listening && youtubeOn;
  useEffect(() => {
    if (showYouTube && !deckOpen) usePartyUi.setState({ deckOpen: true });
  }, [showYouTube, deckOpen]);
  const playerShown = showYouTube && deckOpen;
  useEffect(() => {
    if (playerShown && host.current) void ctrl.attach(host.current, usePartyUi.getState().volume, usePartyUi.getState().muted);
    else ctrl.detach();
  }, [playerShown, ctrl]);
  useEffect(() => ctrl.follow(music), [music, ctrl]);
  useEffect(() => ctrl.setVolume(volume, muted), [volume, muted, ctrl]);

  // the deck's sound runs while this screen is listening
  useEffect(() => {
    if (listening) engine.start();
    else engine.stop();
  }, [listening, engine]);
  useEffect(() => engine.follow(deck), [deck, engine]);

  // the sound comes from the speakers: it's full beside them and fades as this player's character walks away
  const view = useGame((s) => s.view);
  const sources = useMemo(() => (view ? musicSources(view) : []), [view]);
  const audible = listening && (Boolean(deck?.playing) || playerShown);
  useEffect(() => {
    if (!audible) return;
    let gain = 1;
    const step = () => {
      const { me, life } = useGame.getState();
      const avatar = me && life ? Object.values(life.avatars).find((a) => a.memberId === me) : undefined;
      let target = 1;
      if (fade && avatar) {
        const at = positionAt(avatar, serverNow());
        target = musicGain(sources, at.x, at.z, levelAtHeight(at.y));
      }
      gain = easeGain(gain, target);
      ctrl.setMix(gain);
      engine.setOutput(muted ? 0 : volume / 100, gain);
    };
    step();
    const timer = setInterval(step, 250);
    return () => clearInterval(timer);
  }, [audible, fade, sources, ctrl, engine, muted, volume]);

  // the lo-fi background music steps aside while this screen plays the party's
  const playing = Boolean(listening && (youtubeOn || deck?.playing));
  useEffect(() => {
    holdAmbient(playing);
  }, [playing]);
  useEffect(
    () => () => {
      ctrl.detach();
      engine.stop();
      holdAmbient(false);
      resetPartyUi();
    },
    [ctrl, engine],
  );

  if (!gear.music && !music?.current && !deck?.playing) return null;
  if (!deckOpen) return <DeckBar deck={deck} music={music} listening={listening} />;
  return <DjConsole deck={deck} music={music} engine={engine} showYouTube={playerShown} ytHost={host} onEnableYouTube={() => ctrl.enable()} />;
}
