// Party Speaker: the host picks a song, every phone downloads it over the room's own
// link, and they all play it in step on the shared clock.
import { audioFileProblem, clockTime, durationProblem, MAX_TRACK_SECONDS, PAUSED, playingAt, positionAt, schedule, type Command, type SpeakerProgram, type Track } from '../core/speaker';
import { randomId } from '../net/transport';
import { h, plural, setText, slider } from '../ui/dom';
import type { Director, Hold } from './director';
import { FileShare } from './fileshare';
import { panel, stopButton } from './panel';
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

  const send = () => session.setProgram({ ...prog });
  const sendSoon = throttle(send, 150);

  const load = async (f: File) => {
    const problem = audioFileProblem(f.name, f.type, f.size);
    if (problem) return say(problem);
    say(`Reading ${f.name}…`);
    let data: Uint8Array;
    let duration: number;
    try {
      data = new Uint8Array(await f.arrayBuffer());
      duration = await probe(data);
    } catch {
      return say('That file could not be read as audio. Try an MP3.');
    }
    const tooLong = durationProblem(duration);
    if (tooLong) return say(tooLong);
    share?.stop();
    const id = randomId(8);
    share = new FileShare(session, id, data);
    share.start();
    const track: Track = { id, name: f.name.replace(/\.[^.]+$/, '').slice(0, 80), size: f.size, n: share.n, duration };
    prog = { ...prog, track, tl: PAUSED };
    // Picking a song doesn't take over the room: phones fetch it quietly until Play.
    session.offer(track);
    if (active()) send();
    seek.max = String(duration);
    say(active() ? '' : 'Sending the song to every phone. Whatever is running keeps running until you press Play.');
    refresh();
  };

  const command = (cmd: Command, lead: number) => {
    const track = prog.track;
    if (!track) return say('Pick a song first.');
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
  const drop = h('label.file.drop', { for: 'speaker-file' }, `Pick a song file (MP3 or M4A; WAV and OGG work too), up to ${MAX_TRACK_SECONDS / 60} minutes, or drop it here`, file);
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
    const pos = positionAt(prog.tl, now, t.duration);
    setText(toggle, willPlay(t) ? 'Pause' : 'Play');
    if (!seeking) seek.value = String(pos);
    setText(time, `${clockTime(pos)} / ${clockTime(t.duration)}`);
    const online = session.online.length;
    const list = share?.progress() ?? [];
    const done = list.filter((p) => p.state === 'ready').length;
    const failed = list.filter((p) => p.state === 'error').length;
    setText(
      ready,
      `${done} of ${plural(online, 'phone')} ready` + (failed ? ` · ${failed} can’t play this file` : '') + (playingAt(prog.tl, now, t.duration) ? ' · playing' : ''),
    );
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
  setInterval(() => el.isConnected && refresh(), 400);

  const { el, say } = panel(
    'No speaker? Every phone in the room plays your song at the same moment on the shared clock, so the song fills the room. In our tests the phones played within 10 ms of each other, and the header shows how closely your room agrees (in sync to ±N ms). A Bluetooth speaker or headphones on a phone add their own delay. Nothing to install on the phones. You need the song as a file (MP3 or M4A): music in streaming apps can’t be shared this way.',
    drop,
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
