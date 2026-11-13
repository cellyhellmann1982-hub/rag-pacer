type Child = Node | string | null | undefined | false;
type Props = Record<string, unknown>;

/** Kleine Hilfsfunktion zum Erzeugen von DOM-Elementen. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k.startsWith('on') && typeof v === 'function')
        el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (k in el) (el as unknown as Props)[k] = v;
      else el.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c);
  }
  return el;
}

/** Knopf, der erst beim zweiten Tippen auslöst (statt eines Bestätigungsdialogs). */
export function twoTapButton(
  label: string,
  confirmLabel: string,
  action: () => void,
  cls = 'btn btn-small btn-danger',
): HTMLButtonElement {
  let armed = false;
  let timer = 0;
  const btn = h('button', { type: 'button', class: cls }, label);
  btn.addEventListener('click', () => {
    if (armed) {
      window.clearTimeout(timer);
      action();
      return;
    }
    armed = true;
    btn.textContent = confirmLabel;
    timer = window.setTimeout(() => {
      armed = false;
      btn.textContent = label;
    }, 4000);
  });
  return btn;
}

export function download(filename: string, mime: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
