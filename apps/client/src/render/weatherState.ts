/**
 * The weather as this screen sees it right now, worked out once a frame by `Sky` from the shared clock, for the rain,
 * the puddles and the sound to read. (Not state to save or send: it's a pure function of the server time.)
 */
export const weatherNow = {
  /** 0 dry, 1 pouring. */
  rain: 0,
  /** How wet the ground is: rises with rain, then dries out over a minute or so. */
  wet: 0,
};
