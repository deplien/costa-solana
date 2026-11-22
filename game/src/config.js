// config.js — every shared constant for Costa Solana in one place:
// island geometry, the sun-soaked palette, and the six districts.
// Other modules import from here and nowhere else, so the whole game
// agrees on the size of the world and the look of golden hour.

// Geometry contract (all builders rely on this):
// - The island is a square slab spanning -WORLD_HALF..+WORLD_HALF on X and Z.
// - Streets run along X and along Z at every ROAD_LINES coordinate.
// - Each road is ROAD_W wide; the block between two roads is BLOCK - ROAD_W.
// - South of BEACH_Z is open sand, then ocean (water surface at WATER_Y).
export const CFG = {
  WORLD_HALF: 495,
  BLOCK: 90,
  ROAD_W: 22,
  ROAD_LINES: [-450, -360, -270, -180, -90, 0, 90, 180, 270, 360, 450],
  BEACH_Z: 380,
  BEACHFRONT_Z: 360, // the avenue that runs along the beach
  WATER_Y: -1,

  // Golden-hour light and sky.
  SKY_TOP: 0x3d7ac8,
  SKY_HORIZON: 0xffd9a8,
  SUN_COLOR: 0xffd9a0,
  SUN_DISC: 0xffe9b0,
  FOG_COLOR: 0xf6cf9e,
  HEMI_SKY: 0xbfd9ff,
  HEMI_GROUND: 0xe8c9a0,

  // Ground and street surfaces.
  GROUND: 0xcfc4a5, // warm concrete-sand island slab
  SAND: 0xeed9a4,
  ASPHALT: 0x3c4147,
  SIDEWALK: 0xded3bd,
  OCEAN: 0x1e90b8,
  OCEAN_DEEP: 0x146b8a,

  // Building facades: sun-soaked pastels, tinted over the shared
  // window-grid texture in city.js.
  PALETTE: [
    0xfff3df, // cream
    0xffd9b3, // peach
    0xcfe8d4, // mint
    0xffb4a2, // coral
    0xffffff, // white
    0xf7e3ac, // sand-yellow
    0xf9c6cf, // blush pink
    0xbfe3ea, // pale aqua
  ],

  // Traffic paint: bright tropical colours plus the everyday neutrals.
  CAR_COLORS: [
    0xe74c3c, 0xf39c12, 0xf1c40f, 0x2ecc71, 0x1abc9c, 0x3498db,
    0x9b59b6, 0xff6b9d, 0xffffff, 0xecf0f1, 0x95a5a6, 0x2c3e50,
  ],

  PALM_TRUNK: 0x8a6b4a,
  PALM_FROND: 0x2e8b3a,
  LAMP_POST: 0x3a4a42,
};

// The six districts. Bounds are world coordinates; heightMin/heightMax
// are building heights in world units; style tells city.js how a block
// is subdivided. Order matters: districtAt returns the FIRST district
// whose bounds contain the point, so the beachfront strip is listed
// before the suburbs it overlaps.
export const DISTRICTS = [
  {
    name: 'Playa Dorada',
    minX: -450, maxX: 450, minZ: 180, maxZ: 360,
    heightMin: 25, heightMax: 60, style: 'hotel',
  },
  {
    name: 'Marina Alta',
    minX: 90, maxX: 450, minZ: -450, maxZ: -90,
    heightMin: 40, heightMax: 90, style: 'tower',
  },
  {
    name: 'Muelle Industrial',
    minX: -450, maxX: -90, minZ: -450, maxZ: -90,
    heightMin: 12, heightMax: 26, style: 'warehouse',
  },
  {
    name: 'Puerto Azul',
    minX: 180, maxX: 450, minZ: -90, maxZ: 180,
    heightMin: 12, heightMax: 28, style: 'marina',
  },
  {
    name: 'Casco Viejo',
    minX: -90, maxX: 180, minZ: -90, maxZ: 180,
    heightMin: 14, heightMax: 30, style: 'oldtown',
  },
  {
    name: 'Las Palmas',
    minX: -450, maxX: -90, minZ: -90, maxZ: 270,
    heightMin: 8, heightMax: 18, style: 'house',
  },
];

// districtAt(x, z) -> the district object governing a world point.
// Falls back to Casco Viejo (the old town) for any point no district
// claims, e.g. out on the sand.
export function districtAt(x, z) {
  for (const d of DISTRICTS) {
    if (x >= d.minX && x <= d.maxX && z >= d.minZ && z <= d.maxZ) return d;
  }
  return DISTRICTS[4]; // Casco Viejo
}
