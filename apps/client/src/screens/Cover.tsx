import { useEffect, useRef, type ReactNode } from "react";

/** Shared illustrated shell; its artwork is decorative and all controls remain real HTML. */
export function Cover({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <main className={`cover ${className}`}>
    <div className="cover-art" aria-hidden="true" />
    <div className="cover-shade" aria-hidden="true" />
    {children}
    <p className="cover-note" aria-hidden="true">a little space for our favourite days.</p>
  </main>;
}

export function CoverTitle() {
  return <header className="cover-head">
    <p className="kicker">A little life, built together</p>
    <h1 className="wordmark">Home <span>for</span> Two</h1>
    <p className="tagline">Build a little house together,<br />from two screens.</p>
  </header>;
}

/** Native dialog provides keyboard focus containment, Escape and focus restoration. */
export function HomePanel({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      dialog?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return <dialog ref={ref} className="home-panel" aria-label={title} onCancel={(e) => { e.preventDefault(); onClose(); }}>
    <div className="home-panel-head">
      <h2>{title}</h2>
      <button type="button" className="panel-close" aria-label="Close panel" onClick={onClose}>×</button>
    </div>
    {children}
  </dialog>;
}
