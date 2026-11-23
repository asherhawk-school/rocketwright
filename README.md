# Rocketwright

A rocket-building and spaceflight sandbox that runs in the browser, drawn in 3D. Build a rocket from parts, launch it from the
planet **Verdan**, get into orbit, and land on its moon **Pallid**.

No build step: plain HTML, CSS and JavaScript. The 3D graphics use [Three.js](https://threejs.org/) (r128, loaded from cdnjs);
without WebGL the game falls back to its classic 2D drawing (you can also pick 2D in Settings). The physics happens in one
plane either way.

## Play

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
```

then visit http://localhost:8000.

## Features

- **3D graphics**: round, lit parts; planets as spheres with oceans, continents and a glowing atmosphere; ground that stretches
  away in every direction; flames, smoke, clouds, the pad, tower and runway. Drag with the mouse (or right-drag) to swing the
  camera round your craft, double-click or press V to reset it. In the hangar, right-drag or press ⟳ Turn to look round the rocket.

- **Career mode**: start with ¤25,000 and three astronauts at the Space Centre. Take generated contracts in Mission Control
  (reach an altitude, test a part, gather science, fly by, orbit, land, place a satellite) that scale with your progress. Launches cost
  money, and recovering your craft refunds most of it. Run experiments with six science instruments (each worth more on new worlds and in new
  situations), transmit or recover the results, and research a 14-node tech tree. Astronauts gain experience and can be lost.
  Reverting a flight undoes it; a **quick save** (F5) lets you return to any moment of a flight (F9) as many times as you like;
  saves can be exported and imported. **Sandbox mode** unlocks everything with no money.
- **Astronaut roles**: every astronaut is a pilot, engineer or scientist. Pilots unlock SAS modes as they gain rank
  (prograde and retrograde, then radial and manoeuvre, then target; probe cores give hold, prograde and retrograde).
  Engineers repack used parachutes once you've landed. Scientists reset used experiments and add 10% or more to the science
  you bring in. Hire the role you need in the Astronaut Office.
- **Space Centre upgrades**: every building starts at level 1 in career and can be upgraded twice: the Hangar (part count),
  Launch Pad and Runway (mass), Mission Control (active contracts), Tracking Station (manoeuvre nodes and faster time warp),
  Astronaut Office (crew size) and Research Lab (pricier research). Older careers start at level 2; sandbox is fully upgraded.
- **Hangar**: drag 90 parts onto your rocket. They snap to top and bottom stack nodes or to the sides of other parts,
  with 2× mirror symmetry, undo/redo, and centre-of-mass and centre-of-thrust markers. Parts come in 1.25 m, 2 m and 3 m sizes, with adapters,
  nose cones, side boosters, radial and crossfeed decouplers, side tanks and engines, fins, legs and RCS, plus engine mounts
  (twin, tri and quad) for clusters of engines side by side. Drop a part or a whole section on empty floor to **set it aside**
  for later: it waits beside the rocket (you can keep building onto it), isn't launched or paid for, saves with the craft, and
  goes back on when you drag it onto the rocket.
- **Advanced parts**: a 3-seat Heron capsule and a 4-seat crew cabin (fly several astronauts at once), shell fairings that cover a
  payload and split open, an atomic engine, an ion drive that burns argon and electricity, an aerospike that works well at any
  altitude, a small monopropellant engine, big batteries and fuel cells, struts, a 3 m heat shield, an inflatable heat shield,
  drogue parachutes and air brakes.
- **Planes and rovers**: a cockpit, fuselage, wings, control surfaces, air intakes, a turbofan and a turbojet, folding landing gear
  and powered rover wheels. Wings make lift from the angle they meet the air (and stall when it gets too steep); control surfaces
  pitch the plane with A/D and SAS. Jets only work in air with oxygen (Verdan and Gale), need an intake, and fade at high speed.
  Wheels ride on springy suspension, roll, brake and drive. Craft with wheels start on the **runway** east of the pad (or pick the
  pad in the hangar). Examples: the Swallow Jet and the Dune Rover.
- **Staging editor**: automatic staging you can reorder by dragging parts between stages (or between two stages to make a new one),
  with simulated Δv, thrust-to-weight and burn time for every stage.
- **Part settings**: when each parachute opens fully, engine and booster thrust limits, how much fuel each tank carries, and how
  tall a fairing's shell is.
- **Part menu in flight**: hover a part for its details; click it to run science, open a parachute, start or stop an engine,
  fire one decoupler, undock, or change its settings.
  Craft are saved in your browser.
- **Flight physics**: thrust with altitude-dependent Isp, fuel flow through the part tree (boosters drain first through crossfeed),
  off-centre thrust torque, side-booster separation, RCS translation, atmospheric drag, fin stability,
  reaction wheels and engine gimbal, parachutes (a main canopy that opens fully too fast tears off; drogues don't), air brakes,
  terrain and oceans, crash and landing detection.
- **Spacewalks**: press J to send an astronaut outside. In space they fly with a small jetpack (Q/E, H/N) and turn with A/D;
  on the ground they walk (A/D) and hop (Space). They can plant a flag (L), which stays as a marker in the Tracking Station and
  earns a milestone, and collect spacewalk reports and surface samples (B), carrying the results until they climb back into any
  capsule or cabin with a free seat (J near its hatch, or right beside a landed craft). Sandbox flights carry a guest astronaut.
- **Biomes**: every world with ground is split into named regions (Verdan has the Space Centre, Grasslands, Badlands, Desert,
  Tundra, Forests, Mountains, Shores and Seas; Pallid has a Great Crater, Highlands, Dark Maria and more). The HUD shows the biome
  below you, map view rings each world with its biomes, science taken landed, splashed down or flying low counts once per biome,
  and contracts can ask you to land in or gather science from a particular biome.
- **Solar system**: the star Helion with six planets and seven moons, all original: scorched Cinder; home world Verdan and
  its moon Pallid; desert Ochre (Pip, Shard); the gas giant Tempest (Gale with air and seas, volcanic Ember, icy Frost); frozen
  Glacis; and distant Umbra. Each has its own gravity, terrain, colours, and in some cases air and seas. Gas giants have no surface.
- **Orbital mechanics**: patched-conic gravity through a tree of spheres of influence with exact frame corrections for moving
  bodies, apoapsis/periapsis readouts, and time warp up to 1,000,000× (RK4 on rails with steps that never skip an SOI boundary).
- **Map view**: every orbit in the system, focus any body (F, or click it), the predicted path through every SOI change with
  ghosts of planets where they'll be when you arrive, and the next encounters in the HUD.
- **Persistent universe**: vessels you leave in flight keep orbiting (or sit landed) while time moves on, and can be lost if
  they were on a path into the air or the ground. The **Tracking Station** lists every vessel with a map, lets you fly any of
  them again, recover landed ones, terminate them, or wait for days to pass. Pieces that separate with a capsule or probe on
  them become vessels of their own.
- **Rendezvous and docking**: target any vessel to see the closest approach, distance and relative speed. SAS can point at
  the target or cancel your relative speed, and up close it lines your docking port up face to face with theirs. Bring two
  free docking ports together slowly to dock (crews and tanks combine); undock with U. Switch between nearby vessels with [ and ].
- **Rescue contracts** strand an astronaut in orbit; dock with their capsule and bring them home to add them to your roster.
- **Tutorials**: guided first flight, reaching orbit, docking, and landing on Pallid. They never touch your save.
- **Sound** synthesised in the browser: engine rumble that fades in thin air, solid-booster crackle, wind, staging,
  parachutes, docking and explosions, with a volume setting.
- **Day and night**: the sky darkens and the planet's night side is shaded by the sun's direction; terrain is coloured by
  height (beaches, grass, rock, snow).
- **Manoeuvre nodes**: click your path (or use “Node at Ap/Pe”) to plan a burn, drag its handles or use the editor, see the
  resulting orbit and encounters, the burn time and when to start; time warp stops before the burn, SAS points along it and the
  throttle cuts when it's done.
- **Targets**: pick any world to see the closest approach on your path, the phase angle, the ideal transfer angle and how long until
  the next transfer window. The **Δv map** lists what every trip costs.
- **Spacecraft systems**: electricity (capsule and probe batteries, battery packs, solar panels that work by sun angle and distance
  and go dark in a planet's shadow, engine alternators). Reaction wheels and probe cores use power, and an uncrewed probe with a flat
  battery can't steer, throttle or stage. **Reentry heating** heats the part facing the airflow most; ablative heat shields protect
  what's behind them, and an overheated part explodes on its own (taking with it anything only it held on).
- **SAS**: hold heading, prograde, retrograde, radial up and down, and manoeuvre node.
- **Milestones**: first launch steps at home, then reach, orbit, land on and return from every world.

## Controls

| Key | Action |
| --- | --- |
| Space | Stage (ignite, separate, parachute) |
| A / D, ← / → | Rotate |
| W / S, Shift, ↑ / ↓ | Throttle up / down |
| Z / X | Full / cut throttle |
| T, 1–9 | SAS toggle / modes (7 node, 8 target, 9 match target speed) |
| U; [ / ] | Undock; switch to a nearby vessel |
| R; Q / E; H / N | RCS toggle; slide sideways; forward / back |
| K | Brakes: air brakes out, wheel brakes on (again to release) |
| G | Landing gear up / down |
| ↑ / ↓ (rover on the ground) | Drive forward / back |
| J | Spacewalk: climb out, or climb back in near a hatch |
| A / D, Space, L (on a spacewalk) | Walk, hop, plant a flag |
| B | Science panel (career) |
| M | Map view (F changes focus) |
| Drag on the map | Pan around (a click without dragging adds a node, targets a vessel or focuses a planet) |
| Drag / right-drag; V | Swing the 3D camera; reset it |
| , / . | Time warp slower / faster |
| Mouse wheel, + / − | Zoom |
| F5 / F9 | Save this moment of the flight / go back to it (also Save and Load buttons, the menu and the crash screen) |
| Esc | Menu (revert, recover, back to hangar) |

In the hangar: drag parts from the palette, click to select, drag a part to move it with everything attached,
drop it on empty floor to set it aside for later, Del removes, Ctrl+Z / Ctrl+Shift+Z undo and redo, X toggles symmetry.

## Tests

```bash
node tests/run.js
```

Headless checks for staging, fuel flow, symmetry, save migration, autopilot flights of the example rockets to orbit,
spheres of influence, frame accelerations, stable orbits around nested moons, interplanetary encounter prediction,
career rules (research, science values, contracts, recovery, crew loss), biomes (coverage, per-biome science and contracts), spacewalks (walking, hopping, flags, samples, boarding), astronaut roles and building upgrades, power and shadows, reentry heating with and
without a heat shield, flying a manoeuvre node to its planned orbit, saving and reloading vessels, vessels lost on rails,
docking and undocking, rescue contracts, parachutes tearing and drogues, air brakes, inflatable shields, ion drives,
fairings, fuel cells, crew seats, the runway, planes taking off (and not without wings), jets needing oxygen and intakes, rovers
driving, braking and settling, landing on gear (gently, hard, and gear up), quick saves, and setting parts aside in the
hangar (building onto them, putting them back, and keeping them out of launches).

## Code layout

- `js/data.js`: constants, parts, milestones, the solar system, gravity, terrain, orbit maths and trajectory prediction
- `js/vessel.js`: craft model: part tree and layout, fuel groups, automatic staging, mass properties, Δv simulation, example craft
- `js/render.js`: 2D part, flame, terrain and launch pad drawing (also used for the classic view)
- `js/render3d.js`: the 3D view: part models, planets, ground, particles, the orbiting camera and the 3D hangar
- `js/systems.js`: electricity and reentry heating
- `js/navigation.js`: manoeuvre nodes, targets, transfer windows and the Δv map
- `js/universe.js`: saved vessels, on-rails motion, crew aboard, rescue capsules
- `js/docking.js`: docking ports, merging and undocking craft
- `js/eva.js`: spacewalks, flags and boarding
- `js/sound.js`: synthesised audio
- `js/tutorials.js`: guided missions
- `js/flight.js`: simulation loop, time warp, camera, map view, HUD
- `js/career/`: the save game, money and crew (`career.js`), experiments (`science.js`), research (`tech.js`), contracts
  (`contracts.js`) and the title screen, Space Centre and building screens (`hub.js`)
- `js/hangar.js`: drag-and-drop builder, symmetry, undo, staging editor, career costs and crew
- `js/main.js`: menus, input and boot
