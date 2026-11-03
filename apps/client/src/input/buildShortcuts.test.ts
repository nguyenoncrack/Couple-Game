import { describe, expect, it } from "vitest";
import { allowsBuildShortcut } from "./buildShortcuts";

const plain = { metaKey: false, ctrlKey: false, altKey: false, repeat: false, isComposing: false, defaultPrevented: false };

describe("object editing shortcuts", () => {
  it("allows ordinary rotate, delete and escape keypresses", () => {
    expect(allowsBuildShortcut(plain)).toBe(true);
  });
  it.each(["metaKey", "ctrlKey", "altKey"] as const)("leaves %s combinations to the browser and other controls", (modifier) => {
    expect(allowsBuildShortcut({ ...plain, [modifier]: true })).toBe(false);
  });
  it("does not repeat an edit while the key is held", () => {
    expect(allowsBuildShortcut({ ...plain, repeat: true })).toBe(false);
  });
  it("does not edit during text composition", () => {
    expect(allowsBuildShortcut({ ...plain, isComposing: true })).toBe(false);
  });
  it("respects a keypress already handled by another control", () => {
    expect(allowsBuildShortcut({ ...plain, defaultPrevented: true })).toBe(false);
  });
});
