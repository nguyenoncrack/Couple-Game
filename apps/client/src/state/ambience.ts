/**
 * Quiet country sounds under the music: a faint breeze that swells and drops, and now and then a bird calling
 * from somewhere off to one side. Everything is made in Web Audio, so there's nothing to download, and it comes
 * and goes with the game's Sound switch, fading rather than cutting (the rain has its own switch too).
 */

const LEVEL = 0.9;
const FADE_S = 1.5;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let breeze: { source: AudioBufferSourceNode; lfo: OscillatorNode } | null = null;
let timer = 0;
let running = false;
/** The rain layer's nodes, made when the country sounds start (and thrown away when they stop). */
let rainLayer: { source: AudioBufferSourceNode; low: BiquadFilterNode; high: BiquadFilterNode; level: GainNode } | null = null;
/** What the weather wants: how hard it's raining (0..1) and whether the listener is indoors (0 outside, 1 inside). */
let rainWant = { level: 0, indoors: 0 };
/** The player's Rain switch. */
let rainOn = true;

/** Switch the rain's sound on or off (it fades). */
export function setAmbienceRain(on: boolean) {
  if (on === rainOn) return;
  rainOn = on;
  applyRain();
}

export function startAmbience() {
  if (running) {
    // (made before a click, it may still be waiting for one)
    if (ctx?.state === "suspended") void ctx.resume().catch(() => {});
    return;
  }
  try {
    ctx ??= new AudioContext();
  } catch {
    return; // no Web Audio here: the music plays alone
  }
  const c = ctx;
  void c.resume().catch(() => {});
  running = true;
  master = c.createGain();
  master.gain.value = 0;
  master.gain.linearRampToValueAtTime(LEVEL, c.currentTime + FADE_S);
  master.connect(c.destination);
  breeze = startBreeze(c, master);
  applyRain();
  timer = window.setTimeout(birdsong, 2500 + Math.random() * 4000);
}

export function stopAmbience() {
  if (!running || !ctx || !master) return;
  running = false;
  window.clearTimeout(timer);
  const c = ctx;
  const m = master;
  const b = breeze;
  m.gain.cancelScheduledValues(c.currentTime);
  m.gain.setValueAtTime(m.gain.value, c.currentTime);
  m.gain.linearRampToValueAtTime(0, c.currentTime + FADE_S);
  window.setTimeout(() => {
    b?.source.stop();
    b?.lfo.stop();
    m.disconnect();
  }, FADE_S * 1000 + 100);
  master = null;
  breeze = null;
  const r = rainLayer;
  rainLayer = null;
  window.setTimeout(() => r?.source.stop(), FADE_S * 1000 + 100);
}

/** Rain on a roof outdoors is bright hiss; heard from inside it's a soft, low patter. These are how far each goes. */
const RAIN_OUTDOORS_HZ = 9000;
const RAIN_INDOORS_HZ = 620;
const RAIN_LEVEL = 0.34;
/** Indoors the rain is also quieter: this much of the outdoor level is left. */
const RAIN_INDOOR_GAIN = 0.4;

/**
 * Rain, as it sounds where the listener is. `level` is how hard it's raining and `indoors` how much it's heard through
 * a roof and walls (1 inside): the same noise, but filtered down to a soft low patter and turned down. Eased over
 * about half a second, so walking through a door fades rather than clicks. It only sounds while the country sounds do
 * (the same switch as the music); the latest values are kept and applied when they start.
 */
export function setRainSound(level: number, indoors: number) {
  rainWant = { level, indoors };
  applyRain();
}

function startRain(c: AudioContext, out: AudioNode) {
  const seconds = 3;
  const buffer = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate);
  const data = buffer.getChannelData(0);
  // white noise with a little pink in it: lots of tiny drops
  let pink = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    pink = pink * 0.94 + white * 0.06;
    data[i] = white * 0.55 + pink * 1.6;
  }
  const source = c.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  const high = c.createBiquadFilter();
  high.type = "highpass";
  high.frequency.value = 380;
  const low = c.createBiquadFilter();
  low.type = "lowpass";
  low.frequency.value = RAIN_OUTDOORS_HZ;
  const level = c.createGain();
  level.gain.value = 0;
  source.connect(high).connect(low).connect(level).connect(out);
  source.start();
  return { source, low, high, level };
}

function applyRain() {
  if (!running || !ctx || !master) return;
  const c = ctx;
  if (!rainLayer) {
    if (rainWant.level <= 0.01 || !rainOn) return;
    rainLayer = startRain(c, master);
  }
  const { level, indoors } = rainWant;
  const r = rainLayer;
  const gain = rainOn ? RAIN_LEVEL * level * (1 - (1 - RAIN_INDOOR_GAIN) * indoors) : 0;
  // geometric blend between the bright and the muffled cutoff
  const hz = RAIN_OUTDOORS_HZ * Math.pow(RAIN_INDOORS_HZ / RAIN_OUTDOORS_HZ, indoors);
  r.level.gain.setTargetAtTime(gain, c.currentTime, 0.5);
  r.low.frequency.setTargetAtTime(hz, c.currentTime, 0.3);
  r.high.frequency.setTargetAtTime(380 - 220 * indoors, c.currentTime, 0.3);
}

if (import.meta.env.DEV) {
  Object.assign(window, {
    /** What the rain sounds like right now: whether the layer's running, and its level and cutoff (development only). */
    __rainSound: () => ({ running, rainOn, want: rainWant, gain: rainLayer?.level.gain.value ?? null, cutoff: rainLayer?.low.frequency.value ?? null, state: ctx?.state ?? null }),
  });
}

/** Soft noise in the low middle, its loudness drifting slowly up and down like gusts in the trees. */
function startBreeze(c: AudioContext, out: AudioNode) {
  const seconds = 4;
  const buffer = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate);
  const data = buffer.getChannelData(0);
  // brownish noise: each sample wanders from the last, which is softer on the ear than white noise
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    last = (last + (Math.random() * 2 - 1) * 0.02) * 0.997;
    data[i] = last * 3.5;
  }
  const source = c.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  const band = c.createBiquadFilter();
  band.type = "lowpass";
  band.frequency.value = 700;
  const level = c.createGain();
  level.gain.value = 0.05;
  // a slow swell: the level rides between about a fifth and the whole of it
  const lfo = c.createOscillator();
  lfo.frequency.value = 0.07;
  const depth = c.createGain();
  depth.gain.value = 0.035;
  lfo.connect(depth).connect(level.gain);
  source.connect(band).connect(level).connect(out);
  source.start();
  lfo.start();
  return { source, lfo };
}

/** A short phrase of chirps, quiet and panned off to one side, then wait a while before the next. */
function birdsong() {
  if (!running || !ctx || !master) return;
  const c = ctx;
  const pan = c.createStereoPanner();
  pan.pan.value = (Math.random() * 2 - 1) * 0.7;
  const soft = c.createBiquadFilter();
  soft.type = "lowpass";
  soft.frequency.value = 5200;
  pan.connect(soft).connect(master);
  const base = 2600 + Math.random() * 1600;
  const rising = Math.random() < 0.5;
  const notes = 2 + Math.floor(Math.random() * 4);
  let t = c.currentTime + 0.05;
  for (let i = 0; i < notes; i++) {
    const osc = c.createOscillator();
    const env = c.createGain();
    const f = base * (1 + (Math.random() - 0.5) * 0.12);
    const len = 0.06 + Math.random() * 0.05;
    osc.frequency.setValueAtTime(rising ? f : f * 1.3, t);
    osc.frequency.exponentialRampToValueAtTime(rising ? f * 1.3 : f, t + len);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.03, t + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, t + len);
    osc.connect(env).connect(pan);
    osc.start(t);
    osc.stop(t + len + 0.02);
    t += len + 0.05 + Math.random() * 0.08;
  }
  window.setTimeout(() => pan.disconnect(), (t - c.currentTime + 0.5) * 1000);
  timer = window.setTimeout(birdsong, 6000 + Math.random() * 9000);
}
