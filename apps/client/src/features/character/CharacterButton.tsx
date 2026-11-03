import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { normalizeAppearance, type Appearance } from "./appearance";
import { getAppearance, saveAppearance } from "../../net/api";
const Editor = lazy(() => import("./CharacterCustomizer").then((m) => ({ default: m.CharacterCustomizer })));

export function CharacterButton({ onSaved, compact = false, disabled = false }: { onSaved?: (appearance: Appearance) => void; compact?: boolean; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [initial, setInitial] = useState<Appearance | null>(null);
  const [failed, setFailed] = useState(false);
  const request = useRef(0);
  useEffect(() => () => { request.current++; }, []);
  const close = () => { request.current++; setOpen(false); };
  const begin = async () => {
    const id = ++request.current;
    setInitial(null); setFailed(false); setOpen(true);
    try {
      const saved = await getAppearance();
      if (id === request.current) setInitial(normalizeAppearance(saved.appearance));
    } catch { if (id === request.current) setFailed(true); }
  };
  return <>
    <button type="button" className={compact ? "pill icon-pill" : "btn"} aria-label="Customize character" title="Customize character" disabled={disabled} onClick={() => void begin()}>
      {compact ? <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="12" cy="7.5" r="4"/><path d="M4.5 21v-2a7.5 7.5 0 0 1 15 0v2M8 5c3 1 5 1 8 0"/></svg> : "My character"}
    </button>
    {open && <WardrobeBoundary onClose={close}>{failed ? <WardrobeNotice failed onClose={close} /> : !initial ? <WardrobeNotice onClose={close} /> : <Suspense fallback={<WardrobeNotice onClose={close} />}>
      <Editor value={initial} onCancel={close} onSave={async (draft) => {
        const saved = await saveAppearance(draft);
        onSaved?.(saved.appearance);
        close();
      }} />
    </Suspense>}</WardrobeBoundary>}
  </>;
}

class WardrobeBoundary extends Component<{ children: ReactNode; onClose: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <WardrobeNotice failed onClose={this.props.onClose} /> : this.props.children; }
}
function WardrobeNotice({ failed = false, onClose }: { failed?: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={dialog} className="card" aria-label={failed ? "Wardrobe unavailable" : "Opening wardrobe"} onKeyDown={(e) => e.stopPropagation()} onCancel={(e) => { e.preventDefault(); onClose(); }} style={{ width: "min(360px, calc(100vw - 40px))", padding: 24, pointerEvents: "auto" }}>
    <p role={failed ? "alert" : "status"}>{failed ? "The wardrobe couldn’t open. Close this panel and refresh the page before trying again." : "Opening your wardrobe…"}</p>
    <button className="btn" type="button" onClick={onClose}>{failed ? "Close" : "Cancel"}</button>
  </dialog>;
}
