/** Small hand-drawn-style icons (round strokes, slightly wobbly). */

const base = { width: 26, height: 26, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const Icon = {
  select: () => (
    <svg {...base}>
      <path d="M5.2 3.6 18.6 11l-6 1.4-2.7 5.9z" />
    </svg>
  ),
  wall: () => (
    <svg {...base}>
      <path d="M3.4 5.2h17.1M3.6 10.1h16.9M3.3 15h17.3M3.5 19.8h16.8M8.1 5.3v4.7M15.6 5.2v4.9M11.8 10.2v4.7M5.9 15.1v4.6M17.7 15v4.8" />
    </svg>
  ),
  wallErase: () => (
    <svg {...base}>
      <path d="M3.4 6h11.2M3.5 11h8.1M3.4 16h6.3M9 6v5" />
      <path d="m14.3 13.6 6 6.1M20.4 13.5l-6.1 6.2" />
    </svg>
  ),
  floor: () => (
    <svg {...base}>
      <path d="m2.8 13.2 9.1-5.4 9.3 5.3-9.2 5.6z" />
      <path d="m7.4 10.5 9.1 5.3M12 7.9l4.7 2.6M7.3 15.9l4.6-2.7" />
    </svg>
  ),
  floorErase: () => (
    <svg {...base}>
      <path d="m2.8 13.2 9.1-5.4 6.2 3.6M12 18.6 2.8 13.2" />
      <path d="m14.4 13.8 5.9 5.9M20.3 13.8l-5.9 5.9" />
    </svg>
  ),
  buy: () => (
    <svg {...base}>
      <path d="M4.2 11.4h15.4l-.9 3.6H5.1z" />
      <path d="M5.4 15v4.3M18.3 15v4.3M6 11.3c0-3 1.2-5.2 5.9-5.2s6 2.2 6 5.2" />
    </svg>
  ),
  wallsDown: () => (
    <svg {...base}>
      <path d="M4 19.6h16M6.2 19.5v-4.7h11.6v4.6M6 9.2l6-4.6 6 4.6" strokeDasharray="0" />
    </svg>
  ),
  wallsUp: () => (
    <svg {...base}>
      <path d="M4 19.6h16M6.2 19.5V9.7h11.6v9.8M4.6 10.1 12 4.4l7.4 5.7" />
    </svg>
  ),
  wallsCut: () => (
    <svg {...base}>
      <path d="M4 19.6h16M6.2 19.5V9.7l5.8-4.9 5.8 4.9v2.6M17.8 15.8v3.7M14 15.3l5.8-2.2" />
    </svg>
  ),
  flip: () => (
    <svg {...base}>
      <path d="M12 3.6v16.8M9.4 7.2 4.3 17h5.1zM14.6 7.2l5.1 9.8h-5.1z" />
    </svg>
  ),
  rotate: () => (
    <svg {...base}>
      <path d="M19.2 12.4a7.2 7.2 0 1 1-2.3-5.6" />
      <path d="M17.6 3.2l-.4 4-4-.3" />
    </svg>
  ),
  trash: () => (
    <svg {...base}>
      <path d="M4.6 6.6h14.8M9.3 6.4V4.3h5.3v2.1M6.4 6.8l1 13h9.2l1-13M10.2 10.4l.3 6M13.8 10.4l-.3 6" />
    </svg>
  ),
  link: () => (
    <svg {...base}>
      <path d="M10.2 13.8a3.6 3.6 0 0 0 5.2.3l3-3a3.7 3.7 0 0 0-5.2-5.2l-1.2 1.1" />
      <path d="M13.8 10.2a3.6 3.6 0 0 0-5.2-.3l-3 3a3.7 3.7 0 0 0 5.2 5.2l1.1-1.1" />
    </svg>
  ),
  help: () => (
    <svg {...base}>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M9.6 9.6a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.5v.5M12 16.9v.1" />
    </svg>
  ),
  back: () => (
    <svg {...base}>
      <path d="M19.4 12.1H5M10.4 6.6 4.8 12l5.6 5.5" />
    </svg>
  ),
  turnLeft: () => (
    <svg {...base}>
      <path d="M5.2 12.3a7 7 0 1 0 2.2-5.4" />
      <path d="M6.7 3.3l.6 3.9 3.9-.5" />
    </svg>
  ),
  turnRight: () => (
    <svg {...base}>
      <path d="M18.8 12.3a7 7 0 1 1-2.2-5.4" />
      <path d="M17.3 3.3l-.6 3.9-3.9-.5" />
    </svg>
  ),
  plus: () => (
    <svg {...base}>
      <path d="M12 5.2v13.5M5.3 12.1h13.4" />
    </svg>
  ),
  minus: () => (
    <svg {...base}>
      <path d="M5.3 12.1h13.4" />
    </svg>
  ),
  home: () => (
    <svg {...base}>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M12 3.4v3.2M12 17.4v3.2M3.4 12h3.2M17.4 12h3.2" />
    </svg>
  ),
  undo: () => (
    <svg {...base}>
      <path d="M8.6 5.3 4.5 9.4l4.1 4" />
      <path d="M4.8 9.4h9.6a5 5 0 0 1 0 10H10" />
    </svg>
  ),
  redo: () => (
    <svg {...base}>
      <path d="m15.4 5.3 4.1 4.1-4.1 4" />
      <path d="M19.2 9.4H9.6a5 5 0 0 0 0 10H14" />
    </svg>
  ),
  house: () => (
    <svg {...base}>
      <path d="M3.8 11.2 12 4.6l8.2 6.6M6.2 9.4v10.2h11.6V9.4M10.1 19.5v-5.2h3.8v5.2" />
    </svg>
  ),
};
