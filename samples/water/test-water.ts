// Node-side sanity checks for the water sandbox constants — runs without
// a browser or wasm. The physics itself is covered by src/test_siege.goose.
import { KIND_INFO } from './src/kinds.ts';

let failures = 0;
function check(ok: boolean, label: string): void {
  if (ok) {
    console.log(`  ok    ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}`);
  }
}

for (const [kind, info] of Object.entries(KIND_INFO)) {
  check(info.volume > 0, `${kind} has positive collider volume`);
  check(info.density > 0, `${kind} has positive density`);
}

// Floaters must sit well under water density (1000); the stone must exceed it.
check(KIND_INFO.ball.density < 950, 'float ball is buoyant');
check(KIND_INFO.box.density < 950, 'float box is buoyant');
check(KIND_INFO.capsule.density < 950, 'float capsule is buoyant');
check(KIND_INFO.stone.density > 1050, 'stone sinks');

if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('all water sample checks passed');
