// minimap.js — the corner map: a player-centred, north-up view of
// Costa Solana with the street grid, the shoreline, and every blip
// the game is tracking — gold for the story, teal for race rings,
// orange for taxi fares, magenta for the race rival, red for
// hostiles, blue for the law.
//
// One job: draw the map. createMinimap grabs the #minimap canvas
// from index.html; update() redraws every other frame, clipped to a
// circle so the map reads as a round instrument in its gold frame.

import { CFG } from './config.js';

const SIZE = 190; // canvas pixels, square
const CENTER = SIZE / 2;
const VIEW_RADIUS = 270; // world units from the player to the rim
const SCALE = CENTER / VIEW_RADIUS; // world units -> pixels

// createMinimap(G) -> { update(dt) }.
export function createMinimap(G) {
  const canvas = document.getElementById('minimap');
  const ctx = canvas.getContext('2d');
  let frame = 0;

  // worldToMap(x, z) -> [px, py]: player-centred projection. North
  // (-Z) maps up because canvas y grows downward while world z grows
  // southward — the raw offset does the right thing on both axes.
  function worldToMap(x, z) {
    const pp = G.player.mesh.position;
    return [
      CENTER + (x - pp.x) * SCALE,
      CENTER + (z - pp.z) * SCALE,
    ];
  }

  // drawLandAndSea(): the island slab in warm land colour, with the
  // ocean painted wherever the view reaches past the shoreline —
  // south of the island, and beyond its east, west and north edges.
  function drawLandAndSea() {
    ctx.fillStyle = '#d8c9a3';
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = '#1e90b8';
    const h = CFG.WORLD_HALF;
    // South sea: everything past the island's south edge.
    const [, southY] = worldToMap(0, h);
    if (southY < SIZE) ctx.fillRect(0, Math.max(0, southY), SIZE, SIZE - Math.max(0, southY));
    // North sea.
    const [, northY] = worldToMap(0, -h);
    if (northY > 0) ctx.fillRect(0, 0, SIZE, Math.min(SIZE, northY));
    // West and east seas.
    const [westX] = worldToMap(-h, 0);
    if (westX > 0) ctx.fillRect(0, 0, Math.min(SIZE, westX), SIZE);
    const [eastX] = worldToMap(h, 0);
    if (eastX < SIZE) ctx.fillRect(Math.max(0, eastX), 0, SIZE - Math.max(0, eastX), SIZE);
    // The beach reads as a pale band along the south shore.
    const [, beachY] = worldToMap(0, CFG.BEACH_Z);
    const beachH = (h - CFG.BEACH_Z) * SCALE;
    if (beachY < SIZE && beachY + beachH > 0) {
      ctx.fillStyle = '#eed9a4';
      ctx.fillRect(0, Math.max(0, beachY), SIZE, beachH);
    }
  }

  // drawRoads(): every grid line that crosses the view, in asphalt
  // grey; the beachfront avenue gets a golden tint and extra weight
  // so the promenade is findable at a glance.
  function drawRoads() {
    const lines = G.world.roadLines;
    ctx.lineCap = 'round';
    for (const x of lines.x) {
      const [px] = worldToMap(x, 0);
      if (px < -4 || px > SIZE + 4) continue;
      ctx.strokeStyle = '#555c63';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, SIZE);
      ctx.stroke();
    }
    for (const z of lines.z) {
      const [, py] = worldToMap(0, z);
      if (py < -4 || py > SIZE + 4) continue;
      const beachfront = z === CFG.BEACHFRONT_Z;
      ctx.strokeStyle = beachfront ? '#b89b4e' : '#555c63';
      ctx.lineWidth = beachfront ? 5 : 4;
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(SIZE, py);
      ctx.stroke();
    }
  }

  /* ---------------------------- blips ----------------------------- */

  // blip(x, z, color, r): a filled circle at a world point, culled
  // when it falls outside the rim.
  function blip(x, z, color, r) {
    const [px, py] = worldToMap(x, z);
    if (px < -8 || px > SIZE + 8 || py < -8 || py > SIZE + 8) return;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // squareBlip(x, z, color, s): a filled square — the law's shape.
  function squareBlip(x, z, color, s) {
    const [px, py] = worldToMap(x, z);
    if (px < -8 || px > SIZE + 8 || py < -8 || py > SIZE + 8) return;
    ctx.fillStyle = color;
    ctx.fillRect(px - s / 2, py - s / 2, s, s);
  }

  // drawBlips(): every marker the mission system and the police are
  // publishing on G this frame, in a fixed z-order: goals first,
  // then threats, then the law.
  function drawBlips() {
    if (G.missionMarker) {
      blip(G.missionMarker.x, G.missionMarker.z, '#f7c948', 4.5);
      const [px, py] = worldToMap(G.missionMarker.x, G.missionMarker.z);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(px, py, 4.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (G.raceCheckpoint) blip(G.raceCheckpoint.x, G.raceCheckpoint.z, '#17e6c8', 4);
    if (G.taxiBlip) blip(G.taxiBlip.x, G.taxiBlip.z, '#ff9f43', 4);
    if (G.raceRivalPos) blip(G.raceRivalPos.x, G.raceRivalPos.z, '#ff2fd6', 3.5);
    if (G.hostileBlips) {
      for (const h of G.hostileBlips) blip(h.x, h.z, '#e74c3c', 3);
    }

    // The law: patrol cars as squares that strobe red while the heat
    // is on, roadblock cars as steady squares, the helicopter as a
    // triangle overhead.
    const copColor = (G.wanted || 0) > 0 && Math.floor(G.time * 4) % 2 === 0
      ? '#ff3b30'
      : '#2a6bff';
    if (G.cops) {
      for (const cop of G.cops) {
        squareBlip(cop.mesh.position.x, cop.mesh.position.z, copColor, 5);
      }
    }
    if (G.blockades) {
      for (const block of G.blockades) {
        for (const car of block.cars) {
          squareBlip(car.mesh.position.x, car.mesh.position.z, '#2a6bff', 5);
        }
      }
    }
    if (G.heli) {
      const [px, py] = worldToMap(G.heli.mesh.position.x, G.heli.mesh.position.z);
      ctx.fillStyle = '#2a6bff';
      ctx.beginPath();
      ctx.moveTo(px, py - 5);
      ctx.lineTo(px + 4.5, py + 4);
      ctx.lineTo(px - 4.5, py + 4);
      ctx.closePath();
      ctx.fill();
    }
  }

  // drawPlayerArrow(): the white arrow at the centre, rotated to the
  // player's heading. Heading 0 faces +Z (south, down-map), so the
  // up-drawn arrow rotates by PI - heading.
  function drawPlayerArrow() {
    const heading = G.player.car ? G.player.car.heading : G.player.heading;
    ctx.save();
    ctx.translate(CENTER, CENTER);
    ctx.rotate(Math.PI - heading);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(7, 48, 58, 0.9)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 6);
    ctx.lineTo(0, 2.5);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /* --------------------------- update ----------------------------- */

  // draw(): one full map — land, roads, blips, arrow, rim — clipped
  // to the instrument's circle.
  function draw() {
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.save();
    ctx.beginPath();
    ctx.arc(CENTER, CENTER, CENTER - 2, 0, Math.PI * 2);
    ctx.clip();
    drawLandAndSea();
    drawRoads();
    drawBlips();
    drawPlayerArrow();
    ctx.restore();
    ctx.strokeStyle = 'rgba(247, 201, 72, 0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(CENTER, CENTER, CENTER - 2, 0, Math.PI * 2);
    ctx.stroke();
  }

  // update(dt): the map refreshes every other frame — quite fast
  // enough for a corner instrument, at half the fill cost.
  function update(dt) {
    frame += 1;
    if (frame % 2 === 1) return;
    draw();
  }

  return { update };
}
