/**
 * The pad on the on-screen clickables: the title card, the phone, the big map.
 *
 * The D-pad (or the left stick, on a modal layer) moves a focus ring to the
 * nearest clickable in that direction, Cross clicks it, Circle backs out. A
 * `cursor` layer -- the map, whose clicks are positions rather than buttons --
 * gets a crosshair the left stick drives, and Cross clicks where it points.
 *
 * `layer()` says what is open, topmost first: null, or
 * { root, modal, cursor, back, toggle } -- `toggle` is the button index that
 * opened it and closes it again alongside Circle. update() returns the layer
 * so input.read() can keep those buttons (and, on a modal layer, the sticks)
 * out of the game.
 */
import { deadzone } from '../game/input.js';

const CLICKABLE = 'button, [role=button], .go';
const DIRS = { 12: [0, -1], 13: [0, 1], 14: [-1, 0], 15: [1, 0] };   // D-pad up, down, left, right
const CURSOR_PX = 900;   // map crosshair at full stick, px/s

/** Index of the centre nearest `from` in direction `dir` ([dx, dy], screen
 *  space), off-axis distance counted double; -1 when nothing lies that way. */
export function nearestInDirection(from, centres, dir) {
  let best = -1, bestScore = Infinity;
  centres.forEach((c, i) => {
    const dx = c.x - from.x, dy = c.y - from.y;
    const along = dx * dir[0] + dy * dir[1];
    if (along <= 1) return;
    const score = along + 2 * Math.abs(dx * dir[1] - dy * dir[0]);
    if (score < bestScore) { bestScore = score; best = i; }
  });
  return best;
}

const centre = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
const candidates = (root) => [...root.querySelectorAll(CLICKABLE)].filter((el) => !el.disabled && el.getClientRects().length);

export function createPadNav(layer) {
  const prev = [];
  let open = null, focus = null, lastXY = { x: 0, y: 0 }, dirHeld = -1, repeatT = 0;
  let cx = NaN, cy = NaN, cross = null;

  function setFocus(el) {
    focus?.classList.remove('padfocus');
    focus = el;
    if (!el) return;
    el.classList.add('padfocus');
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });   // the phone's list scrolls
    lastXY = centre(el);
  }
  const byDefault = (root) => root.querySelector('[data-pad-default]') ?? candidates(root)[0] ?? null;
  function step(i) {
    const list = candidates(open.root);
    if (!focus) return setFocus(byDefault(open.root));
    const j = nearestInDirection(centre(focus), list.map(centre), DIRS[i]);
    if (j >= 0) setFocus(list[j]);
  }
  function showCross(on) {
    if (!cross) {
      cross = document.createElement('div');
      cross.style.cssText = 'position:fixed;z-index:75;width:22px;height:22px;margin:-11px 0 0 -11px;border:2px solid #39ffb0;'
        + 'border-radius:50%;box-shadow:0 0 0 1px #000;pointer-events:none;display:none';
      document.body.appendChild(cross);
    }
    cross.style.display = on ? 'block' : 'none';
  }

  return {
    update(dt) {
      const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
      const btn = [];
      let lx = 0, ly = 0, live = false;
      for (const p of pads) {
        if (!p) continue;
        live = true;
        p.buttons.forEach((b, i) => { if (b.pressed) btn[i] = true; });
        lx += deadzone(p.axes[0] ?? 0); ly += deadzone(p.axes[1] ?? 0);
      }
      const hit = (i) => btn[i] && !prev[i];
      const L = layer();
      if (L?.root !== open?.root) {            // a layer opened, closed or gave way to another
        open = L;
        setFocus(null);
        showCross(false);
        dirHeld = -1;
        cx = cy = NaN;                         // the crosshair starts at the centre
        if (L && live && !L.cursor) setFocus(byDefault(L.root));
      }
      if (L && live) {
        if (L.cursor) {
          const r = L.root.getBoundingClientRect();
          if (Number.isNaN(cx)) { cx = r.left + r.width / 2; cy = r.top + r.height / 2; }
          cx = Math.max(r.left, Math.min(r.right, cx + lx * Math.abs(lx) * CURSOR_PX * dt));
          cy = Math.max(r.top, Math.min(r.bottom, cy + ly * Math.abs(ly) * CURSOR_PX * dt));
          showCross(true);
          cross.style.left = cx + 'px'; cross.style.top = cy + 'px';
          if (hit(0)) L.root.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: cx, clientY: cy }));
        } else {
          // the phone re-renders on most clicks: land on whatever now sits where the focus was
          if (focus && !(focus.isConnected && L.root.contains(focus))) {
            let best = null, bd = Infinity;
            for (const el of candidates(L.root)) { const c = centre(el), d = Math.hypot(c.x - lastXY.x, c.y - lastXY.y); if (d < bd) { bd = d; best = el; } }
            setFocus(best);
          }
          let dir = [12, 13, 14, 15].find((i) => btn[i]) ?? -1;
          if (dir < 0 && L.modal && Math.hypot(lx, ly) > 0.5) dir = Math.abs(lx) > Math.abs(ly) ? (lx > 0 ? 15 : 14) : (ly > 0 ? 13 : 12);
          if (dir !== dirHeld) { dirHeld = dir; repeatT = 0.38; if (dir >= 0) step(dir); }
          else if (dir >= 0 && (repeatT -= dt) <= 0) { repeatT = 0.11; step(dir); }
          if (hit(0)) { if (focus) focus.click(); else setFocus(byDefault(L.root)); }
        }
        if (hit(1) || hit(L.toggle)) L.back?.();
      }
      for (let i = 0; i < 18; i++) prev[i] = !!btn[i];
      return L;
    },
  };
}
