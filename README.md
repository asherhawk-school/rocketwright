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

- **Hangar**: stack 15 parts (capsule, parachute, tanks, four liquid engines, a solid booster, decouplers, fins, landing legs).
  Shows live per-stage Δv, thrust-to-weight and burn time, with design warnings. Craft are saved in your browser.
- **Flight physics**: thrust with altitude-dependent Isp, staged fuel flow, atmospheric drag, aerodynamic stability,
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
| M | Map view (F changes focus) |
| , / . | Time warp slower / faster |
| Mouse wheel, + / − | Zoom |
| Esc | Menu (revert, recover, back to hangar) |

## Code layout

- `js/data.js`: constants, parts, bodies, terrain, orbit maths and trajectory prediction
- `js/vessel.js`: craft model: staging, fuel flow, mass properties, Δv
- `js/render.js`: part, flame, terrain and launch pad drawing
- `js/flight.js`: simulation loop, time warp, camera, map view, HUD
- `js/main.js`: hangar UI, menus, input and boot
