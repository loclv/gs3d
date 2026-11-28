// Three.js API-surface diff: compares the real `three` package's exports and
// class members against the gs3d facade (./three.js). Run after `npm i
// --no-save three` (or `npm i three` if you want it pinned as a devDep).
//
//   node ./check_three_compat.mjs [--methods] [--verbose]
//
// Reports, in order of usefulness:
//   1. exports three has that gs3d lacks entirely
//   2. per-class instance methods three has that gs3d's class lacks
//      (--methods; class members only compared when both sides export a
//      constructor of the same name)
//   3. gs3d-only exports (informational)
//
// Member comparison walks the prototype chain and ignores Object members,
// `constructor`, and private-ish `_`-prefixed names. Fields assigned in
// constructors are not compared — only methods/getters/setters.

import * as THREE from 'three';
import * as GS3D from './three.js';

const args = new Set(process.argv.slice(2));
const WITH_METHODS = args.has('--methods') || args.has('-m');
const VERBOSE = args.has('--verbose') || args.has('-v');

const isClass = v => typeof v === 'function' && /^class\s/.test(Function.prototype.toString.call(v));
const isCtor = v => typeof v === 'function';

// Prototype member names for a constructor, walking the chain to (not
// including) Object.prototype.
function protoMembers(ctor) {
  const names = new Set();
  let proto = ctor.prototype;
  while (proto && proto !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor' || name.startsWith('_')) continue;
      const desc = Object.getOwnPropertyDescriptor(proto, name);
      if (desc && (typeof desc.value === 'function' || desc.get || desc.set)) names.add(name);
    }
    proto = Object.getPrototypeOf(proto);
  }
  return names;
}

const threeNames = Object.keys(THREE).sort();
const gs3dNames = new Set(Object.keys(GS3D));

const missingExports = threeNames.filter(n => !gs3dNames.has(n));
const extraExports = [...gs3dNames].filter(n => !(n in THREE)).sort();

console.log(`three exports: ${threeNames.length}, gs3d exports: ${gs3dNames.size}`);
console.log(`missing exports: ${missingExports.length}, gs3d-only: ${extraExports.length}\n`);

if (missingExports.length) {
  console.log('== missing exports ==');
  for (const n of missingExports) {
    const v = THREE[n];
    const kind = isClass(v) ? 'class' : typeof v === 'function' ? 'function' : typeof v;
    console.log(`  ${n}  (${kind})`);
  }
  console.log();
}

if (WITH_METHODS) {
  const rows = [];
  for (const n of threeNames) {
    if (!gs3dNames.has(n)) continue;
    const a = THREE[n], b = GS3D[n];
    if (!isCtor(a) || !isCtor(b) || !a.prototype || !b.prototype) continue;
    const am = protoMembers(a), bm = protoMembers(b);
    const missing = [...am].filter(m => !bm.has(m)).sort();
    if (missing.length) rows.push({ name: n, missing, extra: [...bm].filter(m => !am.has(m)).sort() });
  }
  rows.sort((x, y) => y.missing.length - x.missing.length);
  const totalMissing = rows.reduce((s, r) => s + r.missing.length, 0);
  console.log(`== class member gaps (${rows.length} classes, ${totalMissing} missing methods) ==`);
  for (const r of rows) {
    console.log(`  ${r.name}: missing ${r.missing.length}${VERBOSE ? ' -> ' + r.missing.join(', ') : ''}`);
    if (VERBOSE && r.extra.length) console.log(`      gs3d-only: ${r.extra.join(', ')}`);
  }
  console.log();
}

if (VERBOSE && extraExports.length) {
  console.log('== gs3d-only exports ==');
  for (const n of extraExports) console.log(`  ${n}`);
  console.log();
}

console.log('done.');
