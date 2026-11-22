// city.js — builds the whole island of Costa Solana into a three.js scene.
//
// One job: turn a seed into a place. Golden-hour light, a pastel city on a
// street grid, beach and ocean to the south, a marina, a lighthouse, and a
// volcano on the horizon. Everything placement-related flows through the
// seeded rng passed in, so the island is identical on every visit.
//
// Heading convention used across the game: a heading is a yaw in radians
// and the forward vector is (sin(heading), 0, cos(heading)). Heading 0
// faces +Z (south, toward the beach), Math.PI / 2 faces +X (east). This
// matches Object3D.rotation.y for models built facing +Z.

import { CFG, districtAt } from './config.js';
import { rngRange, rngInt, rngPick, rngChance } from './random.js';

/* ------------------------------------------------------------------ */
/* Canvas textures (all art is generated here — no external assets).   */
/* ------------------------------------------------------------------ */

// makeCanvas(w, h, draw) -> HTMLCanvasElement painted by draw(ctx, w, h).
function makeCanvas(w, h, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d'), w, h);
  return canvas;
}

// canvasTexture(canvas, repeatX, repeatY) -> a repeating sRGB texture.
function canvasTexture(canvas, repeatX, repeatY) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.encoding = THREE.sRGBEncoding;
  tex.anisotropy = 4;
  return tex;
}

// The shared window-grid facade. Buildings tint it with their material
// colour, so one texture serves every pastel block in the city. A few
// windows are warm-lit, most are glassy blue-grey. The painted canvas
// must be wrapped in a real THREE texture before it can ride a
// material — a raw canvas has no uv transform matrix and the renderer
// throws the moment a building scrolls into view.
function facadeTexture() {
  return canvasTexture(makeCanvas(128, 256, (ctx, w, h) => {
    ctx.fillStyle = '#f7f1e3';
    ctx.fillRect(0, 0, w, h);
    for (let row = 0; row < 12; row++) {
      for (let col = 0; col < 5; col++) {
        const lit = (row * 7 + col * 13) % 9 === 0;
        ctx.fillStyle = lit ? '#ffd98a' : '#33566b';
        ctx.fillRect(10 + col * 23, 12 + row * 20, 13, 11);
      }
    }
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.fillRect(0, h - 6, w, 6);
  }), 1, 1);
}

// Hotel variant of the facade: horizontal balcony bands with railings,
// for the Playa Dorada beachfront. Wrapped in a texture for the same
// reason as the facade above.
function hotelTexture() {
  return canvasTexture(makeCanvas(128, 256, (ctx, w, h) => {
    ctx.fillStyle = '#faf3e6';
    ctx.fillRect(0, 0, w, h);
    for (let band = 0; band < 8; band++) {
      const y = 8 + band * 31;
      ctx.fillStyle = '#33566b';
      ctx.fillRect(12, y, w - 24, 13);
      ctx.fillStyle = '#e8b04b';
      ctx.fillRect(0, y + 16, w, 4);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(0, y + 20, w, 3);
    }
  }), 1, 1);
}

// One 26-unit road segment: asphalt with speckle and a dashed centre
// line running along U, so repeat.x stretches it down the street.
function roadTexture() {
  const canvas = makeCanvas(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#3c4147';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    for (let i = 0; i < 260; i++) {
      ctx.fillRect((i * 37) % w, (i * 53) % h, 2, 2);
    }
    ctx.fillStyle = '#e8c85a';
    ctx.fillRect(6, h / 2 - 3, 62, 6);
  });
  return canvasTexture(canvas, 990 / 26, 1);
}

// Gentle wave stripes for the ocean, scrolled in update().
function waveTexture() {
  const canvas = makeCanvas(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#1e90b8';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 3;
    for (let row = 0; row < 4; row++) {
      ctx.beginPath();
      for (let x = 0; x <= w; x += 8) {
        const y = 16 + row * 32 + Math.sin(x / 14 + row) * 4;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  });
  return canvasTexture(canvas, 90, 90);
}

// The welcome arch board over the beachfront avenue.
function signTexture() {
  const canvas = makeCanvas(1024, 144, (ctx, w, h) => {
    ctx.fillStyle = '#0b5563';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#e8b04b';
    ctx.lineWidth = 6;
    ctx.strokeRect(10, 10, w - 20, h - 20);
    ctx.fillStyle = '#f7c948';
    ctx.font = 'bold 72px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText('COSTA SOLANA', w / 2, 78);
    ctx.fillStyle = '#ffffff';
    ctx.font = '28px Georgia, serif';
    ctx.fillText('B I E N V E N I D O S', w / 2, 122);
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.encoding = THREE.sRGBEncoding;
  return tex;
}

/* ------------------------------------------------------------------ */
/* Small geometry helpers: paint + merge so props cost one draw call.  */
/* ------------------------------------------------------------------ */

// paintGeometry(geom, hex) -> geom with a per-vertex colour attribute.
function paintGeometry(geom, hex) {
  const color = new THREE.Color(hex);
  const count = geom.attributes.position.count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = color.r;
    arr[i * 3 + 1] = color.g;
    arr[i * 3 + 2] = color.b;
  }
  geom.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geom;
}

// placeGeometry(geom, x, y, z, rx, ry, rz, sx, sy, sz) -> geom moved
// into world space (scale, then rotate, then translate).
function placeGeometry(geom, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
  m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
  geom.applyMatrix4(m);
  return geom;
}

// mergeGeometries(geoms) -> one BufferGeometry from painted parts.
// Parts are de-indexed and their position/normal/uv/color attributes
// concatenated, so a merged prop renders as a single mesh.
function mergeGeometries(geoms) {
  const parts = geoms.map((g) => (g.index ? g.toNonIndexed() : g));
  let total = 0;
  for (const p of parts) total += p.attributes.position.count;
  const position = new Float32Array(total * 3);
  const normal = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  const color = new Float32Array(total * 3);
  let v = 0;
  for (const p of parts) {
    position.set(p.attributes.position.array, v * 3);
    normal.set(p.attributes.normal.array, v * 3);
    if (p.attributes.uv) uv.set(p.attributes.uv.array, v * 2);
    if (p.attributes.color) color.set(p.attributes.color.array, v * 3);
    v += p.attributes.position.count;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(position, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  merged.setAttribute('color', new THREE.BufferAttribute(color, 3));
  return merged;
}

// Shared materials/geometries created once per city build.
const vertexMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const vertexMatDS = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
const unitBox = new THREE.BoxGeometry(1, 1, 1);

// addUnitBox(parent, mat, x, y, z, sx, sy, sz, ry) -> mesh from the
// shared unit box, scaled into place. y is the box's centre height.
function addUnitBox(parent, mat, x, y, z, sx, sy, sz, ry = 0) {
  const mesh = new THREE.Mesh(unitBox, mat);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  mesh.rotation.y = ry;
  parent.add(mesh);
  return mesh;
}

/* ------------------------------------------------------------------ */
/* Environment: light, sky, sea, ground, streets.                      */
/* ------------------------------------------------------------------ */

// buildLightsAndSky(scene): warm low sun from the west, hemisphere
// fill, haze fog, a vertex-gradient sky dome and a visible sun disc.
function buildLightsAndSky(scene) {
  const sun = new THREE.DirectionalLight(CFG.SUN_COLOR, 1.15);
  sun.position.set(-600, 380, -220);
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(CFG.HEMI_SKY, CFG.HEMI_GROUND, 0.8));
  scene.fog = new THREE.Fog(CFG.FOG_COLOR, 400, 2400);

  const skyGeom = new THREE.SphereGeometry(3800, 24, 12);
  const top = new THREE.Color(CFG.SKY_TOP);
  const horizon = new THREE.Color(CFG.SKY_HORIZON);
  const pos = skyGeom.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp(pos.getY(i) / 3800, 0, 1);
    const c = horizon.clone().lerp(top, Math.pow(t, 0.6));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  skyGeom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const sky = new THREE.Mesh(skyGeom, new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false,
  }));
  sky.frustumCulled = false;
  scene.add(sky);

  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(150, 24),
    new THREE.MeshBasicMaterial({ color: CFG.SUN_DISC, fog: false }),
  );
  disc.position.set(-2900, 430, -700);
  disc.lookAt(0, 0, 0);
  scene.add(disc);
}

// buildOcean(group) -> { mesh, texture }: a huge animated water plane
// surrounding the island at WATER_Y.
function buildOcean(group) {
  const texture = waveTexture();
  const mat = new THREE.MeshPhongMaterial({
    color: CFG.OCEAN, map: texture, shininess: 80,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(5200, 5200), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = CFG.WATER_Y;
  group.add(mesh);
  return { mesh, texture };
}

// buildGroundAndRoads(group): the island slab, the sand beach along
// the south edge, and asphalt strips with dashed centre lines on every
// grid line. X-roads sit a hair below Z-roads so crossings never
// z-fight.
function buildGroundAndRoads(group) {
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(CFG.WORLD_HALF * 2, 2, CFG.WORLD_HALF * 2),
    new THREE.MeshLambertMaterial({ color: CFG.GROUND }),
  );
  slab.position.y = -1;
  group.add(slab);

  const beach = new THREE.Mesh(
    new THREE.PlaneGeometry(CFG.WORLD_HALF * 2, 124),
    new THREE.MeshLambertMaterial({ color: CFG.SAND }),
  );
  beach.rotation.x = -Math.PI / 2;
  beach.position.set(0, 0.02, 433);
  group.add(beach);

  const roadMat = new THREE.MeshLambertMaterial({ map: roadTexture() });
  const span = CFG.WORLD_HALF * 2;
  for (const line of CFG.ROAD_LINES) {
    const alongX = new THREE.Mesh(new THREE.PlaneGeometry(span, CFG.ROAD_W), roadMat);
    alongX.rotation.x = -Math.PI / 2;
    alongX.position.set(0, 0.05, line);
    group.add(alongX);

    const alongZGeom = new THREE.PlaneGeometry(span, CFG.ROAD_W);
    alongZGeom.rotateX(-Math.PI / 2);
    alongZGeom.rotateY(Math.PI / 2);
    const alongZ = new THREE.Mesh(alongZGeom, roadMat);
    alongZ.position.set(line, 0.07, 0);
    group.add(alongZ);
  }
}

/* ------------------------------------------------------------------ */
/* Blocks and buildings.                                               */
/* ------------------------------------------------------------------ */

// buildBlocks(group, rng, colliders): every grid block gets a sidewalk
// slab and a district-styled subdivision. The block at (45, 45) is the
// Casco Viejo plaza instead. Beach-row blocks stay open sand.
function buildBlocks(group, rng, colliders) {
  const facadeTex = facadeTexture();
  const hotelTex = hotelTexture();
  const facadeMats = CFG.PALETTE.map((c) => new THREE.MeshLambertMaterial({ map: facadeTex, color: c }));
  const hotelMats = CFG.PALETTE.map((c) => new THREE.MeshLambertMaterial({ map: hotelTex, color: c }));
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x8a7a68 });
  const sidewalkMat = new THREE.MeshLambertMaterial({ color: CFG.SIDEWALK });
  const lines = CFG.ROAD_LINES;
  for (let i = 0; i < lines.length - 1; i++) {
    for (let j = 0; j < lines.length - 1; j++) {
      const cx = lines[i] + CFG.BLOCK / 2;
      const cz = lines[j] + CFG.BLOCK / 2;
      if (cz > CFG.BEACH_Z) continue;
      addUnitBox(group, sidewalkMat, cx, 0, cz, 74, 0.3, 74);
      if (cx === 45 && cz === 45) {
        buildPark(group, colliders);
        continue;
      }
      const d = districtAt(cx, cz);
      if (d.style === 'house') {
        buildHouseBlock(group, rng, cx, cz, d, colliders);
      } else {
        const mats = d.style === 'hotel' ? hotelMats : facadeMats;
        buildFacadeBlock(group, rng, cx, cz, d, mats, roofMat, colliders);
      }
    }
  }
}

// Lot layouts per district style: [dx, dz, w, d] offsets inside a block.
function blockLots(rng, style) {
  switch (style) {
    case 'tower':
      return [[0, 0, rngRange(rng, 30, 38), rngRange(rng, 30, 38)]];
    case 'hotel':
      return rngChance(rng, 0.5)
        ? [[0, 0, 46, 28]]
        : [[-16, 0, 26, 30], [16, 0, 26, 30]];
    case 'warehouse':
      return rngChance(rng, 0.5)
        ? [[0, -14, 48, 22], [0, 16, 48, 20]]
        : [[0, 0, 50, 30]];
    case 'oldtown':
      return [[-16, -16, 24, 24], [16, -16, 22, 26], [-16, 16, 26, 22], [16, 16, 23, 23]];
    case 'marina':
      return [[-18, -14, 22, 20], [16, -16, 24, 22], [0, 17, 26, 20]];
    default:
      return [[0, 0, 30, 30]];
  }
}

// buildFacadeBlock: texture-fronted buildings (towers, hotels,
// warehouses, old town, marina blocks) with parapet roofs, rooftop
// clutter and water towers in the industrial district.
function buildFacadeBlock(group, rng, cx, cz, d, mats, roofMat, colliders) {
  for (const [dx, dz, w, dep] of blockLots(rng, d.style)) {
    const h = rngRange(rng, d.heightMin, d.heightMax);
    const x = cx + dx;
    const z = cz + dz;
    const mesh = new THREE.Mesh(unitBox, rngPick(rng, mats));
    mesh.position.set(x, 0.15 + h / 2, z);
    mesh.scale.set(w, h, dep);
    group.add(mesh);
    colliders.push({ x, z, hw: w / 2, hd: dep / 2, h });
    if (h > 20 && rngChance(rng, 0.5)) {
      addUnitBox(group, roofMat, x + rngRange(rng, -w / 4, w / 4), 0.15 + h + 1,
        z + rngRange(rng, -dep / 4, dep / 4), rngRange(rng, 4, 9), 2, rngRange(rng, 4, 9));
    }
    if (d.style === 'warehouse' && rngChance(rng, 0.35)) {
      const tower = mergeGeometries([
        paintGeometry(placeGeometry(new THREE.CylinderGeometry(1.6, 1.6, 5, 8), x - w / 3, 0.15 + h + 2.5, z - dep / 3), 0x9a6b4f),
        paintGeometry(placeGeometry(new THREE.ConeGeometry(2.4, 1.8, 8), x - w / 3, 0.15 + h + 5.9, z - dep / 3), 0x6e4a33),
      ]);
      group.add(new THREE.Mesh(tower, vertexMat));
    }
  }
}

// buildHouseBlock: four pastel houses with terracotta pyramid roofs,
// merged into a single mesh for the whole block.
function buildHouseBlock(group, rng, cx, cz, d, colliders) {
  const parts = [];
  for (const [dx, dz] of [[-16, -16], [16, -16], [-16, 16], [16, 16]]) {
    const h = rngRange(rng, d.heightMin, d.heightMax);
    const x = cx + dx;
    const z = cz + dz;
    parts.push(paintGeometry(placeGeometry(new THREE.BoxGeometry(13, h, 11), x, 0.15 + h / 2, z), rngPick(rng, CFG.PALETTE)));
    parts.push(paintGeometry(placeGeometry(new THREE.ConeGeometry(9.5, 4, 4), x, 0.15 + h + 2, z, 0, Math.PI / 4, 0), 0xb5654a));
    colliders.push({ x, z, hw: 6.5, hd: 5.5, h });
  }
  group.add(new THREE.Mesh(mergeGeometries(parts), vertexMat));
}

// buildPark(group, colliders): the Casco Viejo plaza — a fountain the
// whole old town walks around.
function buildPark(group, colliders) {
  const parts = [
    paintGeometry(placeGeometry(new THREE.CylinderGeometry(6, 6.6, 1, 14), 45, 0.65, 45), 0x9db8c4),
    paintGeometry(placeGeometry(new THREE.CylinderGeometry(1, 1.4, 2.6, 10), 45, 1.3, 45), 0x9db8c4),
  ];
  group.add(new THREE.Mesh(mergeGeometries(parts), vertexMat));
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(5.2, 14),
    new THREE.MeshLambertMaterial({ color: CFG.OCEAN }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(45, 1.18, 45);
  group.add(water);
  const benchMat = new THREE.MeshLambertMaterial({ color: 0x9a6b4f });
  for (const [bx, bz] of [[45, 24], [45, 66], [24, 45], [66, 45]]) {
    addUnitBox(group, benchMat, bx, 0.6, bz, 5, 0.5, 1.2);
  }
  colliders.push({ x: 45, z: 45, hw: 6.6, hd: 6.6, h: 2.6 });
}

/* ------------------------------------------------------------------ */
/* Greenery and street furniture.                                      */
/* ------------------------------------------------------------------ */

// One palm: a leaning trunk and a drooping cone crown, vertex-painted
// and merged so each tree is a single mesh.
function palmGeometry() {
  const trunk = paintGeometry(new THREE.CylinderGeometry(0.16, 0.3, 5.5, 5), CFG.PALM_TRUNK);
  placeGeometry(trunk, 0.4, 2.75, 0, 0, 0, 0.12);
  const crown = paintGeometry(new THREE.ConeGeometry(2.5, 1.5, 7, 1, true), CFG.PALM_FROND);
  placeGeometry(crown, 0.85, 5.8, 0, Math.PI, 0, 0.12);
  return mergeGeometries([trunk, crown]);
}

// collidesAt(colliders, x, z, pad): is a point inside any collider,
// grown by pad on every side? Keeps palms and spawns out of buildings.
function collidesAt(colliders, x, z, pad) {
  return colliders.some((c) => Math.abs(x - c.x) < c.hw + pad && Math.abs(z - c.z) < c.hd + pad);
}

// buildPalms(group, rng, colliders): rows along the beachfront avenue,
// a scatter on the sand, a ring around the plaza fountain, and garden
// palms in Las Palmas that politely avoid the houses.
function buildPalms(group, rng, colliders) {
  const geom = palmGeometry();
  const plant = (x, z) => {
    const m = new THREE.Mesh(geom, vertexMatDS);
    m.position.set(x, 0, z);
    m.rotation.y = rng() * Math.PI * 2;
    const s = rngRange(rng, 0.85, 1.3);
    m.scale.set(s, s * rngRange(rng, 0.9, 1.15), s);
    group.add(m);
  };
  let k = 0;
  for (let x = -440; x <= 440; x += 17, k++) {
    plant(x + rngRange(rng, -3, 3), 346);
    if (k % 2 === 0) plant(x + rngRange(rng, -3, 3), 375);
  }
  for (let i = 0; i < 36; i++) {
    plant(rngRange(rng, -470, 470), rngRange(rng, 392, 468));
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    plant(45 + Math.cos(a) * 16, 45 + Math.sin(a) * 16);
  }
  for (let i = 0; i < 46; i++) {
    const x = rngRange(rng, -440, -100);
    const z = rngRange(rng, -80, 260);
    if (!collidesAt(colliders, x, z, 3)) plant(x, z);
  }
}

// One street lamp: pole and warm head, merged.
function lampGeometry() {
  const pole = paintGeometry(new THREE.CylinderGeometry(0.09, 0.13, 5.6, 5), CFG.LAMP_POST);
  placeGeometry(pole, 0, 2.8, 0);
  const head = paintGeometry(new THREE.SphereGeometry(0.34, 8, 6), 0xfff3c4);
  placeGeometry(head, 0, 5.75, 0);
  return mergeGeometries([pole, head]);
}

// buildLamps(group): lamps flank the beachfront avenue and the
// central north-south avenue.
function buildLamps(group) {
  const geom = lampGeometry();
  const spots = [];
  for (let x = -450; x <= 450; x += 45) {
    spots.push([x, 347], [x, 373]);
  }
  for (let z = -450; z <= 315; z += 45) {
    spots.push([-13, z], [13, z]);
  }
  for (const [x, z] of spots) {
    const m = new THREE.Mesh(geom, vertexMat);
    m.position.set(x, 0, z);
    group.add(m);
  }
}

// buildBeachProps(group, rng): coral-and-teal kiosks and a scatter of
// beach umbrellas on the sand.
function buildBeachProps(group, rng) {
  for (const kx of [-380, -210, -60, 120, 260, 400]) {
    const kiosk = mergeGeometries([
      paintGeometry(placeGeometry(new THREE.BoxGeometry(3.4, 2.6, 3), kx, 1.3, 402), rngPick(rng, [0xffb4a2, 0xbfe3ea, 0xf7e3ac])),
      paintGeometry(placeGeometry(new THREE.ConeGeometry(3, 1.3, 4), kx, 3.25, 402, 0, Math.PI / 4, 0), 0x0e7c86),
    ]);
    group.add(new THREE.Mesh(kiosk, vertexMat));
  }
  for (let i = 0; i < 12; i++) {
    const ux = rngRange(rng, -460, 460);
    const uz = rngRange(rng, 398, 458);
    const umbrella = mergeGeometries([
      paintGeometry(placeGeometry(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 5), ux, 1.2, uz), 0xffffff),
      paintGeometry(placeGeometry(new THREE.ConeGeometry(1.9, 0.7, 8), ux, 2.5, uz), rngPick(rng, CFG.CAR_COLORS)),
    ]);
    group.add(new THREE.Mesh(umbrella, vertexMatDS));
  }
}

/* ------------------------------------------------------------------ */
/* Landmarks: marina, lighthouse, volcano, welcome sign.               */
/* ------------------------------------------------------------------ */

// One moored boat: hull, cabin and a little mast, vertex-painted.
function boatGeometry(hullColor, cabinColor) {
  return mergeGeometries([
    paintGeometry(placeGeometry(new THREE.BoxGeometry(4.6, 1.1, 1.9), 0, 0.55, 0), hullColor),
    paintGeometry(placeGeometry(new THREE.BoxGeometry(1.9, 0.95, 1.35), -0.3, 1.55, 0), cabinColor),
    paintGeometry(placeGeometry(new THREE.CylinderGeometry(0.05, 0.05, 3.2, 5), 1.2, 2.6, 0), 0xd8d8d8),
  ]);
}

// buildMarina(group, rng) -> { point, boats }: timber docks reaching
// south into the bay from the Playa Dorada shore, with boats moored
// alongside that bob in update().
function buildMarina(group, rng) {
  const parts = [
    paintGeometry(placeGeometry(new THREE.BoxGeometry(170, 0.5, 5), 375, 0.35, 458), 0x9a6b4f),
  ];
  for (const dx of [310, 350, 390, 430]) {
    parts.push(paintGeometry(placeGeometry(new THREE.BoxGeometry(4, 0.5, 120), dx, 0.35, 520), 0x8a5f43));
  }
  group.add(new THREE.Mesh(mergeGeometries(parts), vertexMat));
  const boats = [];
  for (const [bx, bz] of [[304, 490], [356, 520], [384, 480], [436, 540], [316, 560]]) {
    const boat = new THREE.Mesh(boatGeometry(0xffffff, rngPick(rng, CFG.CAR_COLORS)), vertexMat);
    boat.position.set(bx, 0.1, bz);
    boat.rotation.y = Math.PI / 2;
    group.add(boat);
    boats.push(boat);
  }
  return { point: { x: 375, z: 520 }, boats };
}

// buildLighthouse(group) -> pivot: a red-and-white striped tower on
// the south-east point; its beam pivot is returned so update() can
// sweep the light.
function buildLighthouse(group) {
  const parts = [
    paintGeometry(placeGeometry(new THREE.CylinderGeometry(11, 13, 3, 12), 478, -0.5, 478), 0x7a7f85),
    paintGeometry(placeGeometry(new THREE.CylinderGeometry(3.1, 3.6, 5, 12), 478, 3.5, 478), 0xffffff),
    paintGeometry(placeGeometry(new THREE.CylinderGeometry(2.8, 3.1, 5, 12), 478, 8.5, 478), 0xd8453a),
    paintGeometry(placeGeometry(new THREE.CylinderGeometry(2.4, 2.8, 5, 12), 478, 13.5, 478), 0xffffff),
    paintGeometry(placeGeometry(new THREE.CylinderGeometry(1.7, 1.7, 2, 10), 478, 17, 478), 0x2c3e50),
  ];
  group.add(new THREE.Mesh(mergeGeometries(parts), vertexMat));
  const lampBall = new THREE.Mesh(
    new THREE.SphereGeometry(1.1, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xfff2b0, fog: false }),
  );
  lampBall.position.set(478, 17, 478);
  group.add(lampBall);
  const beamGeom = new THREE.ConeGeometry(3.2, 30, 14, 1, true);
  beamGeom.translate(0, -15, 0);
  const beam = new THREE.Mesh(beamGeom, new THREE.MeshBasicMaterial({
    color: 0xfff2b0, transparent: true, opacity: 0.3,
    side: THREE.DoubleSide, depthWrite: false, fog: false,
  }));
  beam.rotation.z = Math.PI / 2;
  const pivot = new THREE.Group();
  pivot.position.set(478, 17, 478);
  pivot.add(beam);
  group.add(pivot);
  return pivot;
}

// buildVolcano(group): the island's namesake silhouette on the
// south-east horizon, plus a smaller green islet to the south-west.
// Kept low, far and warm-toned: it should read as a hazy landmark on
// the horizon, never as a black mass swallowing the sky.
function buildVolcano(group) {
  const parts = [
    paintGeometry(placeGeometry(new THREE.ConeGeometry(230, 190, 7), 1500, 88, 1750), 0x7a6a5e),
    paintGeometry(placeGeometry(new THREE.CylinderGeometry(34, 44, 12, 9), 1500, 182, 1750), 0x5d4c42),
    paintGeometry(placeGeometry(new THREE.ConeGeometry(110, 58, 7), -1250, 24, 1500), 0x7d8a68),
  ];
  group.add(new THREE.Mesh(mergeGeometries(parts), vertexMat));
}

// buildWelcomeSign(group): the COSTA SOLANA arch across the
// beachfront avenue, right where the player arrives.
function buildWelcomeSign(group) {
  const postMat = new THREE.MeshLambertMaterial({ color: 0x0e7c86 });
  for (const pz of [347, 373]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 8.6, 8), postMat);
    post.position.set(-45, 4.3, pz);
    group.add(post);
  }
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 4.2),
    new THREE.MeshLambertMaterial({ map: signTexture(), side: THREE.DoubleSide }),
  );
  board.rotation.y = Math.PI / 2;
  board.position.set(-45, 7.4, 360);
  group.add(board);
}

/* ------------------------------------------------------------------ */
/* Spawn points and the public buildCity entry.                        */
/* ------------------------------------------------------------------ */

// carSpawnPoints(): kerb lanes on the busiest avenues. Heading uses
// the game-wide convention (forward = (sin h, 0, cos h)); eastbound
// traffic keeps right at z = line + 5.5, and so on around the compass.
function carSpawnPoints() {
  const pts = [];
  for (const line of [-270, -90, 90, 270, 360]) {
    for (const x of [-405, -225, -45, 135, 315]) {
      pts.push({ x, z: line + 5.5, heading: Math.PI / 2 });
      pts.push({ x: x + 45, z: line - 5.5, heading: -Math.PI / 2 });
    }
  }
  for (const line of [-270, -90, 90, 270]) {
    for (const z of [-405, -225, -45, 135, 315]) {
      pts.push({ x: line - 5.5, z, heading: 0 });
      pts.push({ x: line + 5.5, z: z + 45, heading: Math.PI });
    }
  }
  return pts;
}

// pedSpawnPoints(): two sidewalk corners per city block.
function pedSpawnPoints() {
  const pts = [];
  const lines = CFG.ROAD_LINES;
  for (let i = 0; i < lines.length - 1; i++) {
    for (let j = 0; j < lines.length - 1; j++) {
      const cx = lines[i] + CFG.BLOCK / 2;
      const cz = lines[j] + CFG.BLOCK / 2;
      if (cz > CFG.BEACH_Z) continue;
      pts.push({ x: cx - 34, z: cz - 34 });
      pts.push({ x: cx + 34, z: cz + 34 });
    }
  }
  return pts;
}

// buildCity(scene, rng) -> world. Builds everything into scene and
// returns the world object the rest of the game drives:
//   { group, colliders, roadLines, playerStart, carSpawnPoints,
//     pedSpawnPoints, marina, update(dt, t) }
// update() animates the water, the moored boats and the lighthouse
// beam; call it once per frame.
export function buildCity(scene, rng) {
  const group = new THREE.Group();
  const colliders = [];
  buildLightsAndSky(scene);
  const ocean = buildOcean(group);
  buildGroundAndRoads(group);
  buildBlocks(group, rng, colliders);
  buildPalms(group, rng, colliders);
  buildLamps(group);
  buildBeachProps(group, rng);
  const marina = buildMarina(group, rng);
  const beamPivot = buildLighthouse(group);
  colliders.push({ x: 478, z: 478, hw: 6, hd: 6, h: 18 });
  buildVolcano(group);
  buildWelcomeSign(group);
  scene.add(group);

  const waterTex = ocean.texture;
  function update(dt, t) {
    waterTex.offset.set((t * 0.008) % 1, (t * 0.013) % 1);
    marina.boats.forEach((boat, i) => {
      boat.position.y = 0.1 + Math.sin(t * 1.3 + i * 1.7) * 0.12;
      boat.rotation.z = Math.sin(t * 0.9 + i * 2.1) * 0.025;
    });
    beamPivot.rotation.y = t * 0.7;
  }

  return {
    group,
    colliders,
    roadLines: { x: CFG.ROAD_LINES.slice(), z: CFG.ROAD_LINES.slice() },
    playerStart: { x: -45, z: 340 },
    carSpawnPoints: carSpawnPoints(),
    pedSpawnPoints: pedSpawnPoints(),
    marina: marina.point,
    update,
  };
}
