/* The street-skill readout (game/skill.js), GTA-style: the live chain under
   the place line, and a popup when it banks (gold cash) or is lost (red).
   DOM only, rebuilt when the text changes -- no per-frame layout. */
export function createSkillHud(root = document.body) {
  const el = document.createElement('div');
  el.id = 'skill';
  el.innerHTML = '<div class="sk-live"></div><div class="sk-pop"></div>';
  root.appendChild(el);
  const live = el.querySelector('.sk-live'), pop = el.querySelector('.sk-pop');
  let lastLive = '', popT = 0;
  const NAMES = { near: 'NEAR MISS', drift: 'DRIFT' };
  return {
    event(e) {
      if (e.kind === 'near' || e.kind === 'drift') {
        live.dataset.trick = NAMES[e.kind];
        live.classList.remove('kick'); void live.offsetWidth; live.classList.add('kick');
      } else if (e.kind === 'bank') {
        pop.className = 'sk-pop bank';
        pop.innerHTML = `STREET SKILL <b>+$${e.cash.toLocaleString()}</b><small>${e.pts.toLocaleString()} × ${e.mult}</small>`;
        popT = 2.6;
      } else if (e.kind === 'lost') {
        pop.className = 'sk-pop lost';
        pop.innerHTML = `CHAIN LOST<small>${e.pts.toLocaleString()} pts</small>`;
        popT = 1.8;
      }
    },
    update(state, dt) {
      const txt = state ? `${state.drifting ? 'DRIFT' : (live.dataset.trick || 'NEAR MISS')}|${state.pts}|${state.mult}` : '';
      if (txt !== lastLive) {
        lastLive = txt;
        live.innerHTML = state ? `<span>${state.drifting ? 'DRIFT' : (live.dataset.trick || 'NEAR MISS')}</span><b>${state.pts.toLocaleString()}</b><i>×${state.mult}</i>` : '';
        live.classList.toggle('on', !!state);
      }
      if (popT > 0) { popT -= dt; if (popT <= 0) pop.className = 'sk-pop'; }
    },
  };
}
