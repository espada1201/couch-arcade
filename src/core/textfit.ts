// Auto-fit for text shown full screen on a phone: the largest font size at which the
// text, wrapped at spaces, fits the box. Measuring is injected (canvas measureText on
// the phone, a fixed-width stand-in in tests), so the search itself is pure.

/** Width in px of `text` set at `size` px. */
export type Measure = (text: string, size: number) => number;

export interface FitLine {
  text: string;
  /** Which input paragraph (line of the source text) this line came from. */
  para: number;
}

export interface Fit {
  size: number;
  lines: FitLine[];
}

export interface FitOptions {
  min?: number;
  max?: number;
  /** Line box height as a multiple of the font size. */
  lineHeight?: number;
}

/** Greedy wrap at spaces. With `hard`, a word wider than the box is broken between characters. */
function wrap(paras: string[], size: number, w: number, measure: Measure, hard: boolean): FitLine[] | null {
  const out: FitLine[] = [];
  for (let para = 0; para < paras.length; para++) {
    let line = '';
    for (const word of paras[para].split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (measure(next, size) <= w) {
        line = next;
        continue;
      }
      if (line) out.push({ text: line, para });
      line = word;
      if (measure(word, size) <= w) continue;
      if (!hard) return null;
      line = '';
      for (const ch of word) {
        if (line && measure(line + ch, size) > w) {
          out.push({ text: line, para });
          line = '';
        }
        line += ch;
      }
    }
    if (line) out.push({ text: line, para });
  }
  return out;
}

export function fitText(text: string, box: { w: number; h: number }, measure: Measure, opts: FitOptions = {}): Fit {
  const { min = 12, max = Infinity, lineHeight = 1.2 } = opts;
  const paras = text.split('\n').filter((p) => p.trim());
  const fitsAt = (size: number) => {
    const lines = wrap(paras, size, box.w, measure, false);
    return lines && lines.length * size * lineHeight <= box.h ? lines : null;
  };
  let lo = min;
  let hi = Math.floor(Math.min(max, box.h / lineHeight));
  let best = hi >= lo ? fitsAt(lo) : null;
  // Nothing fits even at the smallest size: show it small, broken mid-word if need be.
  if (!best) return { size: min, lines: wrap(paras, min, box.w, measure, true)! };
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const lines = fitsAt(mid);
    if (lines) {
      lo = mid;
      best = lines;
    } else hi = mid - 1;
  }
  return { size: lo, lines: best };
}
