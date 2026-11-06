import { catalog, DANCES, DEFAULT_LIGHTS, musicPosition, parseYouTubeLink, partyGear, PARTY_COLORS, PRESETS, watchUrl, type PartyLights, type PartyRole } from "@cg/shared";
import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { steadyFor } from "../../render/party/partyMaterials";
import { act, partyCmd, serverNow, useGame } from "../../state/game";
import { Floating } from "../../ui/Floating";
import { closeParty, openParty, setMusicPrefs, usePartyUi } from "./partyUi";
import "./party.css";

/**
 * The party panel: lights, dances and the shared music queue, in one compact card. Anyone in the house can use
 * it; the server checks every request. The video player itself lives in the dock (MusicDock), because YouTube's
 * player has to stay in view while it plays.
 */

const NONE: Record<PartyRole, boolean> = { lights: false, music: false, dance: false, speaker: false };

/** What party gear the house has (the panel and its button only show up when there's some). */
export function usePartyGear(): Record<PartyRole, boolean> {
  return useGame(useShallow((s) => (s.view ? partyGear(s.view, catalog) : NONE)));
}

export function PartyHud() {
  const gear = usePartyGear();
  const any = Object.values(gear).some(Boolean);
  const open = usePartyUi((s) => s.open);
  useEffect(() => {
    // no gear left (it was all taken away): put the panel away
    if (!any && open) closeParty();
  }, [any, open]);
  if (!any) return null;
  return open ? <PartyPanel gear={gear} /> : <PartyButton />;
}

function PartyButton() {
  const on = useGame((s) => Boolean(s.life?.party?.lights.on));
  return (
    <button className={`pill party-button ${on ? "on" : ""}`} onClick={() => openParty()} title="Party lights, dancing and music">
      <span aria-hidden>♪</span> Party
    </button>
  );
}

/** A value that follows the house's while untouched, and moves at once under a hand, sending now and then. */
function useSlider(value: number, commit: (v: number) => void, ms = 160) {
  const [local, setLocal] = useState<number | null>(null);
  const latest = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  useEffect(() => setLocal(null), [value]);
  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    commit(latest.current);
  };
  return {
    value: local ?? value,
    onChange: (v: number) => {
      latest.current = v;
      setLocal(v);
      timer.current ??= setTimeout(flush, ms);
    },
    onRelease: () => {
      if (local !== null) flush();
    },
  };
}

function PartyPanel({ gear }: { gear: Record<PartyRole, boolean> }) {
  const tab = usePartyUi((s) => s.tab);
  const tabs = [
    { id: "lights", label: "Lights" },
    { id: "dance", label: "Dance" },
    { id: "music", label: "Music" },
  ] as const;
  return (
    <Floating id="party" title="Party" className="party-panel">
      <div className="tabs party-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab ${tab === t.id ? "active" : ""}`} onClick={() => openParty(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "lights" && <LightsTab />}
      {tab === "dance" && <DanceTab gear={gear} />}
      {tab === "music" && <MusicTab gear={gear} />}
      <button className="btn party-close" onClick={closeParty}>
        Close
      </button>
    </Floating>
  );
}

const setLights = (set: Partial<PartyLights>) => partyCmd({ cmd: "lights", set });

function LightsTab() {
  const lights = useGame((s) => s.life?.party?.lights ?? DEFAULT_LIGHTS);
  const brightness = useSlider(lights.brightness, (v) => setLights({ brightness: v }));
  const spread = useSlider(lights.spread, (v) => setLights({ spread: v }));
  const forced = steadyFor({ steady: false });
  return (
    <div className="party-tab">
      <label className="party-row party-switch">
        <input type="checkbox" checked={lights.on} onChange={(e) => setLights({ on: e.target.checked })} />
        <span>Lights {lights.on ? "on" : "off"}</span>
      </label>
      <label className="party-row">
        <span>Brightness</span>
        <input
          type="range"
          min={10}
          max={100}
          step={5}
          value={Math.round(brightness.value * 100)}
          onChange={(e) => brightness.onChange(Number(e.target.value) / 100)}
          onPointerUp={brightness.onRelease}
          onKeyUp={brightness.onRelease}
          onBlur={brightness.onRelease}
        />
      </label>
      <div className="party-label">Look</div>
      <div className="party-presets">
        {PRESETS.map((p) => (
          <button key={p.id} className={`party-preset ${lights.preset === p.id && !lights.color ? "active" : ""}`} onClick={() => setLights({ preset: p.id })} aria-pressed={lights.preset === p.id && !lights.color}>
            <span className="party-preset-bar" style={{ background: `linear-gradient(90deg, ${p.palette.join(", ")})` }} />
            {p.name}
          </button>
        ))}
      </div>
      <div className="party-label">One colour</div>
      <div className="party-colors">
        {PARTY_COLORS.map((c) => (
          <button key={c.color} className={`party-color ${lights.color === c.color ? "active" : ""}`} style={{ background: c.color }} title={c.name} aria-label={c.name} aria-pressed={lights.color === c.color} onClick={() => setLights({ color: lights.color === c.color ? null : c.color })} />
        ))}
      </div>
      <label className="party-row party-switch">
        <input type="checkbox" checked={lights.steady || forced} disabled={forced} onChange={(e) => setLights({ steady: e.target.checked })} />
        <span>Steady light{forced ? " (your device asks for less motion)" : ""}</span>
      </label>
      <label className="party-row">
        <span>Laser spread</span>
        <input type="range" min={20} max={100} step={5} value={Math.round(spread.value * 100)} onChange={(e) => spread.onChange(Number(e.target.value) / 100)} onPointerUp={spread.onRelease} onKeyUp={spread.onRelease} onBlur={spread.onRelease} />
      </label>
      <p className="hint party-note">Colours drift slowly and nothing flashes. The lights follow a gentle schedule, not the sound.</p>
    </div>
  );
}

function DanceTab({ gear }: { gear: Record<PartyRole, boolean> }) {
  const mine = useGame((s) => (s.me ? s.life?.avatars[s.me]?.use : null));
  const dancing = mine?.action === "groove";
  return (
    <div className="party-tab">
      <div className="party-label">Dance where you are</div>
      <div className="party-dances">
        {DANCES.map((d) => (
          <button key={d.id} className={`btn party-dance ${dancing && mine?.move === d.id ? "primary" : ""}`} onClick={() => act({ do: "dance", objectId: null, move: d.id })}>
            {d.name}
          </button>
        ))}
      </div>
      {dancing && (
        <button className="btn" onClick={() => act({ do: "stop" })}>
          Stop dancing
        </button>
      )}
      <p className="hint party-note">{gear.dance ? "Click a dance-floor tile in Live mode to dance on it." : "Dance tiles make a floor to dance on."} Walking anywhere or starting something else stops the dance.</p>
    </div>
  );
}

function MusicTab({ gear }: { gear: Record<PartyRole, boolean> }) {
  const music = useGame((s) => s.life?.party?.music);
  const members = useGame((s) => s.members);
  const { listening, status, message, volume, muted } = usePartyUi();
  const [link, setLink] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const who = (id: string) => members.find((m) => m.id === id)?.name ?? "someone";

  const add = (now: boolean) => {
    const parsed = parseYouTubeLink(link);
    if (!parsed) {
      setProblem("That isn't a link to one YouTube video. Paste a video link (playlists and channels can't be played).");
      return;
    }
    setProblem(null);
    setLink("");
    partyCmd({ cmd: "add", videoId: parsed.videoId, ...(parsed.start ? { start: parsed.start } : {}), ...(now ? { now: true } : {}) });
  };
  const nudge = (sec: number) => music?.current && partyCmd({ cmd: "seek", ms: Math.max(0, Math.round(musicPosition(music, serverNow()) + sec * 1000)) });

  return (
    <div className="party-tab">
      {!gear.music && <p className="hint party-note">Place a music player or a DJ booth to play music here.</p>}
      <div className="party-listen">
        {listening ? (
          <>
            <span className={`party-status ${status}`}>{statusText(status)}</span>
            <button className="btn" onClick={() => usePartyUi.setState({ listening: false })}>
              Leave the music
            </button>
          </>
        ) : (
          <button className="btn primary" onClick={() => usePartyUi.setState({ listening: true })} disabled={!music?.current}>
            Enable music
          </button>
        )}
      </div>
      {message && <p className="party-problem">{message}</p>}
      <label className="party-row">
        <span>Volume (just you)</span>
        <input type="range" min={0} max={100} value={volume} onChange={(e) => setMusicPrefs({ volume: Number(e.target.value) })} />
      </label>
      <label className="party-row party-switch">
        <input type="checkbox" checked={muted} onChange={(e) => setMusicPrefs({ muted: e.target.checked })} />
        <span>Mute (just you)</span>
      </label>
      <form
        className="party-add"
        onSubmit={(e) => {
          e.preventDefault();
          add(false);
        }}
      >
        <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste a YouTube link" aria-label="YouTube link" disabled={!gear.music} />
        <button className="btn" type="submit" disabled={!gear.music || !link.trim()}>
          Add
        </button>
        <button className="btn primary" type="button" disabled={!gear.music || !link.trim()} onClick={() => add(true)}>
          Play now
        </button>
      </form>
      {problem && <p className="party-problem">{problem}</p>}
      {music?.current && (
        <div className="party-now">
          <Thumb id={music.current.videoId} />
          <div className="party-now-body">
            <div className="kicker">{music.playing ? "Now playing" : "Paused"}</div>
            <a href={watchUrl(music.current.videoId)} target="_blank" rel="noopener">
              Open on YouTube
            </a>
            <span className="party-by">added by {who(music.current.by)}</span>
          </div>
          <div className="party-transport">
            <button className="btn" onClick={() => nudge(-10)} aria-label="Back 10 seconds">
              −10s
            </button>
            <button className="btn primary" onClick={() => partyCmd({ cmd: music.playing ? "pause" : "play" })}>
              {music.playing ? "Pause" : "Play"}
            </button>
            <button className="btn" onClick={() => nudge(10)} aria-label="Forward 10 seconds">
              +10s
            </button>
            <button className="btn" onClick={() => partyCmd({ cmd: "next", trackId: music.current!.id })}>
              Next
            </button>
          </div>
        </div>
      )}
      {music && music.queue.length > 0 && (
        <ol className="party-queue" aria-label="Up next">
          {music.queue.map((t) => (
            <li key={t.id}>
              <Thumb id={t.videoId} small />
              <span className="party-queue-text">
                <a href={watchUrl(t.videoId)} target="_blank" rel="noopener">
                  {t.videoId}
                </a>
                <span className="party-by">{who(t.by)}</span>
              </span>
              <button className="btn party-x" onClick={() => partyCmd({ cmd: "remove", trackId: t.id })} aria-label="Remove from the queue">
                ✕
              </button>
            </li>
          ))}
        </ol>
      )}
      <p className="hint party-note">Videos play in YouTube's own player, which stays on screen while it plays. Everyone hears the same thing at the same point. Lights don't react to the sound.</p>
    </div>
  );
}

/** A video's own thumbnail, from YouTube. */
function Thumb({ id, small }: { id: string; small?: boolean }) {
  return <img className={`party-thumb ${small ? "small" : ""}`} src={`https://i.ytimg.com/vi/${id}/mqdefault.jpg`} alt="" loading="lazy" draggable={false} />;
}

export function statusText(status: string) {
  switch (status) {
    case "loading":
      return "Starting…";
    case "buffering":
      return "Buffering…";
    case "playing":
      return "Playing";
    case "paused":
      return "Paused";
    case "blocked":
      return "Playing without sound: click Enable music, or the speaker on the video";
    case "error":
      return "Can't play that one";
    default:
      return "Ready";
  }
}
