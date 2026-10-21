// Step two: the experiences. Each panel turns the located crowd into something:
// a picture, a wave of light, sound moving through the room, or a game.
import { AMBER, EMBER, TEAL, WHITE, type Voice, type WaveProgram, type WaveShape } from '../core/effects';
import { sampleCover, type Image, type Point, type RGB } from '../core/layout';
import { startPotato, potatoTap, potatoTick, type PotatoState } from '../core/potato';
import { startTerritory, teamSizes, territoryTap, territoryTick, type TerritoryState } from '../core/territory';
import { css, h, segmented, slider } from '../ui/dom';
import { fileStunt, presets, textStunt, type Stunt } from './images';
import type { HostSession } from './session';
import type { Stage } from './stage';

/** Starting something stops whatever was running (games, taps, stage picking). */
export interface Director {
  take(stop?: () => void): void;
}

function needPlaced(session: HostSession): string | null {
  return session.layout.positions.size > 0 ? null : 'Place some phones on the map first (Locate tab).';
}

/** Show `image` across the crowd: each phone takes its patch, and all flip together after a countdown. */
export function flipCards(session: HostSession, image: Image, leadMs = 3200): void {
  const { positions, aspect } = session.layout;
  // Each phone averages the patch of picture it stands in for.
  const patch = Math.min(0.25, 0.6 / Math.sqrt(Math.max(1, positions.size)));
  const colors = new Map<number, RGB>();
  for (const [seat, p] of positions) colors.set(seat, sampleCover(image, p, aspect, patch));
  const at = session.now() + leadMs;
  session.setProgram((seat) => ({ kind: 'card', rgb: colors.get(seat) ?? [0, 0, 0], at }));
}

export function cardPanel(session: HostSession, director: Director): HTMLElement {
  const all = presets();
  let chosen: Stunt = all[0];
  const preview = h('div.stunt-preview');
  const msg = h('p.note', { role: 'status' });
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
      msg.textContent = '';
    } catch {
      msg.textContent = 'That file could not be read as a picture.';
    }
  });
  const flip = h('button.btn.primary', { type: 'button' }, 'Flip the cards');
  flip.addEventListener('click', () => {
    const err = needPlaced(session);
    if (err) return void (msg.textContent = err);
    director.take();
    flipCards(session, chosen.image);
    msg.textContent = `3, 2, 1… ${session.layout.positions.size} phones flip together.`;
  });
  show();
  return h(
    'div.panel-body',
    {},
    h('p.panel-intro', {}, 'A stadium card stunt from any picture. Every phone shows its own patch of the image, then the whole crowd flips at the same instant.'),
    thumbs,
    h('div.row', {}, h('label.grow', { for: 'stunt-words' }, 'Or your words', words), h('button.btn', { type: 'button', onclick: () => words.value.trim() && pick(textStunt(words.value.trim().toUpperCase(), session.layout.aspect)) }, 'Use words')),
    h('label.file', { for: 'stunt-file' }, 'Or upload a picture', file),
    preview,
    flip,
    msg,
  );
}

const COLORS: [string, RGB][] = [
  ['Amber', AMBER],
  ['White', WHITE],
  ['Teal', TEAL],
  ['Red', [255, 70, 40]],
];

function waveControls(stage: Stage, initial: Partial<WaveProgram>, onChange: (w: Omit<WaveProgram, 't0' | 'kind'>) => void, withColor: boolean) {
  const w: Omit<WaveProgram, 't0' | 'kind'> = { period: 2400, shape: 'sweep', angle: 0, origin: { x: 0.5, y: 0.5 }, width: 0.12, rgb: AMBER, voice: 'off', ...initial };
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

export function wavePanel(session: HostSession, stage: Stage, director: Director): HTMLElement {
  const msg = h('p.note', { role: 'status' });
  let wave: WaveProgram | null = null;
  let sentAt = 0;
  let pending = 0;
  const send = () => {
    pending = 0;
    sentAt = performance.now();
    if (wave) session.setProgram({ ...wave });
  };
  const go = (w: Omit<WaveProgram, 't0' | 'kind'>) => {
    const err = needPlaced(session);
    if (err) return void (msg.textContent = err);
    director.take(() => {
      wave = null;
      clearTimeout(pending);
      pending = 0;
      stage.onPick = null;
    });
    controls.arm();
    wave = { kind: 'wave', t0: session.now() + 250, ...w };
    send();
    msg.textContent = 'Rolling. Change anything and it updates live.';
  };
  // Live edits keep the wave's phase so the band never jumps and phones keep their audio
  // schedule; a new speed rebases t0 so the band stays where it is (pingpong parity included).
  const retune = (w: Omit<WaveProgram, 't0' | 'kind'>) => {
    if (!wave) return;
    const now = session.now();
    let t0 = wave.t0;
    if (w.period !== wave.period && now > t0) t0 = now - (((now - t0) / wave.period) % 2) * w.period;
    wave = { kind: 'wave', t0, ...w };
    // Slider drags fire per pixel; at most one broadcast per 150 ms, trailing edge included.
    const wait = 150 - (performance.now() - sentAt);
    if (wait <= 0) send();
    else pending ||= window.setTimeout(send, wait);
  };
  const controls = waveControls(stage, {}, retune, true);
  return h(
    'div.panel-body',
    {},
    h('p.panel-intro', {}, 'A band of light rolls through the room in real space: a sweep from wall to wall, a ping-pong, or a ripple spreading out from any spot you tap on the map.'),
    controls.el,
    h('div.row', {}, h('button.btn.primary', { type: 'button', onclick: () => go(controls.get()) }, 'Start the wave'), h('button.btn.ghost', { type: 'button', onclick: () => (director.take(), session.setProgram({ kind: 'lobby' }), (msg.textContent = '')) }, 'Stop')),
    msg,
  );
}

const SOUNDS: { name: string; blurb: string; w: Partial<WaveProgram> }[] = [
  { name: 'Pluck sweep', blurb: 'A rising run of notes travels from one wall to the other.', w: { shape: 'sweep', voice: 'pluck', period: 2400, rgb: AMBER } },
  { name: 'Bell ping-pong', blurb: 'Bells bounce back and forth across the room.', w: { shape: 'pingpong', voice: 'bell', period: 3200, rgb: WHITE } },
  { name: 'Drum ripple', blurb: 'A drumbeat spreads out from the centre like a stone in a pond.', w: { shape: 'ripple', voice: 'drum', period: 1600, rgb: [255, 70, 40], origin: { x: 0.5, y: 0.5 } } },
  { name: 'Slow chord', blurb: 'A wide, slow wash of harmony from front to back.', w: { shape: 'sweep', angle: 90, voice: 'bell', period: 6000, width: 0.3, rgb: TEAL } },
];

export function soundPanel(session: HostSession, stage: Stage, director: Director): HTMLElement {
  const msg = h('p.note', { role: 'status' });
  let current = SOUNDS[0];
  let tempo = 1;
  const play = () => {
    const err = needPlaced(session);
    if (err) return void (msg.textContent = err);
    director.take();
    stage.onPick = null;
    const base = { period: 2400, angle: 0, origin: { x: 0.5, y: 0.5 }, width: 0.12, ...current.w } as Omit<WaveProgram, 'kind' | 't0'>;
    session.setProgram({ kind: 'wave', t0: session.now() + 400, ...base, voice: current.w.voice as Voice, period: base.period / tempo });
    msg.textContent = `Playing ${current.name}. Phones that tapped “Join” and are off silent will sing.`;
  };
  return h(
    'div.panel-body',
    {},
    h('p.panel-intro', {}, 'Every phone is one speaker, timed to the millisecond on the shared clock, so sound physically moves through the crowd. Each phone sings its own note, set by where it sits.'),
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
    slider('Tempo', 0.5, 2, 0.05, 1, (v) => `${v.toFixed(2)}×`, (v) => (tempo = v)),
    h('div.row', {}, h('button.btn.primary', { type: 'button', onclick: play }, 'Play'), h('button.btn.ghost', { type: 'button', onclick: () => (director.take(), session.setProgram({ kind: 'lobby' }), (msg.textContent = '')) }, 'Stop')),
    msg,
  );
}

const TEAMS: [RGB, RGB] = [AMBER, TEAL];

export function territoryPanel(session: HostSession, director: Director): HTMLElement {
  const msg = h('p.note', { role: 'status' });
  const bar = h('div.tug', { 'aria-hidden': 'true' }, h('div.tug-a'), h('div.tug-line'));
  const score = h('p.score', { role: 'status', 'aria-live': 'polite' }, 'Two halves of the room. Tap to push the front line.');
  const duration = h('select', { id: 'terr-dur' }, ...[30, 45, 60, 90].map((s) => h('option', { value: s, selected: s === 45 }, `${s} seconds`)));
  let state: TerritoryState | null = null;
  let room = session.playRoom();
  let timer = 0;
  let last = 0;
  const draw = () => {
    if (!state) return;
    bar.style.setProperty('--b', String(state.boundary));
    const [a, b] = teamSizes(state, room);
    const left = Math.max(0, Math.ceil((state.endsAt - session.now()) / 1000));
    score.textContent =
      state.phase === 'over'
        ? state.winner === null
          ? 'Dead heat. A draw!'
          : `${state.winner === 0 ? 'Amber' : 'Teal'} wins with ${Math.round((state.winner === 0 ? state.boundary : 1 - state.boundary) * 100)}% of the floor.`
        : `Amber ${a} phones, ${state.taps[0]} taps · Teal ${b} phones, ${state.taps[1]} taps · ${left}s left`;
  };
  const push = (s: TerritoryState) => {
    const changed = s !== state;
    state = s;
    const now = performance.now();
    if (changed && (now - last > 40 || s.phase === 'over')) {
      last = now;
      session.setProgram({ kind: 'territory', state: s, colors: TEAMS });
    }
    draw();
    if (s.phase === 'over') clearInterval(timer);
  };
  const start = () => {
    room = session.playRoom();
    if (room.positions.size < 2) return void (msg.textContent = 'Territory needs at least 2 connected, placed phones.');
    director.take(() => {
      clearInterval(timer);
      session.onTap = () => {};
      state = null;
    });
    msg.textContent = '';
    state = null;
    push(startTerritory(room, session.now(), Number(duration.value) * 1000));
    session.onTap = (seat) => state && push(territoryTap(state, room, seat, session.now()));
    timer = window.setInterval(() => {
      if (!state) return;
      const next = territoryTick(state, session.now());
      if (next !== state) push(next);
      else if (performance.now() - last > 120) {
        // Re-send so slow taps that were throttled still land on every phone.
        last = performance.now();
        session.setProgram({ kind: 'territory', state, colors: TEAMS });
        draw();
      }
    }, 100);
  };
  return h(
    'div.panel-body',
    {},
    h('p.panel-intro', {}, 'The room splits down the middle into Amber and Teal. Every tap shoves the front line into the other side, and any phone the line passes over defects. Push it to the wall to win.'),
    bar,
    score,
    h('div.row', {}, h('label.num', { for: 'terr-dur' }, 'Round', duration), h('button.btn.primary', { type: 'button', onclick: start }, 'Start Territory')),
    msg,
  );
}

export function potatoPanel(session: HostSession, director: Director): HTMLElement {
  const msg = h('p.note', { role: 'status' });
  const score = h('p.score', { role: 'status', 'aria-live': 'polite' }, 'A ball of fire jumps between neighbours. Tap when it lands on you.');
  let state: PotatoState | null = null;
  let room = session.playRoom();
  let timer = 0;
  const push = (s: PotatoState) => {
    if (s === state) return;
    const prev = state;
    state = s;
    session.setProgram({ kind: 'potato', state: s });
    if (s.phase === 'over') {
      clearInterval(timer);
      score.textContent = s.winner === null ? 'Everyone burnt out!' : `Phone ${s.winner + 1} is the last one standing after ${s.passes} throws.`;
    } else if (!prev || prev.out.length !== s.out.length || prev.holder !== s.holder) {
      const alive = room.positions.size - s.out.length;
      score.textContent = `Ball on phone ${s.holder + 1} · fuse ${(s.fuse / 1000).toFixed(1)}s · ${alive} still in · ${s.passes} throws`;
    }
  };
  const start = () => {
    room = session.playRoom();
    const s = startPotato(room, session.now() + 1500, Math.random);
    if (!s) return void (msg.textContent = 'Hot Potato needs at least 2 connected, placed phones.');
    director.take(() => {
      clearInterval(timer);
      session.onTap = () => {};
      state = null;
    });
    msg.textContent = '';
    state = null;
    push(s);
    session.onTap = (seat) => state && push(potatoTap(state, room, seat, session.now(), Math.random));
    timer = window.setInterval(() => state && push(potatoTick(state, room, session.now())), 50);
  };
  return h(
    'div.panel-body',
    {},
    h('p.panel-intro', {}, 'A glowing ball flies across the crowd from phone to phone. When it lands on yours, tap before the fuse runs out to throw it to a neighbour. Miss and your phone burns out. The fuse gets shorter every throw.'),
    h('div.legend', {}, h('span', { style: `--c:${css([255, 96, 16])}` }, 'Ball'), h('span', { style: `--c:${css(EMBER)}` }, 'Burnt out')),
    score,
    h('button.btn.primary', { type: 'button', onclick: start }, 'Start Hot Potato'),
    msg,
  );
}
