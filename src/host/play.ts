// Step two: the experiences. Each panel turns the located crowd into something:
// a picture, a wave of light, sound moving through the room, or a game.
import { AMBER, EMBER, TEAL, WAVE_DEFAULTS, WHITE, makeWave, type WaveParams, type WaveProgram, type WaveShape } from '../core/effects';
import type { Point, RGB } from '../core/layout';
import type { PotatoState } from '../core/potato';
import { teamSizes, type TerritoryState } from '../core/territory';
import { css, h, plural, segmented, setText, slider } from '../ui/dom';
import { FLIP_LEAD_MS, STYLES, STYLE_KEYS, type CardStyle } from './cardstyles';
import type { Director, Run } from './director';
import { POTATO_RULES, runGame, territoryRules } from './game';
import { flipper } from './flipper';
import { MOMENTS, fileStunt, missingNames, presets, textStunt, type Moment, type Stunt } from './images';
import { footedPanel, lineUpSaid, panel, placementNote, requirePlaced, stopButton } from './panel';
import { recorder } from './record';
import { throttle } from './throttle';
import { speakerPanel } from './speaker';
import type { HostSession } from './session';
import type { Stage } from './stage';

/** How long the host's words rest before the preview shows them. */
const WORDS_PAUSE_MS = 300;

export function cardPanel(session: HostSession, director: Director): HTMLElement {
  const all = presets();
  let chosen: Stunt = all[0];
  let style: CardStyle = 'wall';
  /** The event template behind the current picture, rebuilt when the names change. */
  let moment: Moment | null = null;
  const preview = h('div.stunt-preview');
  const previews = Object.fromEntries(STYLE_KEYS.map((k) => [k, STYLES[k].preview(session, preview)])) as Record<CardStyle, (s: Stunt) => void>;
  const show = () => previews[style](chosen);
  /** Whether the host has chosen a picture, words or template, as opposed to the one that is showing at the start. */
  let picked = false;
  /** The timer that shows the words once typing pauses. */
  let typing = 0;
  const pick = (s: Stunt, m: Moment | null = null) => {
    clearTimeout(typing);
    picked = true;
    flips.cancel();
    if (s !== chosen) chosen.close?.();
    chosen = s;
    moment = m;
    show();
    thumbs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(!m && b.dataset.name === s.name)));
    moments.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.name === m?.name)));
  };
  const names = [h('input', { type: 'text', id: 'stunt-name-1', maxlength: 12, placeholder: 'SAM', autocomplete: 'off' }), h('input', { type: 'text', id: 'stunt-name-2', maxlength: 12, placeholder: 'ALEX', autocomplete: 'off' })];
  // Only what the host typed: a placeholder never goes on the crowd.
  const typed = (): [string, string] => names.map((n) => n.value.trim().toUpperCase()) as [string, string];
  const useMoment = (m: Moment) => {
    pick(m.make(typed(), session.layout.aspect), m);
    say(missingNames(m, typed()) ?? '');
  };
  for (const n of names) n.addEventListener('input', () => moment && moment.names > 0 && useMoment(moment));
  // Enter means "done typing": on to Flip, which is what comes next.
  const enterToFlip = (field: HTMLInputElement, before = () => {}) =>
    field.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      before();
      flip.focus();
    });
  names.forEach((n) => enterToFlip(n));
  const moments = h(
    'div.moments',
    { role: 'group', 'aria-label': 'Event templates' },
    ...MOMENTS.map((m) => h('button.btn.small', { type: 'button', 'data-name': m.name, 'aria-pressed': 'false', onclick: () => useMoment(m) }, m.name)),
  );
  const rec = recorder();
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
  const useWords = () => {
    const text = words.value.trim().toUpperCase();
    if (text) pick(textStunt(text, session.layout.aspect));
  };
  // The preview follows what is typed, as the names do, once the typing pauses.
  words.addEventListener('input', () => {
    clearTimeout(typing);
    typing = window.setTimeout(useWords, WORDS_PAUSE_MS);
  });
  enterToFlip(words, useWords);
  const file = h('input', { type: 'file', accept: 'image/*', id: 'stunt-file' });
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    try {
      pick(await fileStunt(f));
      say('Your picture is ready. Press Flip the cards.');
      // Straight to Flip, for the mouse and the keyboard alike: no hunt past every design.
      flip.focus();
    } catch {
      fail('That file could not be read as a picture.');
    }
  });
  const flip = h('button.btn.primary', { type: 'button' }, 'Flip the cards');
  flip.addEventListener('click', async () => {
    if (flips.inFlight) return;
    const missing = moment && missingNames(moment, typed());
    if (missing) return fail(missing), names[typed()[0] ? 1 : 0].focus();
    if (!requirePlaced(session, { fail, retract })) return;
    const [s, picture] = [style, chosen];
    if (!(await flips.press((ctl) => STYLES[s].flip(session, picture, ctl)))) return;
    // Film the countdown, the flip, and a few seconds of the crowd holding it.
    rec?.begin(FLIP_LEAD_MS + 8000);
    say(STYLES[s].status(session.playRoom().positions.size));
  });
  // Every style's note stays in the page; only the chosen style's is shown.
  const notes = STYLE_KEYS.map((k) => h('p.note', { hidden: k !== style }, STYLES[k].note));
  const styles = segmented<CardStyle>('Style', STYLE_KEYS.map((k) => [k, STYLES[k].label]), style, (v) => {
    flips.cancel();
    style = v;
    notes.forEach((n, i) => (n.hidden = STYLE_KEYS[i] !== v));
    show();
  });
  session.subscribe(show);
  show();
  const lineUp = () => {
    const after = session.layout.positions.size > 0;
    const seats = session.lineUp();
    if (seats.length === 0) return;
    say(lineUpSaid(seats, after));
    // The button is gone now that everyone is on the map: carry on at the next step.
    (picked ? flip : file).focus();
  };
  const { el, say, fail, retract } = footedPanel(
    'Turn your photo or your words into a crowd stunt. Every phone flips together on a 3, 2, 1 countdown.',
    [
      placementNote(session, 'Card stunt needs phones on the map.', lineUp),
      styles,
      ...notes,
      h('label.file.primary-choice', { for: 'stunt-file' }, 'Upload your own picture', file),
      h('p.note', {}, 'Or pick one of these ready-made designs:'),
      thumbs,
      moments,
      h('div.row', {}, h('label.grow', { for: 'stunt-name-1' }, 'Name (birthday, couple)', names[0]), h('label.grow', { for: 'stunt-name-2' }, 'Second name (couple)', names[1])),
      h('div.row', {}, h('label.grow', { for: 'stunt-words' }, 'Or your words', words), h('button.btn', { type: 'button', onclick: useWords }, 'Use words')),
      preview,
      rec?.el,
    ],
    [flip],
  );
  // Busy but not disabled, so Flip keeps the keyboard focus the upload gave it.
  const flips = flipper(director, { say, fail, busy: (on) => (on ? flip.setAttribute('aria-disabled', 'true') : flip.removeAttribute('aria-disabled')) }, rec?.end);
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
  let gen = 0;
  const send = throttle(() => wave && session.setProgram({ ...wave }), 150);
  return {
    /** The run to hand the director; edits after this go straight to the phones. */
    start(w: WaveParams, leadMs: number): Run {
      const mine = ++gen;
      wave = makeWave(session.now() + leadMs, w);
      send.sent();
      return {
        program: { ...wave },
        stop: () => {
          if (mine !== gen) return;
          wave = null;
          send.cancel();
        },
      };
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
      send();
    },
  };
}

export function wavePanel(session: HostSession, stage: Stage, director: Director): HTMLElement {
  const wave = liveWave(session);
  const go = (w: WaveParams) => {
    if (!requirePlaced(session, { fail, retract })) return;
    director.run(wave.start(w, 250));
    controls.arm();
    say('Rolling. Change anything and it updates live.');
  };
  const controls = waveControls(stage, {}, wave.retune, true);
  const { el, say, fail, retract } = panel(
    'A band of light rolls through the room in real space: a sweep from wall to wall, a ping-pong, or a ripple spreading out from any spot you tap on the map.',
    placementNote(session, 'The wave needs phones on the map.'),
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
    if (!requirePlaced(session, { fail, retract })) return;
    director.run(wave.start(params(), 400));
    say(`Playing ${current.name}. Phones that tapped “Join” and are off silent will sing.`);
  };
  const { el, say, fail, retract } = panel(
    'Every phone is one speaker on the shared clock, so sound moves through the crowd. The header shows how closely the phones’ clocks agree, and a Bluetooth speaker on a phone adds its own delay. Each phone sings its own note, set by where it sits.',
    placementNote(session, 'Spatial tones need phones on the map.'),
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
  const party = speakerPanel(session, director);
  el.hidden = true;
  const mode = segmented<'party' | 'tones'>('Music mode', [['party', 'Party speaker'], ['tones', 'Spatial tones']], 'party', (v) => {
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
    runGame<TerritoryState>(session, director, { say, fail }, {
      ...territoryRules(Number(duration.value) * 1000, TEAMS),
      show: (s, _prev, room) => {
        bar.style.setProperty('--b', String(s.boundary));
        const [a, b] = teamSizes(s, room);
        const left = Math.max(0, Math.ceil((s.endsAt - session.now()) / 1000));
        setText(
          score,
          s.phase === 'over'
            ? s.winner === null
              ? 'Dead heat. A draw!'
              : `${s.winner === 0 ? 'Amber' : 'Teal'} wins with ${Math.round((s.winner === 0 ? s.boundary : 1 - s.boundary) * 100)}% of the floor.`
            : `Amber ${plural(a, 'phone')}, ${plural(s.taps[0], 'tap')} · Teal ${plural(b, 'phone')}, ${plural(s.taps[1], 'tap')} · ${left}s left`,
        );
      },
    });
  const { el, say, fail } = panel(
    'A no-TV icebreaker: the room is the scoreboard. It splits down the middle into Amber and Teal. Every tap shoves the front line into the other side, and any phone the line passes over defects. Push it to the wall to win.',
    placementNote(session, 'Territory needs at least 2 phones on the map.'),
    bar,
    score,
    h('div.row', {}, h('label.num', { for: 'terr-dur' }, 'Round', duration), h('button.btn.primary', { type: 'button', onclick: start }, 'Start Territory')),
  );
  return el;
}

export function potatoPanel(session: HostSession, director: Director): HTMLElement {
  const score = h('p.score', { role: 'status', 'aria-live': 'polite' }, 'A ball of fire jumps between neighbours. Tap when it lands on you.');
  const start = () =>
    runGame<PotatoState>(session, director, { say, fail }, {
      ...POTATO_RULES,
      show: (s, prev, room) => {
        if (s === prev) return;
        if (s.phase === 'over') setText(score, s.winner === null ? 'Everyone burnt out!' : `Phone ${s.winner + 1} is the last one standing after ${plural(s.passes, 'throw')}.`);
        else if (!prev || prev.out.length !== s.out.length || prev.holder !== s.holder) {
          const alive = room.positions.size - s.out.length;
          setText(score, `Ball on phone ${s.holder + 1} · fuse ${(s.fuse / 1000).toFixed(1)}s · ${alive} still in · ${plural(s.passes, 'throw')}`);
        }
      },
    });
  const { el, say, fail } = panel(
    'A no-TV icebreaker: the game plays out on the phones themselves. A glowing ball flies across the crowd from phone to phone. When it lands on yours, tap before the fuse runs out to throw it to a neighbour. Miss and your phone burns out. The fuse gets shorter every throw.',
    placementNote(session, 'Hot Potato needs at least 2 phones on the map.'),
    h('div.legend', {}, h('span', { style: `--c:${css([255, 96, 16])}` }, 'Ball'), h('span', { style: `--c:${css(EMBER)}` }, 'Burnt out')),
    score,
    h('button.btn.primary', { type: 'button', onclick: start }, 'Start Hot Potato'),
  );
  return el;
}
