export interface Broadcast {
  stop(): void;
  setFps(fps: number): void;
}

/** Run `frame` `fps` times a second until stopped; the rate can change while it runs. */
export function every(fps: number, frame: () => void): Broadcast {
  let timer = window.setInterval(frame, 1000 / fps);
  return {
    stop: () => clearInterval(timer),
    setFps: (v) => {
      clearInterval(timer);
      timer = window.setInterval(frame, 1000 / v);
    },
  };
}
