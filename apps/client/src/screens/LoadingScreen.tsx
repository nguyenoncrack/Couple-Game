import type { ReactNode } from "react";
import { Cover, CoverTitle } from "./Cover";

/** Indeterminate activity follows actual loading; no invented percentages or minimum wait. */
export function LoadingScreen({ message = "Finding your keys…", detail = "A little moment before you’re home.", houseName, onBack, children, failed = false }: {
  message?: string; detail?: string; houseName?: string; onBack?: () => void; children?: ReactNode; failed?: boolean;
}) {
  return <Cover className="loading-cover">
    <div className="cover-content">
      <CoverTitle />
      <section className="arrival-card" aria-label={failed ? "Connection unavailable" : "Loading"}>
        <svg className={`arrival-key${failed ? " still" : ""}`} aria-hidden="true" width="64" height="45" viewBox="0 0 64 45" fill="none">
          <circle cx="18" cy="20" r="12" fill="#f2cf4a" stroke="currentColor" strokeWidth="2.5" />
          <circle cx="18" cy="20" r="4" stroke="currentColor" strokeWidth="2" />
          <path d="M30 20h28v9h-7v-5h-8v5h-6v-9" fill="#f2cf4a" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
        </svg>
        {houseName && <p className="kicker arrival-house">{houseName}</p>}
        <h2 role={failed ? "alert" : "status"} aria-live="polite">{message}</h2>
        <p className="arrival-detail">{detail}</p>
        {!failed && <div className="arrival-track" aria-hidden="true"><span /></div>}
        {children}
        {onBack && <button type="button" className="text-btn" onClick={onBack}>← Back to your houses</button>}
      </section>
      <p className="cover-footnote">Two people. One place to call home.</p>
    </div>
  </Cover>;
}
