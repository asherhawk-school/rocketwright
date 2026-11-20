# Rocketwright

A 2D rocket-building and spaceflight sandbox that runs in the browser. Build a rocket from parts, launch it from the
planet **Verdan**, get into orbit, and land on its moon **Pallid**.

No build step and no dependencies: plain HTML, CSS and JavaScript on a `<canvas>`.

## Play

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
```

then visit http://localhost:8000.

## Features

- **Hangar**: drag 37 parts onto your rocket. They snap to top and bottom stack nodes or to the sides of other parts,
  with 2× mirror symmetry, undo/redo, and centre-of-mass and centre-of-thrust markers. Parts come in 1.25 m, 2 m and 3 m sizes, with adapters,
  nose cones, side boosters, radial and crossfeed decouplers, side tanks and engines, fins, legs and RCS.
- **Staging editor**: automatic staging you can reorder, with simulated Δv, thrust-to-weight and burn time for every stage.
  Craft are saved in your browser.
- **Flight physics**: thrust with altitude-dependent Isp, fuel flow through the part tree (boosters drain first through crossfeed),
  off-centre thrust torque, side-booster separation, RCS translation, atmospheric drag, fin stability,
  reaction wheels and engine gimbal, parachutes, terrain and oceans, crash and landing detection.
- **Orbital mechanics**: patched-conic gravity with a moving moon and sphere-of-influence changes, apoapsis/periapsis readouts,
  time warp up to 100,000× (RK4 integration on rails).
- **Map view**: predicted trajectory through SOI changes, encounter preview, impact marker.
- **SAS**: hold heading, prograde, retrograde, radial up and down.
- **Milestones**: from first liftoff to a round trip to Pallid.

## Controls

| Key | Action |
| --- | --- |
| Space | Stage (ignite, separate, parachute) |
| A / D, ← / → | Rotate |
| W / S, Shift, ↑ / ↓ | Throttle up / down |
| Z / X | Full / cut throttle |
| T, 1–6 | SAS toggle / modes |
| R; Q / E; H / N | RCS toggle; slide sideways; forward / back |
| M | Map view (F changes focus) |
| , / . | Time warp slower / faster |
| Mouse wheel, + / − | Zoom |
| Esc | Menu (revert, recover, back to hangar) |

In the hangar: drag parts from the palette, click to select, drag a part to move it with everything attached,
Del removes, Ctrl+Z / Ctrl+Shift+Z undo and redo, X toggles symmetry.

## Tests

```bash
node tests/run.js
```

Headless checks for staging, fuel flow, symmetry, save migration, and autopilot flights of the example rockets to orbit.

## Code layout

- `js/data.js`: constants, parts, bodies, terrain, orbit maths and trajectory prediction
- `js/vessel.js`: craft model: part tree and layout, fuel groups, automatic staging, mass properties, Δv simulation, example craft
- `js/render.js`: part, flame, terrain and launch pad drawing
- `js/flight.js`: simulation loop, time warp, camera, map view, HUD
- `js/hangar.js`: drag-and-drop builder, symmetry, undo, staging editor
- `js/main.js`: menus, input and boot
