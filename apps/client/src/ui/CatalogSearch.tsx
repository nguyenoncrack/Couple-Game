import { useRef } from "react";

export function CatalogSearch({ query, onChange, count }: { query: string; onChange: (query: string) => void; count: number }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="catalog-search">
      <label className="catalog-search-field">
        <span className="kicker">Find something</span>
        <input
          ref={input}
          type="search"
          aria-label="Search all furniture, doors and windows"
          placeholder="Search all items…"
          value={query}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              onChange("");
            }
          }}
        />
      </label>
      {query.length > 0 && (
        <button className="btn catalog-search-clear" aria-label="Clear catalog search" onClick={() => { onChange(""); input.current?.focus(); }}>
          Clear
        </button>
      )}
      <span className="catalog-search-count" role="status" aria-live="polite" aria-atomic="true">
        {query.trim() ? `${count} ${count === 1 ? "match" : "matches"} across all categories` : "Search across all categories"}
      </span>
    </div>
  );
}
