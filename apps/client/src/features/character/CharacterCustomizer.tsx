import { useEffect, useRef, useState } from "react";
import { appearanceColors, changeGender, CLOTHING_COLORS, HAIR_COLORS, HAIRSTYLES, normalizeAppearance, OUTFITS, SKIN_TONES, type Appearance, type Gender } from "./appearance";
import { CharacterPreview } from "./CharacterPreview";
import { HairThumbnail } from "./HairThumbnail";
import "./character.css";

export interface CharacterCustomizerProps {
  value: Appearance;
  /** The caller owns persistence/networking. The editor never sends gameplay operations. */
  onSave: (value: Appearance) => void | Promise<void>;
  onCancel: () => void;
}
export function CharacterCustomizer({ value, onSave, onCancel }: CharacterCustomizerProps) {
  const [draft, setDraft] = useState(() => normalizeAppearance(value));
  const [busy, setBusy] = useState(false);
  const [section, setSection] = useState<"look" | "clothes">("look");
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const colors = appearanceColors(draft);
  useEffect(() => {
    const previous = document.activeElement;
    const node = dialog.current;
    if (node && !node.open) node.showModal();
    return () => { node?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  const update = <K extends keyof Appearance>(key: K, next: Appearance[K]) => setDraft((s) => ({ ...s, [key]: next }));
  const save = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try { await onSave(normalizeAppearance(draft)); }
    catch { setError("Your look couldn’t be saved. Try again; your choices are still here."); }
    finally { setBusy(false); }
  };
  return <dialog ref={dialog} className="character-editor" aria-labelledby="character-title" aria-busy={busy} onCancel={(e) => { e.preventDefault(); if (!busy) onCancel(); }} onKeyDown={(e) => e.stopPropagation()}>
    <header className="character-header">
      <div><div className="kicker">THE WARDROBE · HOME FOR TWO</div><h1 id="character-title">A little more <em>you.</em></h1><p>Find a look that feels like home.</p></div>
      <button className="btn character-close" type="button" aria-label="Close character customization" onClick={onCancel} disabled={busy}>×</button>
    </header>
    <div className="character-body" inert={busy || undefined}>
      <section className="character-preview-card" aria-label="Character preview">
        <span className="character-note">Looking good already.</span>
        <CharacterPreview appearance={draft} />
        <p className="character-cosmetic">Same adventures. A fresh look.</p>
      </section>
      <div className="character-options">
        <div className="character-section-tabs" aria-label="Customization sections">
          <button type="button" aria-pressed={section === "look"} onClick={() => setSection("look")}>Hair & skin</button>
          <button type="button" aria-pressed={section === "clothes"} onClick={() => setSection("clothes")}>Clothes</button>
        </div>
        {section === "look" && <>
        <fieldset><legend>Your style</legend><div className="character-segments">{(["guy", "girl"] as Gender[]).map((gender) => <button key={gender} type="button" aria-pressed={draft.gender === gender} onClick={() => setDraft((s) => changeGender(s, gender))}>{gender === "guy" ? "Guy" : "Girl"}</button>)}</div></fieldset>
        <Palette legend="Skin tone" options={SKIN_TONES} selected={draft.skinTone} onSelect={(id) => update("skinTone", id)} />
        <fieldset><legend>Hair <span>6 styles</span></legend><div className="character-hair-grid">{HAIRSTYLES[draft.gender].map((hair) => <button key={hair.id} type="button" aria-pressed={draft.hairstyle === hair.id} onClick={() => update("hairstyle", hair.id)}><HairThumbnail style={hair.id} skin={colors.skin} hair={colors.hair} /><span>{hair.name}</span></button>)}</div></fieldset>
        <Palette legend="Hair color" options={HAIR_COLORS} selected={draft.hairColor} onSelect={(id) => update("hairColor", id)} />
        </>}
        {section === "clothes" && <>
        <fieldset><legend>Outfit</legend><div className="character-outfits">{OUTFITS.map((o) => <button key={o.id} type="button" aria-pressed={draft.outfit === o.id} onClick={() => update("outfit", o.id)}><OutfitSketch outfit={o.id} tone={colors.bottom} /><span>{o.name}</span></button>)}</div></fieldset>
        <Palette legend="Shirt color" options={CLOTHING_COLORS} selected={draft.shirtColor} onSelect={(id) => update("shirtColor", id)} />
        <Palette legend="Bottom color" options={CLOTHING_COLORS} selected={draft.bottomColor} onSelect={(id) => update("bottomColor", id)} />
        </>}
      </div>
    </div>
    <footer className="character-footer">
      <p className={error ? "character-error" : "character-save-note"} role="status" aria-live="polite">{error || "Only your look changes. Your house stays just as you left it."}</p>
      <div><button className="btn" type="button" onClick={onCancel} disabled={busy}>Cancel</button><button className="btn primary" type="button" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save look"}<span aria-hidden="true"> ↗</span></button></div>
    </footer>
  </dialog>;
}

function OutfitSketch({ outfit, tone }: { outfit: Appearance["outfit"]; tone: string }) {
  const path = outfit === "skirt" ? "M20 10h24l11 43q-23 6-46 0z" : outfit === "shorts" ? "M18 10h28l4 33-16 1-2-15-2 15-16-1z" : "M18 10h28l2 46-14 1-2-29-2 29-14-1z";
  return <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false"><path d={path} fill={tone} fillOpacity=".7" stroke="#79634b" strokeWidth="1.3" strokeLinejoin="round" /><path d="M19 16h26M24 18l-3 10m19-10 3 10" fill="none" stroke="#79634b" strokeWidth="1" /><circle cx="32" cy="13" r="1" fill="#79634b" /></svg>;
}
function Palette<T extends string>({ legend, options, selected, onSelect }: { legend: string; options: readonly { id: T; name: string; color: string }[]; selected: T; onSelect: (id: T) => void }) {
  return <fieldset><legend>{legend}<span>{options.find((o) => o.id === selected)?.name}</span></legend><div className="character-palette">{options.map((o) => <button key={o.id} type="button" aria-label={`${legend}: ${o.name}`} aria-pressed={selected === o.id} title={o.name} style={{ backgroundColor: o.color }} onClick={() => onSelect(o.id)}>{selected === o.id && <span aria-hidden="true">✓</span>}</button>)}</div></fieldset>;
}
