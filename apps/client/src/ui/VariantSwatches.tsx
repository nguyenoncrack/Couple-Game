import { catalog, swatchOf, variantsOf, type FurnitureItem } from "@cg/shared";
import type { CatalogEntry } from "./filterCatalog";
import "./variants.css";

/**
 * Colours of one catalog item: the Buy panel shows an item once, with a row of swatches to pick its colour from.
 */

/** The family an entry belongs to: the item its colours are colours of (doors and windows are their own). */
export const familyOf = (i: CatalogEntry) => ("variantOf" in i && i.variantOf) || i.id;

/** Entries gathered by family, each family where its first entry was, keeping the order they came in. */
export function groupVariants<T extends CatalogEntry>(items: readonly T[]): T[][] {
  const out = new Map<string, T[]>();
  for (const i of items) {
    const f = familyOf(i);
    const group = out.get(f);
    if (group) group.push(i);
    else out.set(f, [i]);
  }
  return [...out.values()];
}

/** The colours to pick from for an item (none if it only comes in the one). */
export function colorsOf(id: string): FurnitureItem[] {
  const all = variantsOf(catalog, id);
  return all.length > 1 ? all : [];
}

export function VariantSwatches({ id, onPick }: { id: string; onPick: (id: string) => void }) {
  const colors = colorsOf(id);
  if (!colors.length) return null;
  return (
    <div className="variant-swatches" role="group" aria-label="Colours">
      {colors.map((v) => (
        <button
          key={v.id}
          className={`variant-swatch ${v.id === id ? "active" : ""}`}
          style={{ background: swatchOf(catalog, v) }}
          title={`${v.name} · ${v.price.toLocaleString()} coins`}
          aria-label={v.name}
          aria-pressed={v.id === id}
          onClick={() => onPick(v.id)}
        />
      ))}
    </div>
  );
}
