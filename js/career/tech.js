'use strict';
/* Rocketwright — research. Each node costs science, needs its prerequisites, and unlocks parts.
   col/row place the node on the research screen. */

const TECH_NODES = [
  { id: 'start', name: 'Rocketry Basics', cost: 0, req: [], col: 0, row: 2, parts: ['pod', 'chute', 'srb', 'decoupler', 'fins', 'legs', 'thermo'] },
  { id: 'general', name: 'General Rocketry', cost: 5, req: ['start'], col: 1, row: 1, parts: ['tankS', 'tankM', 'kestrel', 'popper', 'twinMount', 'twinMountL'] },
  { id: 'stability', name: 'Stability', cost: 10, req: ['start'], col: 1, row: 3, parts: ['wheel', 'nose2', 'baro'] },
  { id: 'science', name: 'Basic Science', cost: 15, req: ['start'], col: 1, row: 4, parts: ['jar', 'antenna'] },
  { id: 'advanced', name: 'Advanced Rocketry', cost: 30, req: ['general'], col: 2, row: 0, parts: ['tankL', 'ox'] },
  { id: 'precision', name: 'Precision Engineering', cost: 30, req: ['general'], col: 2, row: 1,
    parts: ['gnat', 'tankS125', 'tankM125', 'adapt2to125', 'adapt125to2', 'nose125', 'decoupler125'] },
  { id: 'landing', name: 'Ground Science', cost: 40, req: ['stability'], col: 2, row: 3, parts: ['seismic'] },
  { id: 'control', name: 'Flight Control', cost: 70, req: ['stability'], col: 2, row: 4, parts: ['rcs', 'monoPod', 'puff'] },
  { id: 'electrics', name: 'Basic Electrics', cost: 20, req: ['general'], col: 2, row: 2, parts: ['probe', 'battery', 'batteryRing'] },
  { id: 'solar', name: 'Solar Power', cost: 60, req: ['electrics'], col: 3, row: 2, parts: ['solar'] },
  { id: 'survival', name: 'Survivability', cost: 25, req: ['stability'], col: 3, row: 3, parts: ['shield2', 'shield125', 'chuteRadial'] },
  { id: 'docking', name: 'Docking', cost: 90, req: ['control'], col: 3, row: 4, parts: ['dockPort'] },
  { id: 'fuelsys', name: 'Fuel Systems', cost: 50, req: ['advanced'], col: 3, row: 0, parts: ['tankXL', 'radDec', 'saddle', 'triMount', 'quadMount'] },
  { id: 'propulsion', name: 'Propulsion Systems', cost: 70, req: ['advanced'], col: 3, row: 1, parts: ['wren', 'sparrow'] },
  { id: 'heavy', name: 'Heavy Rocketry', cost: 120, req: ['fuelsys'], col: 4, row: 0, parts: ['bison', 'radDecX', 'pylon'] },
  { id: 'exploration', name: 'Space Exploration', cost: 120, req: ['propulsion', 'science'], col: 4, row: 2, parts: ['sniffer'] },
  { id: 'large', name: 'Large Construction', cost: 200, req: ['heavy'], col: 5, row: 0, parts: ['decoupler3', 'tankT12', 'adapt3to2', 'adapt2to3', 'fairing3'] },
  { id: 'construction', name: 'Construction', cost: 40, req: ['general'], col: 2, row: 5, parts: ['strut', 'fairing2', 'batteryDisc'] },
  { id: 'aerobrake', name: 'Aerodynamic Braking', cost: 45, req: ['survival'], col: 4, row: 3, parts: ['airbrake', 'chuteDrogue', 'shield3'] },
  { id: 'inflatable', name: 'Inflatable Structures', cost: 180, req: ['aerobrake'], col: 5, row: 3, parts: ['bloom'] },
  { id: 'command', name: 'Command Modules', cost: 100, req: ['survival', 'docking'], col: 4, row: 4, parts: ['heron', 'chuteBig', 'cabin'] },
  { id: 'advengines', name: 'Advanced Engines', cost: 160, req: ['propulsion'], col: 4, row: 1, parts: ['spindle'] },
  { id: 'nuclear', name: 'Nuclear Propulsion', cost: 320, req: ['advengines'], col: 5, row: 1, parts: ['hearth'] },
  { id: 'power', name: 'Advanced Electrics', cost: 90, req: ['solar'], col: 4, row: 5, parts: ['batteryBank', 'fuelCell', 'fuelCellL'] },
  { id: 'ion', name: 'Ion Propulsion', cost: 280, req: ['power'], col: 5, row: 5, parts: ['whisper', 'gasTank', 'gasDrum'] },
  { id: 'aviation', name: 'Aviation', cost: 30, req: ['start'], col: 1, row: 6,
    parts: ['cockpit', 'fuselage', 'tailCone', 'wingS', 'elevon', 'skid', 'intake', 'jetFan'] },
  { id: 'aerodynamics', name: 'Aerodynamics', cost: 90, req: ['aviation'], col: 2, row: 6, parts: ['wingL', 'strake', 'canard', 'gear', 'intakeRad'] },
  { id: 'supersonic', name: 'Supersonic Flight', cost: 220, req: ['aerodynamics'], col: 3, row: 6, parts: ['jetTurbo'] },
  { id: 'rovers', name: 'Rovers', cost: 80, req: ['landing'], col: 3, row: 5, parts: ['roverWheel'] },
  { id: 'veryheavy', name: 'Very Heavy Rocketry', cost: 300, req: ['large'], col: 6, row: 0, parts: ['colossus', 'tankT24'] },
];
const TECH_BY_ID = Object.fromEntries(TECH_NODES.map((n) => [n.id, n]));
/* part id -> node id */
const PART_TECH = {};
for (const n of TECH_NODES) for (const p of n.parts) PART_TECH[p] = n.id;

function techState(s, n) {
  if (s.tech.includes(n.id)) return 'done';
  return n.req.every((r) => s.tech.includes(r)) ? 'open' : 'locked';
}

/* Spend science on a node. Returns an error message, or null on success. */
function research(s, id) {
  const n = TECH_BY_ID[id];
  if (!n) return 'Unknown node';
  const st = techState(s, n);
  if (st === 'done') return 'Already researched';
  if (st === 'locked') return 'Research the earlier nodes first';
  if (s.science < n.cost) return `Needs ${n.cost} science`;
  s.science = Math.round((s.science - n.cost) * 10) / 10;
  s.tech.push(id);
  return null;
}
