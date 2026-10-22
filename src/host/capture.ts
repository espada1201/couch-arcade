// What drives Follow mode's picture capture. While the host shares slides from another
// window, this tab is hidden and the browser throttles its timers to about once a second,
// so the frames come from the stream itself where it can: the track (MediaStreamTrackProcessor,
// which keeps reading in a hidden tab), else the video's own frame callbacks, else a timer.
import { every, type Broadcast } from './ticker';

export type Driver = 'track' | 'video' | 'interval';

export function pickDriver({ trackProcessor, videoFrameCallback }: { trackProcessor: boolean; videoFrameCallback: boolean }): Driver {
  return trackProcessor ? 'track' : videoFrameCallback ? 'video' : 'interval';
}

/** Lets through at most `fps` frames a second. */
export class Rate {
  private last = -Infinity;
  constructor(public fps: number) {}

  due(now: number): boolean {
    // A few ms of slack: frames arrive on the display's beat, not exactly on ours.
    if (now - this.last < 1000 / this.fps - 5) return false;
    this.last = now;
    return true;
  }
}

/** The part of MediaStreamTrackProcessor used here (not in TypeScript's DOM types yet). */
type TrackProcessor = new (init: { track: MediaStreamTrack }) => { readable: ReadableStream<VideoFrame> };

function trackProcessor(): TrackProcessor | undefined {
  return (globalThis as unknown as { MediaStreamTrackProcessor?: TrackProcessor }).MediaStreamTrackProcessor;
}

type VideoWithFrames = HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number) => void) => number };

export type FrameSink = (src: CanvasImageSource, w: number, h: number) => void;

/** Hand `frame` the latest picture at most `fps` times a second until stopped. */
export function captureFrames(video: HTMLVideoElement, track: MediaStreamTrack | undefined, fps: number, frame: FrameSink, driver?: Driver): Broadcast {
  const v = video as VideoWithFrames;
  const Processor = trackProcessor();
  driver ??= pickDriver({ trackProcessor: !!track && !!Processor, videoFrameCallback: !!v.requestVideoFrameCallback });
  const rate = new Rate(fps);
  let stopped = false;
  const fromVideo = (now: number) => {
    if (!stopped && v.readyState >= 2 && v.videoWidth && v.videoHeight && rate.due(now)) frame(v, v.videoWidth, v.videoHeight);
  };

  if (driver === 'track' && track && Processor) {
    // A clone, so reading it never competes with the preview for frames.
    const own = track.clone();
    const reader = new Processor({ track: own }).readable.getReader();
    const pump = async () => {
      for (;;) {
        const { value: f, done } = await reader.read().catch(() => ({ value: undefined, done: true }) as const);
        if (done || !f) return;
        try {
          if (!stopped && rate.due(performance.now())) frame(f, f.displayWidth, f.displayHeight);
        } finally {
          f.close();
        }
      }
    };
    void pump();
    return {
      stop: () => {
        stopped = true;
        void reader.cancel().catch(() => {});
        own.stop();
      },
      setFps: (n) => (rate.fps = n),
    };
  }

  if (driver === 'video' && v.requestVideoFrameCallback) {
    let lastCallback = performance.now();
    const onFrame = (now: number) => {
      if (stopped) return;
      lastCallback = performance.now();
      fromVideo(now);
      v.requestVideoFrameCallback!(onFrame);
    };
    v.requestVideoFrameCallback(onFrame);
    // Frame callbacks stop in a hidden tab; then a (throttled) timer is better than nothing.
    const backup = every(fps, () => performance.now() - lastCallback > 1000 && fromVideo(performance.now()));
    return {
      stop: () => {
        stopped = true;
        backup.stop();
      },
      setFps: (n) => {
        rate.fps = n;
        backup.setFps(n);
      },
    };
  }

  const loop = every(fps, () => fromVideo(performance.now()));
  return {
    stop: () => {
      stopped = true;
      loop.stop();
    },
    setFps: (n) => {
      rate.fps = n;
      loop.setFps(n);
    },
  };
}
