// Step two: the experiences. Each panel turns the located crowd into something:
// a picture, a wave of light, sound moving through the room, or a game.
import { AMBER, BLACK, EMBER, TEAL, WAVE_DEFAULTS, WHITE, makeWave, type WaveParams, type WaveProgram, type WaveShape } from '../core/effects';
import { sampleCrowd, type Image, type Point, type RGB } from '../core/layout';
import type { PotatoState } from '../core/potato';
import { teamSizes, type TerritoryState } from '../core/territory';
import { css, h, plural, segmented, slider } from '../ui/dom';
import type { Director } from './director';
import { POTATO_RULES, runGame, territoryRules } from './game';
import { fileStunt, presets, textStunt, type Stunt } from './images';
import { panel, requirePlaced, stopButton } from './panel';
import { speakerPanel } from './speaker';
import type { HostSession } from './session';
import type { Stage } from './stage';

/** Show `image` across the crowd: each phone takes its patch, and all flip together after a countdown. */
export function flipCards(session: HostSession, image: Image, leadMs = 3200): void {
  // Each phone averages the patch of picture it stands in for.
  const colors = sampleCrowd(image, session.layout, Math.min(0.25, 0.6 / Math.sqrt(Math.max(1, session.layout.positions.size))));
  const at = session.now() + leadMs;
  session.setProgram((seat) => ({ kind: 'card', rgb: colors.get(seat) ?? BLACK, at }));
}

export function cardPanel(session: HostSession, director: Director): HTMLElement {
  const all = presets();
  let chosen: Stunt = all[0];
  const preview = h('div.stunt-preview');
  const show = () => preview.replaceChildren(chosen.canvas);
  const pick = (s: Stunt) => {
    chosen = s;
    show();
    thumbs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.name === s.name)));
  };
  const thumbs = h(
    'div.thumbs',
    { role: 'group', 'aria-label': 'Pictures' },
    ...all.map((s) => {
      const c = document.createElement('canvas');
      c.width = c.height = 56;
      c.getContext('2d')!.drawImage(s.canvas, 0, 0, 56, 56);
      return h('button.thumb', { type: 'button', 'data-name': s.name, 'aria-pressed': String(s === chosen), 'aria-label': s.name, onclick: () => pick(s) }, c, h('span', {}, s.name));
    }),
  );
  const words = h('input', { type: 'text', id: 'stunt-words', maxlength: 24, placeholder: 'GO TEAM', autocomplete: 'off' });
  const file = h('input', { type: 'file', accept: 'image/*', id: 'stunt-file' });
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    try {
      pick(await fileStunt(f));
      say('');
    } catch {
      say('That file could not be read as a picture.');
    }
  });
  const flip = h('button.btn.primary', { type: 'button' }, 'Flip the cards');
  flip.addEventListener('click', () => {
    if (!requirePlaced(session, say)) return;
    director.take();
    flipCards(session, chosen.image);
    const n = session.playRoom().positions.size;
    say(`3, 2, 1… ${plural(n, 'phone')} ${n === 1 ? 'flips' : 'flip'} together.`);
  });
  show();
  const { el, say } = panel(
    'A stadium card stunt from any picture. Every phone shows its own patch of the image, then the whole crowd flips at the same instant.',
    thumbs,
    h('div.row', {}, h('label.grow', { for: 'stunt-words' }, 'Or your words', words), h('button.btn', { type: 'button', onclick: () => words.value.trim() && pick(textStunt(words.value.trim().toUpperCase(), session.layout.aspect)) }, 'Use words')),
    h('label.file', { for: 'stunt-file' }, 'Or upload a picture', file),
    preview,
    flip,
  );
  return el;
}

const COLORS: [string, RGB][] = [
  ['Amber', AMBER],
  ['White', WHITE],
  ['Teal', TEAL],
  ['Red', [255, 70, 40]],
];

function waveControls(stage: Stage, initial: Partial<WaveParams>, onChange: (w: WaveParams) => void, withColor: boolean) {
  const w: WaveParams = { ...WAVE_DEFAULTS, ...initial };
  const emit = () => onChange({ ...w });
  const picking = () => {
    stage.onPick =
      w.shape === 'ripple'
        ? (p: Point) => {
            w.origin = p;
            emit();
          }
        : null;
  };
  const press = (group: HTMLElement, pressed: (i: number) => boolean) =>
    group.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', String(pressed(i))));
  const DIRS: [string, number, string][] = [
    ['→', 0, 'Left to right'],
    ['↓', 90, 'Front to back'],
    ['←', 180, 'Right to left'],
    ['↑', 270, 'Back to front'],
    ['↘', 45, 'Diagonal'],
  ];
  const dirs = h(
    'div.dirs',
    { role: 'group', 'aria-label': 'Direction' },
    ...DIRS.map(([g, a, label]) =>
      h('button.dir', { type: 'button', 'aria-label': label, title: label, 'aria-pressed': String(a === w.angle), onclick: () => ((w.angle = a), press(dirs, (i) => DIRS[i][1] === a), emit()) }, g),
    ),
  );
  const swatches = h(
    'div.swatches',
    { role: 'group', 'aria-label': 'Colour' },
    ...COLORS.map(([name, rgb]) =>
      h('button.swatch', { type: 'button', 'aria-label': name, title: name, style: `--c:${css(rgb)}`, 'aria-pressed': String(rgb === w.rgb), onclick: () => ((w.rgb = rgb), press(swatches, (i) => COLORS[i][1] === rgb), emit()) }),
    ),
  );
  const el = h(
    'div.wave-controls',
    {},
    segmented<WaveShape>('Shape', [['sweep', 'Sweep'], ['pingpong', 'Ping-pong'], ['ripple', 'Ripple']], w.shape, (v) => {
      w.shape = v;
      dirs.hidden = v === 'ripple';
      picking();
      emit();
    }),
    dirs,
    slider('Speed', 0.6, 8, 0.1, w.period / 1000, (v) => `${v.toFixed(1)} s per pass`, (v) => ((w.period = v * 1000), emit())),
    slider('Band width', 0.04, 0.4, 0.01, w.width, (v) => `${Math.round(v * 100)}%`, (v) => ((w.width = v), emit())),
    withColor ? swatches : null,
  );
  return { el, get: () => ({ ...w }), arm: picking };
}

/** A wave on the crowd that can be edited while it rolls. */
export function liveWave(session: HostSession) {
  let wave: WaveProgram | null = null;
  let sentAt = 0;
  let pending = 0;
  const send = () => {
    pending = 0;
    sentAt = performance.now();
    if (wave) session.setProgram({ ...wave });
  };
  return {
    start(w: WaveParams, leadMs: number): void {
      wave = makeWave(session.now() + leadMs, w);
      send();
    },
    // Live edits keep the wave's phase so the band never jumps and phones keep their audio
    // schedule; a new speed rebases t0 so the band stays where it is (pingpong parity included).
    retune(w: WaveParams): void {
      if (!wave) return;
      const now = session.now();
      let t0 = wave.t0;
      if (w.period !== wave.period && now > t0) t0 = now - (((now - t0) / wave.period) % 2) * w.period;
      wave = makeWave(t0, w);
      // Slider drags fire per pixel; at most one broadcast per 150 ms, trailing edge included.
      const wait = 150 - (performance.now() - sentAt);
      if (wait <= 0) send();
      else pending ||= window.setTimeout(send, wait);
    },
    stop(): void {
      wave = null;
      clearTimeout(pending);
      pending = 0;
    },
  };
}

export function wavePanel(session: HostSession, stage: Stage, director: Director): HTMLElement {
  const wave = liveWave(session);
  const go = (w: WaveParams) => {
    if (!requirePlaced(session, say)) return;
    director.take(wave.stop);
    controls.arm();
    wave.start(w, 250);
    say('Rolling. Change anything and it updates live.');
  };
  const controls = waveControls(stage, {}, wave.retune, true);
  const { el, say } = panel(
    'A band of light rolls through the room in real space: a sweep from wall to wall, a ping-pong, or a ripple spreading out from any spot you tap on the map.',
    controls.el,
    h('div.row', {}, h('button.btn.primary', { type: 'button', onclick: () => go(controls.get()) }, 'Start the wave'), stopButton(director, () => say(''))),
  );
  return el;
}

const SOUNDS: { name: string; blurb: string; w: Partial<WaveParams> & Pick<WaveParams, 'shape' | 'voice' | 'period' | 'rgb'> }[] = [
  { name: 'Pluck sweep', blurb: 'A rising run of notes travels from one wall to the other.', w: { shape: 'sweep', voice: 'pluck', period: 2400, rgb: AMBER } },
  { name: 'Bell ping-pong', blurb: 'Bells bounce back and forth across the room.', w: { shape: 'pingpong', voice: 'bell', period: 3200, rgb: WHITE } },
  { name: 'Drum ripple', blurb: 'A drumbeat spreads out from the centre like a stone in a pond.', w: { shape: 'ripple', voice: 'drum', period: 1600, rgb: [255, 70, 40], origin: { x: 0.5, y: 0.5 } } },
  { name: 'Slow chord', blurb: 'A wide, slow wash of harmony from front to back.', w: { shape: 'sweep', angle: 90, voice: 'bell', period: 6000, width: 0.3, rgb: TEAL } },
];

export function soundPanel(session: HostSession, director: Director): HTMLElement {
  let current = SOUNDS[0];
  let tempo = 1;
  const wave = liveWave(session);
  const params = (): WaveParams => ({ ...WAVE_DEFAULTS, ...current.w, period: current.w.period / tempo });
  const play = () => {
    if (!requirePlaced(session, say)) return;
    director.take(wave.stop);
    wave.start(params(), 400);
    say(`Playing ${current.name}. Phones that tapped “Join” and are off silent will sing.`);
  };
  const { el, say } = panel(
    'Every phone is one speaker, timed to within a few milliseconds on the shared clock, so sound physically moves through the crowd. Each phone sings its own note, set by where it sits.',
    h(
      'div.sound-list',
      { role: 'radiogroup', 'aria-label': 'Sound' },
      ...SOUNDS.map((s, i) =>
        h(
          'label.sound',
          {},
          h('input', { type: 'radio', name: 'sound', checked: i === 0, onchange: () => ((current = s), play()) }),
          h('span.sound-name', {}, s.name),
          h('span.sound-blurb', {}, s.blurb),
        ),
      ),
    ),
    slider('Tempo', 0.5, 2, 0.05, 1, (v) => `${v.toFixed(2)}×`, (v) => {
      tempo = v;
      wave.retune(params());
    }),
    h('div.row', {}, h('button.btn.primary', { type: 'button', onclick: play }, 'Play'), stopButton(director, () => say(''))),
  );
  // Two modes: your music on every phone, or the spatial tones above.
  const party = speakerPanel(session, director);
  el.hidden = true;
  const mode = segmented<'party' | 'tones'>('Mode', [['party', 'Party speaker'], ['tones', 'Spatial tones']], 'party', (v) => {
    party.hidden = v !== 'party';
    el.hidden = v !== 'tones';
  });
  return h('div.sound-modes', {}, mode, party, el);
}

const TEAMS: [RGB, RGB] = [AMBER, TEAL];

export function territoryPanel(session: HostSession, director: Director): HTMLElement {
  const bar = h('div.tug', { 'aria-hidden': 'true' }, h('div.tug-a'), h('div.tug-line'));
  const score = h('p.score', { role: 'status', 'aria-live': 'polite' }, 'Two halves of the room. Tap to push the front line.');
  const duration = h('select', { id: 'terr-dur' }, ...[30, 45, 60, 90].map((s) => h('option', { value: s, selected: s === 45 }, `${s} seconds`)));
  const start = () =>
    runGame<TerritoryState>(session, director, say, {
      ...territoryRules(Number(duration.value) * 1000, TEAMS),
      show: (s, _prev, room) => {
        bar.style.setProperty('--b', String(s.boundary));
        const [a, b] = teamSizes(s, room);
        const left = Math.max(0, Math.ceil((s.endsAt - session.now()) / 1000));
        score.textContent =
          s.phase === 'over'
            ? s.winner === null
              ? 'Dead heat. A draw!'
              : `${s.winner === 0 ? 'Amber' : 'Teal'} wins with ${Math.round((s.winner === 0 ? s.boundary : 1 - s.boundary) * 100)}% of the floor.`
            : `Amber ${plural(a, 'phone')}, ${plural(s.taps[0], 'tap')} · Teal ${plural(b, 'phone')}, ${plural(s.taps[1], 'tap')} · ${left}s left`;
      },
    });
  const { el, say } = panel(
    'The room splits down the middle into Amber and Teal. Every tap shoves the front line into the other side, and any phone the line passes over defects. Push it to the wall to win.',
    bar,
    score,
    h('div.row', {}, h('label.num', { for: 'terr-dur' }, 'Round', duration), h('button.btn.primary', { type: 'button', onclick: start }, 'Start Territory')),
  );
  return el;
}

export function potatoPanel(session: HostSession, director: Director): HTMLElement {
  const score = h('p.score', { role: 'status', 'aria-live': 'polite' }, 'A ball of fire jumps between neighbours. Tap when it lands on you.');
  const start = () =>
    runGame<PotatoState>(session, director, say, {
      ...POTATO_RULES,
      show: (s, prev, room) => {
        if (s === prev) return;
        if (s.phase === 'over') score.textContent = s.winner === null ? 'Everyone burnt out!' : `Phone ${s.winner + 1} is the last one standing after ${plural(s.passes, 'throw')}.`;
        else if (!prev || prev.out.length !== s.out.length || prev.holder !== s.holder) {
          const alive = room.positions.size - s.out.length;
          score.textContent = `Ball on phone ${s.holder + 1} · fuse ${(s.fuse / 1000).toFixed(1)}s · ${alive} still in · ${plural(s.passes, 'throw')}`;
        }
      },
    });
  const { el, say } = panel(
    'A glowing ball flies across the crowd from phone to phone. When it lands on yours, tap before the fuse runs out to throw it to a neighbour. Miss and your phone burns out. The fuse gets shorter every throw.',
    h('div.legend', {}, h('span', { style: `--c:${css([255, 96, 16])}` }, 'Ball'), h('span', { style: `--c:${css(EMBER)}` }, 'Burnt out')),
    score,
    h('button.btn.primary', { type: 'button', onclick: start }, 'Start Hot Potato'),
  );
  return el;
}
