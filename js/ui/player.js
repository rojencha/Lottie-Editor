// Preview player on top of lottie-web (SVG renderer). Self-hosted copy first, CDN as a fallback.
import { h, icon, paintRange } from "./dom.js";

let loading = null;
export function ensureLottie() {
  if (window.lottie) return Promise.resolve();
  if (!loading) loading = new Promise((res, rej) => {
    const load = (src) => new Promise((ok, no) => { const s = h("script", { src }); s.onload = ok; s.onerror = no; document.head.append(s); });
    load("lottie.min.js").catch(() => load("https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js")).then(res, () => { loading = null; rej(new Error("player")); });
  });
  return loading;
}
export const prefersReducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Mount an animation. `data` is cloned because lottie-web mutates what it is given. */
export async function mountPlayer(container, data, { loop = true, autoplay = true, startFrame = 0, paused = false } = {}) {
  await ensureLottie();
  const slot = h("div", { class: "slot" }); container.append(slot);
  const anim = lottie.loadAnimation({ container: slot, renderer: "svg", loop, autoplay: false, animationData: structuredClone(data), rendererSettings: { preserveAspectRatio: "xMidYMid meet" } });
  const play = autoplay && !paused && !prefersReducedMotion();
  const start = () => { if (startFrame) anim[play ? "goToAndPlay" : "goToAndStop"](Math.min(startFrame, anim.totalFrames - 1), true); else if (play) anim.play(); };
  anim.addEventListener("DOMLoaded", start);
  const svg = slot.querySelector("svg"); if (svg) { svg.setAttribute("role", "img"); svg.setAttribute("aria-label", "Animation preview"); }
  return {
    anim, get paused() { return anim.isPaused; }, get frame() { return anim.currentFrame; }, get total() { return anim.totalFrames; },
    play() { anim.play(); }, pause() { anim.pause(); }, toggle() { anim.isPaused ? anim.play() : anim.pause(); }, seek(f) { anim.goToAndStop(f, true); },
    setLoop(b) { anim.setLoop(b); }, on(ev, cb) { anim.addEventListener(ev, cb); },
    destroy() { try { anim.destroy(); } catch { /* already gone */ } slot.remove(); },
  };
}

/** Mount lazily: create when near the viewport, destroy when far away (keeps many cards cheap). */
export function lazyMount(container, getData, opts = {}) {
  let p = null, busy = false, dead = false;
  const io = new IntersectionObserver(async (entries) => {
    for (const e of entries) {
      if (e.isIntersecting && !p && !busy) {
        busy = true;
        try { const data = await getData(); if (dead) return; p = await mountPlayer(container, data, opts); }
        catch { container.replaceChildren(h("span", { class: "ph", title: "Preview unavailable" }, icon("warn"))); }
        finally { busy = false; }
      } else if (!e.isIntersecting && p) { p.destroy(); p = null; }
    }
  }, { rootMargin: "240px" });
  io.observe(container);
  return () => { dead = true; io.disconnect(); if (p) p.destroy(); };
}

/** Transport controls (play/pause, scrubber, frame readout). Re-attachable so the editor can swap players. */
export function createControls() {
  const play = h("button", { class: "play-btn", type: "button", "aria-label": "Play" }, icon("play"));
  const scrub = h("input", { type: "range", min: 0, max: 100, value: 0, step: 1, "aria-label": "Timeline" });
  const info = h("span", { class: "frame-info", "aria-live": "off" });
  const el = h("div", { class: "player" }, play, scrub, info);
  let p = null;
  const setIcon = (on) => { play.replaceChildren(icon(on ? "pause" : "play")); play.setAttribute("aria-label", on ? "Pause" : "Play"); };
  play.onclick = () => { if (!p) return; p.toggle(); setIcon(!p.paused); };
  scrub.oninput = () => { if (!p) return; p.seek(+scrub.value); setIcon(false); paintRange(scrub); };
  return {
    el, loop: () => true,
    attach(player) {
      p = player; if (!p) return;
      p.on("DOMLoaded", () => { scrub.max = Math.max(1, Math.floor(p.total) - 1); setIcon(!p.paused); info.textContent = `0 / ${Math.round(p.total)}`; });
      p.on("enterFrame", () => { scrub.value = p.frame; paintRange(scrub); info.textContent = `${Math.round(p.frame)} / ${Math.round(p.total)}`; });
      p.on("complete", () => setIcon(false));
      paintRange(scrub);
    },
    toggle() { play.click(); }, setPlaying: setIcon, pause() { if (p && !p.paused) { p.pause(); setIcon(false); } },
  };
}

/** Preview background: transparency checkerboard, solid colours or a custom colour. */
export function stageBackground(stages, v) {
  for (const stage of [].concat(stages)) {
    if (v === "checker") { stage.style.backgroundColor = ""; stage.style.backgroundImage = ""; }
    else { stage.style.backgroundImage = "none"; stage.style.backgroundColor = v; }
  }
}
export function backgroundControl(stage, initial = "checker") {
  const color = h("input", { type: "color", value: "#ffffff", "aria-label": "Custom preview background", hidden: true });
  const sel = h("select", { class: "pop", "aria-label": "Preview background" }, [["checker", "Transparent"], ["#ffffff", "White"], ["#111418", "Dark"], ["custom", "Custom…"]].map(([v, t]) => h("option", { value: v, selected: v === initial }, t)));
  const apply = () => { color.hidden = sel.value !== "custom"; stageBackground(stage, sel.value === "custom" ? color.value : sel.value); };
  sel.onchange = apply; color.oninput = apply; apply();
  return h("label", { class: "row", style: { gap: "8px" } }, "Background", sel, color);
}
