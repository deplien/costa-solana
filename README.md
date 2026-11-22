# Costa Solana

[![make.fun bounty](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01)
[![rank](https://make.fun/badge/gta6-01/deplien/costa-solana/rank.svg)](https://make.fun/bounty/gta6-01)
[![reward](https://make.fun/badge/gta6-01/deplien/costa-solana/reward.svg)](https://make.fun/bounty/gta6-01)

Costa Solana is an original sun-soaked 3D open-world crime game that runs from pure static files: a pastel coastal city at golden hour — marina, beachfront, old town and downtown towers under one warm sky — explored on foot and behind the wheel. It is built with three.js (vendored under `game/vendor/`, no build step, no network requests) and a set of small hand-written ES modules for the city, its traffic, its police and its story.

## What is in the city

- Six districts on one island grid: Marina, Beachfront, Old Town, Downtown, Suburbs and the Industrial docks, with a lighthouse point and a distant volcano islet offshore
- Living traffic on a lane-based road graph and pedestrians who stroll the boardwalk, cross at corners — and scatter when trouble starts
- Carjacking: pull up next to any car, take it, and the city notices
- A 5-star wanted system: police cars give chase, roadblocks seal streets at higher stars, and a police helicopter joins the pursuit at four stars
- Fists, pistol and SMG with a weapon readout, muzzle flash and hit reactions
- Lucia Ferrer's 7-mission story chain, from a first pickup at the marina to a final escape across the causeway
- Two street races against rival drivers, plus taxi fares for honest money
- Three synthesized radio stations (WebAudio, no audio files) that play while you drive
- A full HUD — cash, health, wanted stars, weapon and ammo, objective banner, subtitles — and a live minimap with mission, race and police blips
- Progress, cash and position saved to localStorage between visits

## Controls

- **WASD / arrow keys** — walk or drive
- **Shift** — sprint (on foot)
- **Mouse** — look / aim; **click** — punch or shoot
- **F** — enter or exit a car (walk up to one to carjack it)
- **Space** — handbrake while driving
- **1 / 2 / 3** or **Q** — fists, pistol, SMG
- **N** — next radio station while driving
- **P / Esc** — pause
- **R** — respawn after being busted or wasted

## Run it

Serve this folder with any static file server and open `game/index.html` in a desktop browser — everything runs offline from the files in `game/`. To stage the make.fun entry instead, run `node main.ts` with `MAKEFUN_OUTPUT_DIR` pointing at an output folder: it copies `game/` and `screenshots/` there and writes the `dossier.json` summary beside them.

## Layout

```
game/
  index.html        page shell, HUD DOM, loads three.min.js then src/main.js
  vendor/           three.min.js (three.js r147, vendored)
  src/
    main.js         boot, game loop, mode state machine, module wiring
    config.js       world constants, palettes, district + weapon + car data
    random.js       seeded RNG so ?seed=1 always builds the same city
    city.js         the island: roads, buildings, beach, marina, props
    vehicles.js     car models, traffic AI, driving physics, parked cars
    pedestrians.js  walker models, sidewalk routes, flee reactions
    player.js       on-foot character, camera, enter/exit, carjacking
    police.js       wanted levels, chase AI, roadblocks, helicopter
    weapons.js      weapon data, shooting, muzzle flash, hit resolution
    missions.js     Lucia Ferrer's story chain, races, taxi fares
    hud.js          stars, cash, health, weapon, banners, subtitles
    minimap.js      canvas minimap with player, mission and police blips
    audio.js        WebAudio engine, sirens, shots and the radio stations
    save.js         localStorage save / load
    shots.js        deterministic ?shot= staging for the screenshots
main.ts             stages game/ + screenshots/ and writes dossier.json
shots.json          the four screenshot states and their file names
```
