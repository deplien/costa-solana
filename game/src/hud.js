// hud.js — everything the player reads: wanted stars, cash, health,
// the current weapon, the objective line, district names, the speedo,
// and the three voices of the game — subtitles (G.say), banners
// (G.showBanner) and toasts (G.notify).
//
// One job: the DOM. createHud wires the hooks the rest of the game
// calls onto G, and its update() refreshes the readouts — touching
// the DOM only when a value actually changed, so the HUD costs
// nothing on a quiet frame. The minimap canvas is minimap.js's; the
// title/pause/end screens are main.js's. This module owns the fields.

import { WEAPONS } from './weapons.js';
import { districtAt } from './config.js';

// createHud(G) -> { update(dt) }. Grabs the HUD elements index.html
// provides and defines G.say / G.showBanner / G.notify before
// returning, so any system created after the HUD can talk.
export function createHud(G) {
  const el = (id) => document.getElementById(id);
  const starsEl = el('stars');
  const cashEl = el('cash');
  const weaponEl = el('weapon');
  const objectiveEl = el('objective');
  const bannerEl = el('banner');
  const subtitleEl = el('subtitle');
  const districtEl = el('district');
  const radioEl = el('radio');
  const speedoEl = el('speedo');
  const healthFill = el('health-fill');
  const vignetteEl = el('vignette');

  /* ------------------------- subtitles ---------------------------- */

  // The subtitle queue: one line at a time, 2.8 seconds each, in the
  // order they were spoken. G.say takes a line or an array of lines.
  const sayQueue = [];
  let sayTimer = 0;
  G.say = (lines) => {
    for (const line of [].concat(lines)) sayQueue.push(line);
  };

  /* -------------------------- banners ----------------------------- */

  // The banner: a big title (and optional smaller sub-line) that
  // fades over 2.6 seconds. notify() is the same element in its
  // small-toast dress, for one-line world events.
  let bannerTimer = 0;
  function showBannerText(title, sub, small) {
    bannerEl.innerHTML = '';
    bannerEl.style.fontSize = small ? '30px' : '';
    bannerEl.style.letterSpacing = small ? '3px' : '';
    bannerEl.appendChild(document.createTextNode(title));
    if (sub) {
      const subEl = document.createElement('div');
      subEl.style.fontSize = small ? '20px' : '26px';
      subEl.style.letterSpacing = '2px';
      subEl.style.marginTop = '6px';
      subEl.textContent = sub;
      bannerEl.appendChild(subEl);
    }
    bannerTimer = 2.6;
    bannerEl.style.opacity = '1';
  }
  G.showBanner = (title, sub) => showBannerText(title, sub, false);
  G.notify = (text) => showBannerText(text, '', true);

  /* --------------------------- update ----------------------------- */

  // Last-written values: the DOM is only touched on a real change.
  const cache = {
    stars: null, starsFlash: null, cash: null, health: null,
    weapon: null, objective: null, district: null, speedo: null,
    radio: null, vignette: null,
  };

  // update(dt): advance the subtitle queue and banner fade, then
  // refresh every readout from G.
  function update(dt) {
    // Subtitles: burn down the current line, then speak the next.
    if (sayTimer > 0) {
      sayTimer -= dt;
      if (sayTimer <= 0) subtitleEl.textContent = '';
    }
    if (sayTimer <= 0 && sayQueue.length) {
      subtitleEl.textContent = sayQueue.shift();
      sayTimer = 2.8;
    }

    // Banner: hold, then fade out over the last half second.
    if (bannerTimer > 0) {
      bannerTimer -= dt;
      bannerEl.style.opacity = String(Math.max(0, Math.min(1, bannerTimer / 0.5)));
      if (bannerTimer <= 0) bannerEl.innerHTML = '';
    }

    const pp = G.player.mesh.position;

    // Wanted stars: gold at rest; while the busted meter climbs they
    // strobe red/blue like the lightbars behind you.
    const wanted = G.wanted || 0;
    const starsText = '★'.repeat(wanted) + '☆'.repeat(5 - wanted);
    if (cache.stars !== starsText) {
      cache.stars = starsText;
      starsEl.textContent = starsText;
    }
    const flashing = (G.bustedMeter || 0) > 0;
    const flashPhase = flashing ? Math.floor(G.time * 5) % 2 : -1;
    if (cache.starsFlash !== flashPhase) {
      cache.starsFlash = flashPhase;
      starsEl.style.color = flashing
        ? (flashPhase === 0 ? '#ff3b30' : '#2a6bff')
        : '';
    }

    // Cash on hand.
    const cashText = '$' + (G.cash || 0).toLocaleString('en-US');
    if (cache.cash !== cashText) {
      cache.cash = cashText;
      cashEl.textContent = cashText;
    }

    // Health: the fill shrinks and cools from green through amber
    // to red as the day gets worse.
    const health = Math.max(0, Math.min(100, Math.round(G.health || 0)));
    if (cache.health !== health) {
      cache.health = health;
      healthFill.style.width = health + '%';
      healthFill.style.background = health > 50
        ? 'linear-gradient(90deg, #27ae60, #2ecc71)'
        : health > 25
          ? 'linear-gradient(90deg, #d68910, #f39c12)'
          : 'linear-gradient(90deg, #c0392b, #e74c3c)';
    }

    // Current weapon and its ammunition ('—' for fists: the one
    // weapon that never runs dry).
    const weapon = WEAPONS[G.weaponIndex || 0] || WEAPONS[0];
    const ammoText = weapon.ammoKey ? String((G.ammo || {})[weapon.ammoKey] ?? 0) : '—';
    const weaponText = `${weapon.name.toUpperCase()} · ${ammoText}`;
    if (cache.weapon !== weaponText) {
      cache.weapon = weaponText;
      weaponEl.textContent = weaponText;
    }

    // The objective line, with the distance to the goal appended
    // whenever the game is tracking one.
    let objectiveText = G.objectiveText || '';
    if (objectiveText && G.objectiveDist !== null && G.objectiveDist !== undefined) {
      objectiveText += ` · ${Math.round(G.objectiveDist)} m`;
    }
    if (cache.objective !== objectiveText) {
      cache.objective = objectiveText;
      objectiveEl.textContent = objectiveText;
    }

    // District name under the minimap, refreshed on border crossings.
    const districtText = districtAt(pp.x, pp.z).name.toUpperCase();
    if (cache.district !== districtText) {
      cache.district = districtText;
      districtEl.textContent = districtText;
    }

    // Speedometer, only at the wheel.
    const speedoText = G.player.car
      ? `${Math.round(Math.abs(G.player.car.speed) * 3.6)} <small>KM/H</small>`
      : '';
    if (cache.speedo !== speedoText) {
      cache.speedo = speedoText;
      speedoEl.innerHTML = speedoText;
    }

    // The radio readout rides along only while driving.
    const radioText = G.player.car && G.radioStationName ? `♪ ${G.radioStationName}` : '';
    if (cache.radio !== radioText) {
      cache.radio = radioText;
      radioEl.textContent = radioText;
    }

    // Damage vignette: a half-second blood flash after a hit, plus a
    // steady squeeze while the busted meter fills.
    const hurtFlash = G.hurtAt && G.time - G.hurtAt < 0.5 ? 0.55 : 0;
    const vignette = Math.min(0.85, hurtFlash + (G.bustedMeter || 0) * 0.4);
    if (cache.vignette === null || Math.abs(cache.vignette - vignette) > 0.01) {
      cache.vignette = vignette;
      vignetteEl.style.opacity = vignette.toFixed(2);
    }
  }

  return { update };
}
