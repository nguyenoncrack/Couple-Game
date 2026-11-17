import { describe, expect, it } from "vitest";
import { parseClock, preciseClock, secondsToBeats } from "./deckTime";

describe("typed times", () => {
  it("reads m:ss with tenths, plain seconds and h:mm:ss", () => {
    expect(parseClock("1:24.5")).toBe(84.5);
    expect(parseClock(" 84,5 ")).toBe(84.5);
    expect(parseClock("2:45")).toBe(165);
    expect(parseClock("1:02:03")).toBe(3723);
    expect(parseClock("1:02:03.25")).toBe(3723.25);
  });

  it("refuses what isn't a time", () => {
    for (const t of ["", "abc", "1:60", "1:2:3:4", "-5", "1:75:00", "1.2.3"]) expect(parseClock(t)).toBeNull();
  });

  it("shows tenths only when there are some", () => {
    expect(preciseClock(secondsToBeats(84.5))).toBe("1:24.5");
    expect(preciseClock(secondsToBeats(165))).toBe("2:45");
    expect(preciseClock(secondsToBeats(3723))).toBe("1:02:03");
  });
});
