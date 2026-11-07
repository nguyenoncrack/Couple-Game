import { catalog, emptyFort, findFrame, hasFairyLights, NAME_MAX, PATTERNS, SIGN_MAX } from "@cg/shared";
import { useEffect, useMemo, useState } from "react";
import { patternDataUrl } from "../../render/fort/fortMaterials";
import { act, fortCmd, useGame } from "../../state/game";
import { Floating } from "../../ui/Floating";
import { closeFort, useFortUi } from "./fortUi";
import "./fort.css";

/**
 * A fort's panel (either player can use it): the blanket pattern, its name, the note at the door and the fairy
 * lights. Changes go to the house, so both players see them; the server checks the fort is there and has lights
 * before it lets them be switched on. Also, while you're inside one, a small bar to switch the lights or leave.
 */

export function FortHud() {
  return (
    <>
      <InsideBar />
      <FortPanel />
    </>
  );
}

/** The fort I'm in, if I'm in one. */
function useMyFort() {
  return useGame((s) => {
    const u = s.me ? s.life?.avatars[s.me]?.use : undefined;
    return u?.action === "fort" && u.objectId ? u.objectId : null;
  });
}

function useLights(id: string) {
  const view = useGame((s) => s.view);
  const lit = useGame((s) => Boolean(s.life?.forts?.[id]?.lit));
  const found = view ? findFrame(view, id, catalog) : null;
  const hung = found ? hasFairyLights(view!.levels[found.level]!, found.o, catalog) : false;
  return { lit, hung };
}

function InsideBar() {
  const id = useMyFort();
  const name = useGame((s) => (id ? s.life?.forts?.[id]?.name : "") ?? "");
  const panel = useFortUi((s) => s.open);
  const { lit, hung } = useLights(id ?? "");
  if (!id || panel) return null;
  return (
    <div className="fort-bar" role="group" aria-label="In the fort">
      <span className="fort-bar-title">{name ? `In ${name}` : "In the fort"}</span>
      <button className="btn" onClick={() => fortCmd(id, { lit: !lit })} aria-pressed={lit} title={hung ? undefined : "Hang some fairy lights on the fort first"}>
        Fairy lights: {lit ? "on" : "off"}
      </button>
      <button className="btn" onClick={() => useFortUi.setState({ open: id })}>
        Decorate…
      </button>
      <button className="btn primary" onClick={() => act({ do: "stop" })}>
        Leave fort
      </button>
    </div>
  );
}

/** A text box that follows the house's text until you type, and sends it when you pause or leave it. */
function TextField({ label, value, max, placeholder, onCommit }: { label: string; value: string; max: number; placeholder: string; onCommit: (text: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => setDraft(null), [value]);
  const send = (text: string) => {
    if (text !== value) onCommit(text);
  };
  useEffect(() => {
    if (draft === null) return;
    const t = setTimeout(() => send(draft), 600);
    return () => clearTimeout(t);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <label className="fort-field">
      <span className="party-label">{label}</span>
      <input
        value={draft ?? value}
        maxLength={max}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== null && send(draft)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        autoComplete="off"
        spellCheck={false}
      />
    </label>
  );
}

function FortPanel() {
  const id = useFortUi((s) => s.open);
  const exists = useGame((s) => Boolean(id && s.view && findFrame(s.view, id, catalog)));
  const fort = useGame((s) => (id ? s.life?.forts?.[id] : undefined)) ?? emptyFort();
  const { lit, hung } = useLights(id ?? "");
  const swatches = useMemo(() => PATTERNS.map((p) => ({ ...p, url: patternDataUrl(p.id) })), []);
  useEffect(() => {
    // the fort was sold or taken away while its panel was open
    if (id && !exists) closeFort();
  }, [id, exists]);
  if (!id || !exists) return null;
  return (
    <Floating id="fort" title="Blanket fort" className="fort-panel">
      <div className="fort-tab">
        <div className="party-label">Blanket</div>
        <div className="fort-patterns" role="radiogroup" aria-label="Blanket pattern">
          {swatches.map((p) => (
            <button key={p.id} role="radio" aria-checked={fort.pattern === p.id} className={`fort-pattern ${fort.pattern === p.id ? "active" : ""}`} onClick={() => fortCmd(id, { pattern: p.id })}>
              <span className="fort-swatch" style={{ backgroundImage: `url(${p.url})` }} />
              {p.name}
            </button>
          ))}
        </div>
        <TextField label="Fort name" value={fort.name} max={NAME_MAX} placeholder="Name your fort" onCommit={(name) => fortCmd(id, { name })} />
        <TextField label="Note on the door" value={fort.sign} max={SIGN_MAX} placeholder="A little handwritten sign" onCommit={(sign) => fortCmd(id, { sign })} />
        <label className="party-row party-switch">
          <input type="checkbox" checked={lit} disabled={!hung && !lit} onChange={(e) => fortCmd(id, { lit: e.target.checked })} />
          <span>Fairy lights {lit ? "on" : "off"}</span>
        </label>
        {!hung && <p className="hint">Hang a string of fairy lights on the fort to switch them on.</p>}
        <button className="btn fort-close" onClick={closeFort}>
          Close
        </button>
      </div>
    </Floating>
  );
}
