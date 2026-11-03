/** Object edits use a single unmodified keypress; browser shortcuts must never edit the house. */
type ShortcutEvent = Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "altKey" | "repeat" | "isComposing" | "defaultPrevented">;

export function allowsBuildShortcut(event: ShortcutEvent): boolean {
  return !event.metaKey && !event.ctrlKey && !event.altKey && !event.repeat && !event.isComposing && !event.defaultPrevented;
}
