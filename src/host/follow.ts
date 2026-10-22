// Follow mode for the Live screen: every phone shows the whole picture, for rooms where
// not everyone can see the screen or there is no screen at all. Sources: the host's
// shared screen, the host's camera, typed text cards, and live captions of the host mic.
import { NO_CAPTIONS, captionLines, deckFrom, heard, step, type Deck, type FollowView } from '../core/follow';
import { FRAME_BUDGET, FrameGate, dataUrlBytes, encodeWithin, lumaOf } from '../core/frames';
import { MAX_MESSAGE_BYTES, messageBytes, type HostMsg } from '../core/protocol';
import { canvas2d } from '../ui/canvas';
import { h, plural, segmented, slider } from '../ui/dom';
import { FollowScreen } from '../ui/follow';
import type { Director, Hold } from './director';
import { panel, stopButton } from './panel';
import type { HostSession } from './session';
import { every, type Broadcast } from './ticker';

type FollowSource = 'screen' | 'camera' | 'cards' | 'captions';

/** Widest frame sent: plenty for slides and faces on a phone, small enough to stay under the budget. */
const FRAME_W = 720;
const THUMB_W = 32;
const THUMB_H = 18;

// The Web Speech API is not in TypeScript's DOM types; this is the part used here.
interface SpeechResult {
  readonly isFinal: boolean;
  readonly 0: { transcript: string };
}
interface SpeechEvent {
  readonly resultIndex: number;
  readonly results: ArrayLike<SpeechResult>;
}
interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => Recognition;

function speechRecognition(): RecognitionCtor | undefined {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

/** Keys that step the cards; presenter clickers send PageDown/PageUp. */
const NEXT_KEYS = new Set(['ArrowRight', 'ArrowDown', 'PageDown']);
const PREV_KEYS = new Set(['ArrowLeft', 'ArrowUp', 'PageUp']);
/** Places where arrow keys already mean something else. */
const OWNS_ARROWS = 'input, textarea, select, [contenteditable], [role="tab"], canvas';

/**
 * Turn a playing video into JPEG stills at `fps`, sending only when the picture changed
 * (or a periodic refresh is due) and keeping every frame under the byte budget.
 */
function streamFrames(video: HTMLVideoElement, fps: number, send: (src: string) => void): Broadcast {
  const [, thumb] = canvas2d(THUMB_W, THUMB_H);
  const [frame, fctx] = canvas2d(FRAME_W, FRAME_W);
  const gate = new FrameGate();
  let quality = 0.7;
  return every(fps, () => {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (video.readyState < 2 || !vw || !vh) return;
    thumb.drawImage(video, 0, 0, THUMB_W, THUMB_H);
    if (gate.next(lumaOf(thumb.getImageData(0, 0, THUMB_W, THUMB_H).data), performance.now()) === 'skip') return;
    const encoded = encodeWithin(
      (q, scale) => {
        frame.width = Math.max(2, Math.round(Math.min(FRAME_W, vw) * scale));
        frame.height = Math.max(2, Math.round((frame.width * vh) / vw));
        fctx.drawImage(video, 0, 0, frame.width, frame.height);
        return frame.toDataURL('image/jpeg', q);
      },
      FRAME_BUDGET,
      quality,
    );
    // A frame that can't be squeezed small enough is dropped; the gate retries on the next change.
    if (!encoded) return gate.reset();
    quality = encoded.quality;
    send(encoded.data);
  });
}

export function followPanel(session: HostSession, director: Director): HTMLElement {
  const Recognition = speechRecognition();
  const preview = new FollowScreen('preview', 'Preview of what every phone shows');
  let source: FollowSource = 'cards';
  let running: FollowSource | null = null;
  let fps = 2;
  let deck: Deck = { cards: [], at: 0 };
  let loop: Broadcast | null = null;
  let stream: MediaStream | null = null;
  let recognition: Recognition | null = null;
  let seq = 0;
  // Bumped by every start and stop, so a permission prompt that resolves late is dropped.
  let gen = 0;
  let hold: Hold | null = null;

  /** Send a view to every phone (and to late joiners when they arrive) and mirror it here. */
  const show = (view: FollowView) => {
    const msg: HostMsg = { t: 'program', program: { kind: 'follow', view } };
    // Never hand the transport more than one message can carry (frames and cards are sized to fit).
    if (messageBytes(msg) > MAX_MESSAGE_BYTES) return;
    session.setProgram(msg.program);
    preview.show(view);
  };

  const phones = () => plural(session.online.length, 'phone');

  // ---- Text cards ----
  const cardsInput = h('textarea.follow-cards', {
    id: 'follow-cards',
    rows: 6,
    placeholder: 'Welcome!\nDinner at 7\nSpeeches at 8\nHappy birthday, Sam',
  });
  const position = h('output.follow-pos', { for: 'follow-cards', 'aria-live': 'polite' });
  const prev = h('button.btn', { type: 'button', 'aria-label': 'Previous card' }, '‹ Prev');
  const next = h('button.btn', { type: 'button', 'aria-label': 'Next card' }, 'Next ›');
  const cardView = (): FollowView | null => (deck.cards.length ? { show: 'card', text: deck.cards[deck.at], n: deck.at + 1, of: deck.cards.length } : null);
  const renderDeck = () => {
    position.textContent = deck.cards.length ? `Card ${deck.at + 1} of ${deck.cards.length}` : 'No cards yet';
    prev.disabled = deck.at <= 0;
    next.disabled = deck.at >= deck.cards.length - 1;
    const v = cardView();
    if (running === 'cards' && v) show(v);
    else if (source === 'cards') preview.show(v);
  };
  const move = (d: number) => {
    deck = step(deck, d);
    renderDeck();
  };
  cardsInput.addEventListener('input', () => {
    deck = deckFrom(cardsInput.value, deck.at);
    renderDeck();
  });
  prev.addEventListener('click', () => move(-1));
  next.addEventListener('click', () => move(1));
  const onKey = (e: KeyboardEvent) => {
    if (source !== 'cards' || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || (e.target as Element | null)?.closest?.(OWNS_ARROWS)) return;
    const d = NEXT_KEYS.has(e.key) ? 1 : PREV_KEYS.has(e.key) ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    move(d);
  };
  const cardsBox = h(
    'div.follow-source',
    {},
    h('label', { for: 'follow-cards' }, 'Cards, one per line (lyrics, agenda, scores, a speech)'),
    cardsInput,
    h('div.row', { role: 'group', 'aria-label': 'Step through cards' }, prev, position, next),
    h('p.note', {}, 'Arrow keys or a presenter clicker step through the cards while they are showing.'),
  );

  // ---- Screen and camera ----
  const mediaBox = h(
    'div.follow-source',
    { hidden: true },
    slider('Frame rate', 1, 4, 1, fps, (v) => `${v} fps`, (v) => {
      fps = v;
      loop?.setFps(v);
    }),
  );

  // ---- Captions ----
  const captionsBox = h(
    'div.follow-source',
    { hidden: true },
    h('p.note', {}, 'Speak near this computer’s microphone; phones show the last few lines as you talk. In Chrome and Edge the speech is turned into text by the browser maker’s online service.'),
  );

  const go = h('button.btn.primary', { type: 'button' }, 'Show on phones');

  const stop = () => {
    gen++;
    running = null;
    go.disabled = false;
    loop?.stop();
    loop = null;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    if (recognition) {
      recognition.onend = recognition.onerror = recognition.onresult = null;
      recognition.stop();
      recognition = null;
    }
    document.removeEventListener('keydown', onKey);
    preview.show(source === 'cards' ? cardView() : null);
  };

  const startMedia = async (mine: number, kind: 'screen' | 'camera') => {
    let s: MediaStream;
    try {
      s =
        kind === 'screen'
          ? await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false })
          : await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 } }, audio: false });
    } catch {
      if (mine === gen) {
        hold?.end();
        say(kind === 'screen' ? 'Screen sharing was cancelled or is not allowed in this browser.' : 'The camera could not be opened. Allow it in the address bar.');
      }
      return;
    }
    if (mine !== gen) return s.getTracks().forEach((t) => t.stop());
    stream = s;
    const video = h('video', { muted: true, playsinline: true });
    video.muted = true;
    video.srcObject = s;
    // Stopping from the browser's own "Stop sharing" bar ends the broadcast too.
    s.getVideoTracks()[0]?.addEventListener('ended', () => {
      if (mine !== gen) return;
      hold?.end();
      say(kind === 'screen' ? 'Screen sharing ended.' : 'The camera stopped.');
    });
    try {
      await video.play();
    } catch {
      if (mine === gen) hold?.end(), say('The picture could not be played.');
      return;
    }
    if (mine !== gen) return;
    loop = streamFrames(video, fps, (src) => {
      show({ show: 'picture', src, seq: ++seq });
      say(`Showing ${kind === 'screen' ? 'your screen' : 'the camera'} on ${phones()} · up to ${fps} fps · last frame ${Math.round(dataUrlBytes(src) / 1024)} KB.`);
    });
  };

  const startCaptions = (mine: number) => {
    let caps = NO_CAPTIONS;
    const r = new Recognition!();
    r.continuous = true;
    r.interimResults = true;
    r.lang = navigator.language || 'en-US';
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) caps = heard(caps, res[0].transcript, true);
        else interim += res[0].transcript;
      }
      caps = heard(caps, interim, false);
      show({ show: 'captions', lines: captionLines(caps), interim: !!caps.interim });
    };
    let fatal = false;
    r.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      fatal = true;
      if (mine !== gen) return;
      hold?.end();
      say(
        e.error === 'not-allowed' || e.error === 'service-not-allowed'
          ? 'The microphone is blocked. Allow it in the address bar and try again.'
          : e.error === 'network'
            ? 'Captions need an internet connection in this browser.'
            : `Captions stopped (${e.error}).`,
      );
    };
    // Recognition ends by itself after a pause; keep listening until the host stops.
    r.onend = () => {
      if (mine !== gen || fatal) return;
      try {
        r.start();
      } catch {
        // Already restarting.
      }
    };
    recognition = r;
    try {
      r.start();
    } catch {
      hold?.end();
      return say('Captions could not start. Check the microphone and the internet connection.');
    }
    say(`Captioning to ${phones()}. Phones that join later see the captions too.`);
  };

  const start = () => {
    // Nothing to show: say so before taking the room, so whatever runs keeps running.
    const card = cardView();
    if (source === 'cards' && !card) return say('Type at least one line first.');
    const first: FollowView | null =
      source === 'cards' ? card : source === 'captions' ? { show: 'captions', lines: [], interim: false } : { show: 'wait', text: source === 'screen' ? 'The host is about to share their screen…' : 'The camera is starting…' };
    hold = director.run({ stop, program: first ? { kind: 'follow', view: first } : undefined });
    const mine = ++gen;
    running = source;
    if (first) preview.show(first);
    if (source === 'cards') {
      document.addEventListener('keydown', onKey);
      return say(`Showing card ${deck.at + 1} of ${deck.cards.length} on ${phones()}. Phones that join later see it too.`);
    }
    if (source === 'captions') return startCaptions(mine);
    go.disabled = true;
    say(source === 'screen' ? 'Pick the screen, window or tab to share.' : 'Starting the camera…');
    void startMedia(mine, source).finally(() => mine === gen && (go.disabled = false));
  };
  go.addEventListener('click', start);

  const sources: [FollowSource, string][] = [
    ['cards', 'Text cards'],
    ['screen', 'Share my screen'],
    ['camera', 'Camera'],
  ];
  if (Recognition) sources.push(['captions', 'Live captions']);
  const boxes: Record<FollowSource, HTMLElement> = { cards: cardsBox, screen: mediaBox, camera: mediaBox, captions: captionsBox };

  const { el, say } = panel(
    'Every phone shows the whole picture: your slides, a video, the camera, big text cards or live captions. For rooms where not everyone can see the screen, or there is no screen at all.',
    segmented<FollowSource>('Show', sources, source, (v) => {
      source = v;
      for (const box of new Set(Object.values(boxes))) box.hidden = box !== boxes[v];
      if (v === 'cards') renderDeck();
      else if (!running) preview.show(null);
      // Switching source while live starts the new one at once.
      if (running) start();
    }),
    Recognition ? null : h('p.note', {}, 'Live captions need a browser with speech recognition, such as Chrome, Edge or Safari.'),
    cardsBox,
    mediaBox,
    captionsBox,
    preview.el,
    h('div.row', {}, go, stopButton(director, () => say(''))),
  );
  el.addEventListener('keydown', onKey);
  renderDeck();
  return el;
}
