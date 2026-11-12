export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Creates an element; text goes in as text, never as markup. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text = "",
  attributes: Record<string, string | number> = {}
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  for (const name in attributes) el.setAttribute(name, String(attributes[name]));
  return el;
}

/** Layout offset of `el` inside its positioned ancestor `box`, unaffected by transforms. */
export function offsetIn(el: HTMLElement, box: HTMLElement) {
  let x = 0;
  let y = 0;
  for (let node: HTMLElement | null = el; node && node !== box; node = node.offsetParent as HTMLElement | null) {
    x += node.offsetLeft;
    y += node.offsetTop;
  }
  return { x, y };
}
