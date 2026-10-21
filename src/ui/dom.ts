type Attrs = Record<string, string | number | boolean | EventListener | undefined>;
type Child = Node | string | null | undefined | false;

/** Minimal element builder: h('button.primary', { onclick }, 'Go'). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K | `${K}.${string}`, attrs: Attrs = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name as K);
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className += ` ${v}`;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const kid of kids) if (kid !== null && kid !== undefined && kid !== false) el.append(kid);
  return el;
}

export function css(rgb: readonly number[]): string {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

/** Segmented control (radio group) with arrow-key support. */
export function segmented<T extends string>(label: string, options: [T, string][], value: T, onChange: (v: T) => void): HTMLElement {
  const name = `seg-${Math.random().toString(36).slice(2)}`;
  return h(
    'fieldset.seg',
    {},
    h('legend', {}, label),
    ...options.map(([v, text]) =>
      h(
        'label',
        {},
        h('input', { type: 'radio', name, value: v, checked: v === value, onchange: () => onChange(v) }),
        h('span', {}, text),
      ),
    ),
  );
}

export function slider(label: string, min: number, max: number, step: number, value: number, fmt: (v: number) => string, onInput: (v: number) => void): HTMLElement {
  const out = h('output', {}, fmt(value));
  const input = h('input', { type: 'range', min, max, step, value });
  input.addEventListener('input', () => {
    out.textContent = fmt(Number(input.value));
    onInput(Number(input.value));
  });
  return h('label.slider', {}, h('span', {}, label), input, out);
}
