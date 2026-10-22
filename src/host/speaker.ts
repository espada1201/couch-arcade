// Party Speaker: the host picks a song, every phone downloads it over the room's own
// link, and they all play it in step on the shared clock.
import { audioFileProblem, clockTime, deliveryStatus, durationProblem, MAX_TRACK_SECONDS, PAUSED, pendingStart, playingAt, positionAt, schedule, type Command, type SpeakerProgram, type Track } from '../core/speaker';
import { randomId } from '../net/transport';
import { h, plural, setText, slider } from '../ui/dom';
import type { Director, Hold } from './director';
import { FileShare } from './fileshare';
import { notice, panel, stopButton } from './panel';
import { throttle } from './throttle';
import type { HostSession } from './session';

/** Play starts this far ahead so every phone has the message and its audio scheduled in time. */
const PLAY_LEAD_MS = 1500;
/** Pause and seek touch audio phones have already decoded, so they need less. */
const EDIT_LEAD_MS = 600;

/** Reads the duration, and proves the browser can decode the file before phones download it. */
async function probe(data: Uint8Array): Promise<number> {
  const ctx = new OfflineAudioContext(1, 1, 44100);
  // decodeAudioData takes ownership of the buffer it is given, so hand it a copy.
  const buf = await ctx.decodeAudioData(data.slice().buffer);
  return buf.duration;
}

export function speakerPanel(session: HostSession, director: Director): HTMLElement {
  let prog: SpeakerProgram = { kind: 'speaker', track: null, tl: PAUSED, volume: 1, spread: false };
  let share: FileShare | null = null;
  /** Held from Play until something else takes the room. */
  let hold: Hold | null = null;
  const active = () => !!hold?.active;
  // Phones fetch the song in the background, so their acks are heard whatever holds the room.
  session.input({ have: (seat, m) => share?.have(seat, m) });

  /** Messages about the chosen file sit under the picker, where the host is looking. */
  const picker = notice();
  /** While the picker shows its own message (reading a file, or why it was refused), the live delivery line stays out of its way. */
  let pickerBusy = false;

  const send = () => session.setProgram({ ...prog });
  // Something else may have taken the room while the volume change waited its turn.
  const sendSoon = throttle(() => active() && send(), 150);

  const refuse = (text: string) => {
    pickerBusy = true;
    picker.fail(text);
  };

  const load = async (f: File) => {
    const problem = audioFileProblem(f.name, f.type, f.size);
    if (problem) return refuse(problem);
    pickerBusy = true;
    picker.say(`Reading ${f.name}…`);
    let data: Uint8Array;
    let duration: number;
    try {
      data = new Uint8Array(await f.arrayBuffer());
      duration = await probe(data);
    } catch {
      return refuse('That file could not be read as audio. Try an MP3.');
    }
    const tooLong = durationProblem(duration);
    if (tooLong) return refuse(tooLong);
    share?.stop();
    const id = randomId(8);
    share = new FileShare(session, id, data);
    share.start();
    tick();
    const track: Track = { id, name: f.name.replace(/\.[^.]+$/, '').slice(0, 80), size: f.size, n: share.n, duration };
    prog = { ...prog, track, tl: PAUSED };
    // Picking a song doesn't take over the room: phones fetch it quietly until Play.
    session.offer(track);
    if (active()) send();
    seek.max = String(duration);
    // From here the line under the picker follows the phones (see refresh).
    pickerBusy = false;
    refresh();
    // Play sits under the song details; bring it into view once there is a song to play.
    toggle.scrollIntoView({ block: 'nearest' });
  };

  const command = (cmd: Command, lead: number) => {
    const track = prog.track;
    if (!track) return fail('Pick a song first.');
    prog = { ...prog, tl: schedule(prog.tl, session.now(), lead, track.duration, cmd) };
    if (active()) send();
    // Only Play takes the room; a seek while the room is elsewhere just moves where Play starts.
    else if (cmd === 'play')
      hold = director.run({
        // Something else took the room: the song stops here too, so the host never shows "playing" to a silent room.
        stop: () => {
          const t = prog.track;
          if (t) prog = { ...prog, tl: [{ at: 0, pos: positionAt(prog.tl, session.now(), t.duration), playing: false }] };
          refresh();
        },
        program: { ...prog },
      });
    say('');
    refresh();
  };

  /** Whether the song will be playing once every pending command has landed (so a quick second press undoes the first). */
  const willPlay = (t: Track) => playingAt(prog.tl, Math.max(prog.tl[prog.tl.length - 1].at, session.now()), t.duration);

  // MP3 and M4A play on every phone; the picker leads with them.
  const file = h('input', { type: 'file', id: 'speaker-file', accept: '.mp3,.m4a,audio/mpeg,audio/mp4,audio/x-m4a,.wav,.ogg,audio/*' });
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (f) void load(f);
  });
  const drop = h(
    'label.file.drop',
    { for: 'speaker-file' },
    h('span.pick.btn.primary.big', {}, 'Pick a song'),
    h('span.drop-hint', {}, `MP3, M4A or WAV, up to ${MAX_TRACK_SECONDS / 60} minutes. You can also drop the file here.`),
    file,
  );
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    const f = e.dataTransfer?.files[0];
    if (f) void load(f);
  });

  const title = h('p.np-host-title', {}, 'No song yet');
  const toggle = h('button.btn.primary', { type: 'button', disabled: true }, 'Play');
  toggle.addEventListener('click', () => {
    const t = prog.track;
    if (!t) return;
    const playing = willPlay(t);
    command(playing ? 'pause' : 'play', playing ? EDIT_LEAD_MS : PLAY_LEAD_MS);
  });
  const seek = h('input', { type: 'range', min: 0, max: 1, step: 0.1, value: 0, 'aria-label': 'Position in the song', disabled: true });
  let seeking = false;
  seek.addEventListener('input', () => (seeking = true));
  seek.addEventListener('change', () => {
    seeking = false;
    command({ seek: Number(seek.value) }, EDIT_LEAD_MS);
  });
  const time = h('span.np-time', {}, '0:00 / 0:00');
  const volume = slider('Volume', 0, 1, 0.05, 1, (v) => `${Math.round(v * 100)}%`, (v) => {
    prog = { ...prog, volume: v };
    if (active()) sendSoon();
  });
  const spread = h('input', { type: 'checkbox', id: 'speaker-spread' });
  spread.addEventListener('change', () => {
    prog = { ...prog, spread: spread.checked };
    if (active()) send();
  });
  const ready = h('p.score', { role: 'status', 'aria-live': 'polite' });
  const phones = h('ul.np-phones', { 'aria-label': 'Download progress per phone' });

  const refresh = () => {
    const t = prog.track;
    setText(title, t ? t.name : 'No song yet');
    toggle.disabled = seek.disabled = !t;
    if (!t) return;
    const now = session.now();
    // Between pressing Play and the instant every phone starts, show where the song is about to start, and say so.
    const starting = pendingStart(prog.tl, now, t.duration);
    const pos = starting ? starting.pos : positionAt(prog.tl, now, t.duration);
    setText(toggle, willPlay(t) ? 'Pause' : 'Play');
    if (!seeking) seek.value = String(pos);
    setText(time, `${starting ? 'Starting… ' : ''}${clockTime(pos)} / ${clockTime(t.duration)}`);
    const online = session.online.length;
    const list = share?.progress() ?? [];
    const done = list.filter((p) => p.state === 'ready').length;
    const failed = list.filter((p) => p.state === 'error').length;
    const playing = playingAt(prog.tl, now, t.duration);
    setText(ready, `${done} of ${plural(online, 'phone')} ready` + (failed ? ` · ${failed} can’t play this file` : '') + (playing ? ' · playing' : ''));
    if (!pickerBusy) picker.say(deliveryStatus({ online, ready: done, failed, playing: playing || !!starting }));
    phones.replaceChildren(
      ...list.map((p) =>
        h(
          'li',
          { 'data-seat': p.seat, style: `--p:${p.progress}` },
          `Phone ${p.seat + 1}`,
          h('span', {}, p.state === 'ready' ? 'ready' : p.state === 'error' ? 'can’t play' : `${Math.round(p.progress * 100)}%`),
        ),
      ),
    );
  };
  // The clock and per-phone progress tick once there is a song, and redraw only while the panel shows.
  let ticking = 0;
  const tick = () => (ticking ||= window.setInterval(() => el.isConnected && refresh(), 400));

  const { el, say, fail } = panel(
    'Play one song on every phone at once. Every phone starts at the same moment and needs no install, but the song must be a file on this computer (MP3, M4A or WAV), because streaming apps can’t share music.',
    drop,
    picker.el,
    title,
    h('div.row', {}, toggle, stopButton(director, () => say('')), time),
    seek,
    volume,
    h('label.check', { for: 'speaker-spread' }, spread, 'Stereo spread: left of the room plays the left channel, right plays the right'),
    ready,
    phones,
  );
  return el;
}
