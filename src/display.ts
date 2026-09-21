/* Viewer display preferences: stored per browser, applied as attributes on
   <html> so CSS can respond, and announced to assistive technology. */
export type Display = {
  motion: "system" | "reduce" | "allow";
  text: "default" | "large" | "larger";
  contrast: boolean;
  simple: boolean;
};
export const DEFAULT_DISPLAY: Display = {
  motion: "system",
  text: "default",
  contrast: false,
  simple: false,
};
const KEY = "headroom.display";
export function readDisplay(): Display {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return { ...DEFAULT_DISPLAY, ...(stored ?? {}) };
  } catch {
    return DEFAULT_DISPLAY;
  }
}
export function applyDisplay(d: Display) {
  const root = document.documentElement;
  const set = (name: string, value: string | null) =>
    value ? root.setAttribute(name, value) : root.removeAttribute(name);
  set("data-motion", d.motion === "system" ? null : d.motion);
  set("data-text", d.text === "default" ? null : d.text);
  set("data-contrast", d.contrast ? "high" : null);
  set("data-simple", d.simple ? "on" : null);
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* private mode: preferences last for the session only */
  }
}
