import { act, createElement } from "react";
import { createRoot, extend, type RootStore } from "@react-three/fiber";
import * as THREE from "three";
import { STOREY, type Avatar } from "@cg/shared";
import { afterEach, expect, it, vi } from "vitest";
import { Characters } from "./Characters";

const fixture = vi.hoisted(() => ({
  now: 1000,
  game: {
    mode: "live", firstPerson: false, floor: 1, me: "amy",
    members: [{ id: "amy", name: "Amy", color: "#b86e50", online: true }],
    life: { avatars: {} as Record<string, Avatar> },
  },
  floors: [] as number[],
}));
vi.mock("../state/game", () => ({
  useGame: Object.assign((select: (s: typeof fixture.game) => unknown) => select(fixture.game), { getState: () => fixture.game }),
  serverNow: () => fixture.now,
  roofVisible: () => false,
  setFloor: (floor: number) => { fixture.floors.push(floor); fixture.game.floor = floor; },
}));
vi.mock("./CameraRig", () => ({ cameraFollow: { target: null, eye: null }, cameraGestureActive: () => false }));
vi.mock("./House", () => ({ FLOOR_Y: .04 }));
vi.mock("./KitMesh", () => ({ KitMesh: () => null }));
vi.mock("@react-three/drei", () => ({ Html: () => null }));
vi.mock("../ui/Needs", () => ({ NeedThought: () => null }));

extend({ Group: THREE.Group, Mesh: THREE.Mesh, RingGeometry: THREE.RingGeometry, MeshBasicMaterial: THREE.MeshBasicMaterial, CylinderGeometry: THREE.CylinderGeometry });
let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.unstubAllGlobals();
});
async function mount(avatar: Avatar) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", { setTimeout, clearTimeout, devicePixelRatio: 1 });
  fixture.now = 1000; fixture.game.floor = 1; fixture.floors = [];
  fixture.game.life.avatars = { amy: avatar };
  root = createRoot({ width: 800, height: 600 } as HTMLCanvasElement);
  await root.configure({
    frameloop: "never", dpr: 1, size: { width: 800, height: 600, top: 0, left: 0 },
    gl: { render() {}, setSize() {}, setPixelRatio() {}, domElement: { style: {} } } as unknown as THREE.WebGLRenderer,
  });
  let store!: RootStore;
  await act(async () => { store = root!.render(createElement(Characters)); });
  const frame = () => {
    const state = store.getState();
    state.internal.subscribers.forEach(({ ref }) => ref.current(state, 1 / 60));
  };
  const update = async (next: Avatar) => {
    fixture.game.life.avatars = { amy: next };
    await act(async () => { root!.render(createElement(Characters)); });
  };
  return { frame, update, character: store.getState().scene.children[0]! };
}

it("keeps upstairs height and view stable across successive click-to-walk updates", async () => {
  const avatar: Avatar = { memberId: "amy", path: [[2.5, 2.5, STOREY]], startedAt: 0, face: 0, use: null };
  const { frame, update, character } = await mount(avatar);
  frame(); fixture.floors = [];
  expect(character.position.y).toBeCloseTo(STOREY + .04);
  for (let i = 0; i < 6; i++) {
    await update({ ...avatar, path: [[2.5 + i * .2, 2.5, STOREY], [5.5, 2.5, STOREY]], startedAt: fixture.now });
    // Check both the React commit and its next animation frame: neither may reset to ground.
    expect(character.position.y).toBeCloseTo(STOREY + .04);
    frame(); fixture.now += 100;
    expect(character.position.y).toBeCloseTo(STOREY + .04);
    expect(fixture.game.floor).toBe(1);
  }
  expect(fixture.floors).not.toContain(0);
});

it("still follows real stair travel down and up rather than locking the view upstairs", async () => {
  const avatar: Avatar = { memberId: "amy", path: [[2.5, 2.5, STOREY]], startedAt: 0, face: 0, use: null };
  const { frame, update } = await mount(avatar);
  frame(); fixture.floors = [];
  await update({ ...avatar, path: [[2.5, 2.5, STOREY], [2.5, 5.5, 0]], startedAt: 1000 });
  for (fixture.now = 1000; fixture.now <= 5000; fixture.now += 16) frame();
  expect(fixture.game.floor).toBe(0);
  await update({ ...avatar, path: [[2.5, 5.5, 0], [2.5, 2.5, STOREY]], startedAt: 5000 });
  for (fixture.now = 5000; fixture.now <= 9000; fixture.now += 16) frame();
  expect(fixture.game.floor).toBe(1);
  expect(fixture.floors).toEqual([0, 1]);
});
