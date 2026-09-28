// Loads public/js/engine.js (a classic browser script) into a fresh VM context and returns its API.
// Each call gets its own context, so tests cannot leak board size or other module state into each other.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../public/js/engine.js', import.meta.url), 'utf8');
const API = [
  'W', 'H', 'PORTALS', 'SD_ORDER', 'SD_START', 'SD_STEP', 'SHIELD_INV', 'GHOST_WARN', 'GHOST_CD', 'FUSE', 'CURSE_T', 'speedOf', 'ZOMBIE_T', 'ZOMBIE_STUN',
  'idx', 'sizeFor', 'setDims', 'pickSpawns', 'newGame', 'stepGame', 'explode', 'placeBomb', 'ghostDrop', 'snapshot', 'portalExit',
];

export function loadEngine() {
  const ctx = vm.createContext({});
  vm.runInContext(SRC, ctx);
  // let/const bindings are not properties of the context object, so read them through a getter object
  return vm.runInContext(`({ ${API.map(k => `get ${k}() { return ${k}; }`).join(', ')} })`, ctx);
}

// a board with every breakable box removed, so tests control exactly what is where
export function openGame(e, slots = 2, teams = false, mode) {
  const g = e.newGame(Array.from({ length: slots }, (_, k) => ({ id: 'p' + k, name: 'P' + k, color: k, team: k % 2 })), teams, mode ? { mode } : {});
  g.grid = g.grid.map(c => (c === 'x' ? '.' : c));
  g.hidden = g.hidden.map(() => '');
  g.ph = 'play';
  return g;
}

// run the game for `secs` seconds with nobody pressing anything
export function run(e, g, secs, dt = 1 / 60) {
  for (let t = 0; t < secs; t += dt) e.stepGame(g, {}, dt, {});
}
