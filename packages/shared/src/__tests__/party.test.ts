import { describe, expect, it } from "vitest";
import { emptyBlueprint, type Blueprint } from "../blueprint";
import { catalog } from "../catalog";
import { edgesBetween, type Rot } from "../grid";
import { Life } from "../life/engine";
import { slotsOf } from "../life/interactions";
import { buildNav, findPath, walkable } from "../life/nav";
import { needsAt, START_NEEDS } from "../life/needs";
import { activityAt, arrivalTime, emptyLife } from "../life/state";
import { Op } from "../ops";
import { applyParty, DANCE_IDS, emptyParty, isVideoId, MAX_QUEUE, musicPosition, parseYouTubeLink, partyGear, PartyCmd, PRESETS, restoredParty, savedParty, type PartyContext } from "../party";
import { applyOp } from "../rules";
import { withStarterHouse } from "../starter";

let n = 0;
const ids = () => `id${String(++n).padStart(8, "0")}`;
const apply = (bp: Blueprint, op: Op) => {
  const r = applyOp(bp, Op.parse(op));
  if (!r.ok) throw new Error(`rejected: ${r.reason}`);
  return r.blueprint;
};
const T0 = 1_000_000;

describe("YouTube links", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["http://youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&index=2", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?si=abc", "dQw4w9WgXcQ"],
    ["https://m.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://music.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/live/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["  dQw4w9WgXcQ  ", "dQw4w9WgXcQ"],
  ])("takes the video out of %s", (text, id) => {
    expect(parseYouTubeLink(text)?.videoId).toBe(id);
  });

  it("reads where a link starts", () => {
    expect(parseYouTubeLink("https://youtu.be/dQw4w9WgXcQ?t=90")?.start).toBe(90);
    expect(parseYouTubeLink("https://youtu.be/dQw4w9WgXcQ?t=1m30s")?.start).toBe(90);
    expect(parseYouTubeLink("https://www.youtube.com/watch?v=dQw4w9WgXcQ&start=12")?.start).toBe(12);
    expect(parseYouTubeLink("https://youtu.be/dQw4w9WgXcQ?t=0")?.start).toBeUndefined();
    expect(parseYouTubeLink("https://youtu.be/dQw4w9WgXcQ?t=junk")?.start).toBeUndefined();
  });

  it.each([
    "",
    "hello",
    "https://example.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/playlist?list=PLabc",
    "https://www.youtube.com/@somechannel",
    "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ<script>",
    "javascript:alert(1)",
    "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
    "x".repeat(400),
  ])("turns away %j", (text) => {
    expect(parseYouTubeLink(text)).toBeNull();
  });

  it("knows a video ID when it sees one", () => {
    expect(isVideoId("dQw4w9WgXcQ")).toBe(true);
    expect(isVideoId("dQw4w9WgXc")).toBe(false);
    expect(isVideoId("dQw4w9WgXc!")).toBe(false);
    expect(isVideoId(5)).toBe(false);
  });
});

describe("party commands", () => {
  const gear = { lights: true, music: true, dance: true, speaker: true };
  const ctx = (now: number, over: Partial<PartyContext> = {}): PartyContext => ({ memberId: "ana", now, newId: ids, gear, ...over });
  const run = (state = emptyLife(), cmd: PartyCmd, now: number, over: Partial<PartyContext> = {}) => ({ state, ...applyParty(state, PartyCmd.parse(cmd), ctx(now, over)) });
  const add = (state: ReturnType<typeof emptyLife>, videoId: string, now: number, extra: object = {}) => run(state, { cmd: "add", videoId, ...extra }, now);
  const A = "aaaaaaaaaaa";
  const B = "bbbbbbbbbbb";
  const C = "ccccccccccc";

  it("starts a video straight away when nothing is playing, and queues the rest", () => {
    const state = emptyLife();
    add(state, A, T0);
    expect(state.party!.music).toMatchObject({ current: { videoId: A, by: "ana" }, playing: true, queue: [] });
    expect(musicPosition(state.party!.music, T0 + 5000)).toBe(5000);
    add(state, B, T0 + 1000);
    add(state, C, T0 + 1000);
    expect(state.party!.music.queue.map((t) => t.videoId)).toEqual([B, C]);
    expect(state.party!.music.current!.videoId).toBe(A);
  });

  it("plays a video now, ahead of the queue, and starts a linked one where its link says", () => {
    const state = emptyLife();
    add(state, A, T0);
    add(state, B, T0);
    add(state, C, T0 + 2000, { now: true, start: 30 });
    expect(state.party!.music.current!.videoId).toBe(C);
    expect(state.party!.music.queue.map((t) => t.videoId)).toEqual([B]);
    expect(musicPosition(state.party!.music, T0 + 2000)).toBe(30_000);
  });

  it("pauses where it is and plays on from there", () => {
    const state = emptyLife();
    add(state, A, T0);
    run(state, { cmd: "pause" }, T0 + 4000);
    expect(state.party!.music).toMatchObject({ playing: false, at: 4000 });
    // time passes while paused: the position holds
    expect(musicPosition(state.party!.music, T0 + 99_000)).toBe(4000);
    run(state, { cmd: "play" }, T0 + 10_000);
    expect(musicPosition(state.party!.music, T0 + 12_000)).toBe(6000);
    // a second play, or pause, changes nothing
    expect(run(state, { cmd: "play" }, T0 + 12_000).changed).toBe(false);
    run(state, { cmd: "pause" }, T0 + 12_000);
    expect(run(state, { cmd: "pause" }, T0 + 13_000).changed).toBe(false);
  });

  it("seeks, playing or paused", () => {
    const state = emptyLife();
    add(state, A, T0);
    run(state, { cmd: "seek", ms: 60_000 }, T0 + 1000);
    expect(musicPosition(state.party!.music, T0 + 1000)).toBe(60_000);
    expect(musicPosition(state.party!.music, T0 + 3000)).toBe(62_000);
    run(state, { cmd: "pause" }, T0 + 3000);
    run(state, { cmd: "seek", ms: 5000 }, T0 + 4000);
    expect(musicPosition(state.party!.music, T0 + 90_000)).toBe(5000);
  });

  it("moves on once however many screens say the video ended", () => {
    const state = emptyLife();
    add(state, A, T0);
    add(state, B, T0);
    add(state, C, T0);
    const first = state.party!.music.current!.id;
    expect(run(state, { cmd: "ended", trackId: first }, T0 + 200_000).changed).toBe(true);
    expect(state.party!.music.current!.videoId).toBe(B);
    // the other screen's report of the same ending is stale, and doesn't skip another
    expect(run(state, { cmd: "ended", trackId: first }, T0 + 200_100).changed).toBe(false);
    expect(state.party!.music.current!.videoId).toBe(B);
    expect(musicPosition(state.party!.music, T0 + 201_000)).toBe(1000);
  });

  it("skips what YouTube won't play, once, and drops it from the queue if it's still waiting", () => {
    const state = emptyLife();
    add(state, A, T0);
    add(state, B, T0);
    const [a, b] = [state.party!.music.current!.id, state.party!.music.queue[0]!.id];
    run(state, { cmd: "error", trackId: b, code: 101 }, T0 + 100);
    expect(state.party!.music.queue).toEqual([]);
    run(state, { cmd: "error", trackId: a, code: 150 }, T0 + 200);
    expect(state.party!.music.current).toBeNull();
    expect(state.party!.music.playing).toBe(false);
    expect(run(state, { cmd: "error", trackId: a, code: 150 }, T0 + 300).changed).toBe(false);
  });

  it("skips with next (only the one that was playing, if the skipper says which), removes and clears", () => {
    const state = emptyLife();
    add(state, A, T0);
    add(state, B, T0);
    add(state, C, T0);
    const [a, b, c] = [state.party!.music.current!.id, state.party!.music.queue[0]!.id, state.party!.music.queue[1]!.id];
    run(state, { cmd: "next", trackId: a }, T0 + 10);
    expect(state.party!.music.current!.videoId).toBe(B);
    // two people pressing Next on the same song skip it once
    expect(run(state, { cmd: "next", trackId: a }, T0 + 20).changed).toBe(false);
    expect(state.party!.music.current!.videoId).toBe(B);
    run(state, { cmd: "remove", trackId: c }, T0 + 30);
    expect(state.party!.music.queue).toEqual([]);
    run(state, { cmd: "remove", trackId: b }, T0 + 40);
    expect(state.party!.music.current).toBeNull();
    add(state, A, T0 + 50);
    add(state, B, T0 + 50);
    run(state, { cmd: "clear" }, T0 + 60);
    expect(state.party!.music).toMatchObject({ queue: [], current: { videoId: A } });
  });

  it("keeps the queue to a sensible length", () => {
    const state = emptyLife();
    for (let i = 0; i < MAX_QUEUE; i++) expect(add(state, `video${String(i).padStart(6, "0")}`, T0).reject).toBeNull();
    expect(add(state, A, T0).reject).toBe("queue-full");
    expect(state.party!.music.queue.length + 1).toBe(MAX_QUEUE);
  });

  it("needs the right gear in the house", () => {
    const none = { lights: false, music: false, dance: false, speaker: false };
    expect(run(emptyLife(), { cmd: "lights", set: { on: true } }, T0, { gear: none }).reject).toBe("no-party-items");
    expect(run(emptyLife(), { cmd: "add", videoId: A }, T0, { gear: { ...none, lights: true } }).reject).toBe("no-music");
    expect(run(emptyLife(), { cmd: "lights", set: { on: true } }, T0, { gear: { ...none, dance: true } }).reject).toBeNull();
    expect(run(emptyLife(), { cmd: "lights", set: { on: true } }, T0, { gear: { ...none, speaker: true } }).reject).toBe("no-party-items");
  });

  it("sets the lights: a preset puts a single colour away, a colour leaves the preset", () => {
    const state = emptyLife();
    run(state, { cmd: "lights", set: { on: true, brightness: 0.5, color: "#ff3d9a" } }, T0);
    expect(state.party!.lights).toMatchObject({ on: true, brightness: 0.5, color: "#ff3d9a", preset: "neon" });
    run(state, { cmd: "lights", set: { preset: "sunset" } }, T0);
    expect(state.party!.lights).toMatchObject({ preset: "sunset", color: null });
    expect(run(state, { cmd: "lights", set: { preset: "sunset" } }, T0).changed).toBe(false);
    run(state, { cmd: "lights", set: { steady: true, spread: 0.3 } }, T0);
    expect(state.party!.lights).toMatchObject({ steady: true, spread: 0.3 });
  });

  it("refuses what isn't a real message", () => {
    for (const bad of [
      { cmd: "add", videoId: "not-an-id" },
      { cmd: "add", videoId: A, start: -1 },
      { cmd: "lights", set: { brightness: 5 } },
      { cmd: "lights", set: { preset: "nope" } },
      { cmd: "lights", set: { color: "red" } },
      { cmd: "lights", set: { on: true, sneaky: 1 } },
      { cmd: "seek", ms: -5 },
      { cmd: "seek", ms: 1e12 },
      { cmd: "ended" },
      { cmd: "reboot" },
    ])
      expect(PartyCmd.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });

  it("keeps lights and the queue between sessions, with the music waiting where it was", () => {
    const state = emptyLife();
    add(state, A, T0);
    add(state, B, T0);
    run(state, { cmd: "lights", set: { on: true, preset: "chill", steady: true } }, T0);
    const saved = savedParty(state.party!, T0 + 7000);
    expect(saved.music).toMatchObject({ playing: false, at: 7000, current: { videoId: A }, queue: [{ videoId: B }] });
    expect(saved.lights).toMatchObject({ on: true, preset: "chill", steady: true });
    const back = restoredParty(JSON.parse(JSON.stringify(saved)))!;
    expect(back).toEqual(saved);
  });

  it("makes sense of an old or damaged save", () => {
    expect(restoredParty(undefined)).toBeUndefined();
    const odd = restoredParty({ lights: { on: true } as never, music: { queue: [{ id: "x", videoId: "bad", by: "a" }, { id: "y", videoId: A, by: "a" }], current: { id: "z", videoId: "nope" } as never, playing: true, at: Number.NaN } })!;
    expect(odd.lights).toMatchObject({ on: true, preset: emptyParty().lights.preset });
    expect(odd.music).toMatchObject({ playing: false, current: null, at: 0 });
    expect(odd.music.queue.map((t) => t.videoId)).toEqual([A]);
  });

  it("has presets that never move faster than once in six seconds", () => {
    for (const p of PRESETS) {
      expect(p.period, p.id).toBeGreaterThanOrEqual(6);
      expect(5040 % p.period, `${p.id} divides the clock's wrap`).toBe(0);
      expect(p.palette.length).toBeGreaterThanOrEqual(3);
      expect(p.palette.length).toBeLessThanOrEqual(5);
    }
    expect(PRESETS.map((p) => p.name)).toEqual(expect.arrayContaining(["Sunset", "Neon", "Chill"]));
  });
});

describe("party gear", () => {
  it("finds what the house has, on any floor", () => {
    let bp = emptyBlueprint(12, 12);
    expect(partyGear(bp, catalog)).toEqual({ lights: false, music: false, dance: false, speaker: false });
    bp = apply(bp, { t: "object.place", level: 0, id: "spk0000001", catalogId: "party_speaker", x: 2, z: 2, rot: 0 });
    expect(partyGear(bp, catalog)).toMatchObject({ speaker: true, music: false, lights: false });
    bp = apply(bp, { t: "object.place", level: 0, id: "mus0000001", catalogId: "music_player_mint", x: 4, z: 2, rot: 0 });
    bp = apply(bp, { t: "object.place", level: 0, id: "til0000001", catalogId: "dance_tile", x: 6, z: 2, rot: 0 });
    expect(partyGear(bp, catalog)).toEqual({ lights: true, music: true, dance: true, speaker: true });
  });

  it("has a recognisable item for each thing asked for, in a few finishes, with search terms and a price", () => {
    const parties = [...catalog.furniture.values()].filter((i) => i.category === "party");
    const bases = parties.filter((i) => !i.variantOf);
    expect(bases.map((i) => i.id).sort()).toEqual(["dance_floor_2x2", "dance_tile", "disco_ball", "dj_booth", "laser_light", "led_strip", "moving_head", "music_player", "party_speaker"]);
    for (const base of bases) {
      expect(base.tags?.length, base.id).toBeGreaterThanOrEqual(5);
      expect(base.price, base.id).toBeGreaterThan(0);
      expect(base.party?.length, base.id).toBeGreaterThan(0);
      const finishes = parties.filter((i) => i.id === base.id || i.variantOf === base.id);
      expect(finishes.length, base.id).toBe(3);
      expect(new Set(finishes.map((f) => JSON.stringify(f.model))).size).toBe(3);
    }
    expect(new Set(bases.map((b) => b.model.kind)).size).toBe(bases.length - 1);
  });
});

/** A party house: gear in an open lot. */
function partyHouse() {
  const house = {
    bp: emptyBlueprint(16, 16),
    place(id: string, catalogId: string, x: number, z: number, rot: Rot = 0) {
      house.bp = apply(house.bp, { t: "object.place", level: 0, id, catalogId, x, z, rot });
    },
  };
  house.place("tile000001", "dance_tile", 4, 4);
  house.place("floor00001", "dance_floor_2x2", 6, 4);
  house.place("dj00000001", "dj_booth", 4, 8);
  return house;
}

describe("using party furniture", () => {
  const usable = [...catalog.furniture.values()].filter((i) => i.category === "party" && i.interactions?.length);

  it.each(usable.map((i) => [i.id, i] as const))("%s can be walked up to and used in every rotation", (_id, item) => {
    for (const rot of [0, 1, 2, 3] as Rot[]) {
      const bp = apply(emptyBlueprint(14, 14), { t: "object.place", level: 0, id: "piece00001", catalogId: item.id, x: 5, z: 5, rot });
      const o = bp.levels[0]!.objects.piece00001!;
      const nav = buildNav(bp);
      const slots = slotsOf(o);
      expect(slots.length).toBeGreaterThan(0);
      for (const s of slots) {
        const clear = s.stand.filter(([x, z]) => walkable(nav, x, z));
        expect(clear.length, `${item.id} rot ${rot} slot ${s.slot}`).toBeGreaterThan(0);
        expect(findPath(nav, [0, 0], clear)).not.toBeNull();
      }
    }
  });

  it("puts a DJ behind the booth facing it, or in front facing it from the other side", () => {
    const { bp } = partyHouse();
    const booth = bp.levels[0]!.objects.dj00000001!;
    const slots = slotsOf(booth, "dj");
    expect(slots).toHaveLength(3);
    // behind (north of) the booth at z 8, looking south at it; the third place is in front, looking north
    expect(slots[0]!.pose).toMatchObject({ face: 0 });
    expect(slots[0]!.pose.z).toBeLessThan(8);
    expect(slots[2]!.pose).toMatchObject({ face: 2 });
    expect(slots[2]!.pose.z).toBeGreaterThan(9);
  });

  it("lets dance floors and rugs go under furniture, and walks over them", () => {
    const house = partyHouse();
    // (a rug-layer item doesn't block, so a chair can stand on a tile)
    house.place("chair00001", "dining_chair", 4, 4);
    const nav = buildNav(house.bp);
    expect(walkable(nav, 6, 4)).toBe(true);
    expect(walkable(nav, 7, 5)).toBe(true);
  });
});

describe("dancing and the booth", () => {
  const dancers = (members = ["ana", "ben"]) => {
    const house = partyHouse();
    const life = new Life(emptyLife(), catalog, ids, () => 0.5);
    for (const m of members) life.ensureAvatar(m, house.bp, T0);
    return { bp: house.bp, house, life };
  };

  it("lets both players dance in place, each with a dance of their own, and change dance without moving", () => {
    const { bp, life } = dancers();
    expect(life.dance("ana", bp, null, "disco", T0)).toBeNull();
    expect(life.dance("ben", bp, null, "shuffle", T0)).toBeNull();
    const [ana, ben] = [life.state.avatars.ana!, life.state.avatars.ben!];
    expect(ana.use).toMatchObject({ action: "groove", move: "disco", objectId: null });
    expect(ben.use).toMatchObject({ action: "groove", move: "shuffle" });
    const where = JSON.stringify(ana.path);
    life.dance("ana", bp, null, "sway", T0 + 5000);
    expect(ana.use!.move).toBe("sway");
    expect(JSON.stringify(ana.path)).toBe(where);
    expect(activityAt(ana, T0 + 20_000)).toBe("groove");
  });

  it("offers every dance, and nothing it doesn't know", () => {
    const { bp, life } = dancers();
    expect(DANCE_IDS.length).toBeGreaterThanOrEqual(5);
    for (const move of DANCE_IDS) expect(life.dance("ana", bp, null, move, T0)).toBeNull();
    expect(life.dance("ana", bp, null, "moonwalk", T0)).toBe("nothing-to-do");
    expect(life.dance("ana", bp, "chair-nope", "bounce", T0)).toBe("nothing-to-do");
  });

  it("walks to a dance-floor tile to dance on it, one dancer to a tile", () => {
    const { bp, life } = dancers();
    expect(life.dance("ana", bp, "tile000001", "bounce", T0)).toBeNull();
    const ana = life.state.avatars.ana!;
    expect(ana.use).toMatchObject({ action: "groove", objectId: "tile000001", move: "bounce" });
    expect(ana.use!.pose).toMatchObject({ x: 4.5, z: 4.5 });
    expect(arrivalTime(ana)).toBeGreaterThan(T0);
    expect(life.dance("ben", bp, "tile000001", "sway", T0)).toBe("taken");
    // a four-cell panel has room for several
    expect(life.dance("ben", bp, "floor00001", "sway", T0)).toBeNull();
  });

  it("puts down a seat to dance, and the seat is free for the other", () => {
    const { house, life } = dancers();
    house.place("chair00001", "dining_chair", 10, 10);
    const bp = house.bp;
    expect(life.use("ana", bp, "chair00001", "sit", T0)).toBeNull();
    expect(life.use("ben", bp, "chair00001", "sit", T0)).toBe("taken");
    life.dance("ana", bp, null, "bounce", T0 + 60_000);
    expect(life.state.avatars.ana!.use?.action).toBe("groove");
    expect(life.use("ben", bp, "chair00001", "sit", T0 + 60_000)).toBeNull();
  });

  it("ends dancing when walking, sitting or using the booth, and the reverse", () => {
    const { house, life } = dancers(["ana"]);
    house.place("chair00001", "dining_chair", 10, 10);
    const bp = house.bp;
    life.dance("ana", bp, null, "bounce", T0);
    life.walk("ana", bp, [12, 12], T0 + 1000);
    expect(life.state.avatars.ana!.use).toBeNull();
    life.dance("ana", bp, null, "bounce", T0 + 20_000);
    life.use("ana", bp, "chair00001", "sit", T0 + 21_000);
    expect(life.state.avatars.ana!.use).toMatchObject({ action: "sit", objectId: "chair00001" });
    expect(life.state.avatars.ana!.use!.move).toBeUndefined();
    life.use("ana", bp, "dj00000001", "dj", T0 + 40_000);
    expect(life.state.avatars.ana!.use).toMatchObject({ action: "dj", objectId: "dj00000001" });
    life.dance("ana", bp, null, "disco", T0 + 60_000);
    expect(life.state.avatars.ana!.use).toMatchObject({ action: "groove", objectId: null });
  });

  it("lets both players work the booth at once (two behind it), and a third has to wait", () => {
    const { bp, life } = dancers(["ana", "ben", "cy"]);
    expect(life.use("ana", bp, "dj00000001", "dj", T0)).toBeNull();
    expect(life.use("ben", bp, "dj00000001", "dj", T0)).toBeNull();
    const slots = ["ana", "ben"].map((m) => life.state.avatars[m]!.use!.slot);
    expect(new Set(slots).size).toBe(2);
    expect(life.use("cy", bp, "dj00000001", "dj", T0)).toBeNull();
    expect(new Set(["ana", "ben", "cy"].map((m) => life.state.avatars[m]!.use!.slot)).size).toBe(3);
  });

  it("gives up the stove, the sink or the toilet to dance", () => {
    let { bp } = dancers(["ana"]);
    bp = withStarterHouse(emptyBlueprint(24, 20), ids);
    const life = new Life(emptyLife(), catalog, ids, () => 0.5);
    life.ensureAvatar("ana", bp, T0);
    expect(life.cook("ana", bp, [...catalog.recipes.keys()][0]!, null, T0)).toBeNull();
    const cooking = life.state.avatars.ana!.use!;
    expect(cooking.station).toBeDefined();
    // dancing ends the cook's turn at the stove, and the meal waits for someone to come back to it
    life.dance("ana", bp, null, "bounce", T0 + 30_000);
    life.tick(bp, T0 + 31_000);
    expect(life.state.avatars.ana!.use).toMatchObject({ action: "groove" });
    expect(life.state.avatars.ana!.use!.station).toBeUndefined();
    expect(life.state.cooking?.rate ?? 0).toBe(0);
    // and the toilet or the sink, which end by themselves, are left too
    life.use("ana", bp, [...Object.values(bp.levels[0]!.objects)].find((o) => o.catalogId === "toilet")!.id, "toilet", T0 + 100_000);
    life.dance("ana", bp, null, "sway", T0 + 100_500);
    expect(life.state.avatars.ana!.use).toMatchObject({ action: "groove", move: "sway" });
  });

  it("doesn't carry a dance in place through a save, but keeps the DJ at the booth", () => {
    const { bp, life } = dancers();
    life.dance("ana", bp, null, "bounce", T0);
    life.use("ben", bp, "dj00000001", "dj", T0);
    life.party("ana", bp, { cmd: "lights", set: { on: true, preset: "sunset" } }, T0);
    const saved = JSON.parse(JSON.stringify(life.saved(T0 + 10_000)));
    expect(saved.avatars.ana.use).toBeNull();
    expect(saved.avatars.ben.use).toMatchObject({ action: "dj" });
    expect(saved.party.lights).toMatchObject({ on: true, preset: "sunset" });
    const again = Life.restore(saved, T0 + 90_000);
    expect(again.state.party!.lights.on).toBe(true);
    expect(again.state.avatars.ben!.use).toMatchObject({ action: "dj" });
  });

  it("stops dancing for a dancer who leaves with a move that's no longer on offer", () => {
    const { bp, life } = dancers();
    life.dance("ana", bp, "tile000001", "bounce", T0);
    // the tile is taken away: they stop (as with any furniture that goes)
    const after = apply(bp, { t: "object.remove", level: 0, id: "tile000001" });
    life.onBlueprint(after, T0 + 5000);
    expect(life.state.avatars.ana!.use).toBeNull();
  });

  it("makes dancing good for fun and a bit tiring, and working the booth fun too", () => {
    const { bp, life } = dancers(["ana", "ben"]);
    const [a, b] = [life.state.avatars.ana!, life.state.avatars.ben!];
    for (const who of [a, b]) who.needs = { v: { ...START_NEEDS, fun: 20, energy: 90 }, at: T0, live: true };
    life.dance("ana", bp, null, "bounce", T0);
    life.use("ben", bp, "dj00000001", "dj", T0);
    const at = T0 + 90_000;
    const [ana, ben] = [needsAt(a, at), needsAt(b, at)];
    expect(ana.fun).toBeGreaterThan(50);
    expect(ana.energy).toBeLessThan(90 - 5);
    expect(ben.fun).toBeGreaterThan(20 + 15);
    expect(ana.fun).toBeGreaterThan(ben.fun);
  });
});
