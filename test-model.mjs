// Headless verification of the model analysis pipeline against the real GLB.
// Mirrors exactly what the browser app does (AssetLoader.processModel + CollisionSystem).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import fs from 'fs';
import { pathToFileURL } from 'url';
import { resolve as resolvePath } from 'path';

globalThis.self = globalThis;
if (typeof globalThis.atob !== 'function') {
  globalThis.atob = (b64) => Buffer.from(b64, 'base64').toString('binary');
}
if (typeof globalThis.TextDecoder !== 'function') {
  globalThis.TextDecoder = require('util').TextDecoder;
}

import { AssetLoader } from './src/modules/AssetLoader.ts';
import { CollisionSystem } from './src/modules/CollisionSystem.ts';

// TS modules use import.meta.env only in main.ts, not here. Bundler resolution:
const tsx = (mod) => mod;

const filePath = process.argv[2];
const buf = fs.readFileSync(filePath);
const glb = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

const gltfLoader = new GLTFLoader();
gltfLoader.parse(glb, pathToFileURL(resolvePath(filePath)).href, (gltf) => {
  const model = gltf.scene;
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 200);
  const ctx = {
    scene,
    camera,
    renderer: null,
    clock: new THREE.Clock(),
    kitchenModel: null,
    sceneBoundingBox: new THREE.Box3(),
    floorY: 0,
    sceneScale: 1,
    walkableArea: [],
    interactiveObjects: [],
  };

  new AssetLoader().processModel(model, ctx);

  console.log('=== SCENE METRICS ===');
  console.log('bbox min:', ctx.sceneBoundingBox.min.toArray().map(v => v.toFixed(3)).join(', '));
  console.log('bbox max:', ctx.sceneBoundingBox.max.toArray().map(v => v.toFixed(3)).join(', '));
  console.log('bbox size:', (() => { const s = new THREE.Vector3(); ctx.sceneBoundingBox.getSize(s); return s.toArray().map(v => v.toFixed(3)).join(', '); })());
  console.log('floorY:', ctx.floorY.toFixed(3));
  console.log('floorBounds:', ctx.floorBounds.isEmpty() ? 'none' : ctx.floorBounds.min.toArray().map(v => v.toFixed(3)).join(', ') + ' -> ' + ctx.floorBounds.max.toArray().map(v => v.toFixed(3)).join(', '));
  console.log('sceneScale (units/m):', ctx.sceneScale.toFixed(2));;
  console.log('');

  console.log('=== INTERACTIVE OBJECTS ===');
  for (const obj of ctx.interactiveObjects) {
    const size = new THREE.Vector3();
    obj.boundingBox.getSize(size);
    const topM = (obj.surfaceY - ctx.floorY) / ctx.sceneScale;
    console.log(
      `[${obj.category}] ${obj.displayName} | node=${obj.name} | ` +
      `center=(${obj.center.x.toFixed(2)}, ${obj.center.y.toFixed(2)}, ${obj.center.z.toFixed(2)}) | ` +
      `size=(${size.x.toFixed(2)}, ${size.y.toFixed(2)}, ${size.z.toFixed(2)}) | surface=${topM.toFixed(2)}m`
    );
  }
  console.log('');

  const collision = new CollisionSystem(ctx);
  const boxes = collision.getCollisionBoxes();
  console.log(`=== COLLISION (${boxes.length} boxes) ===`);
  const S = ctx.sceneScale;
  let floorStanding = 0;
  for (const b of boxes) {
    const h = b.max.y - b.min.y;
    if (b.min.y - ctx.floorY <= 0.2 * S && h > 0.5 * S) floorStanding++;
  }
  console.log(`floor-standing obstacle boxes: ${floorStanding}`);
  // sanity: kitchen band boxes covering the counter area
  const counterCoverage = boxes.filter(b => {
    const bx = (b.min.x + b.max.x) / 2, bz = (b.min.z + b.max.z) / 2;
    return bx / S > 0 && bx / S < 3.5 && bz / S > 0 && bz / S < 0.9 && (b.max.y - b.min.y) > 0.5 * S;
  }).length;
  console.log(`boxes over the counter band (x<3.5m, z<0.9m, h>0.5m): ${counterCoverage}`);

  // Test resolvePosition near the counter: try walking into the counter from z>2m.
  const start = new THREE.Vector3(1.5 * S, ctx.floorY, 2.0 * S);
  const radius = 0.25 * S;
  const hgt = 1.7 * S;
  const targets = [
    new THREE.Vector3(1.5 * S, ctx.floorY, 0.05 * S), // deep inside counter
    new THREE.Vector3(1.5 * S, ctx.floorY, -3 * S),   // beyond south wall
    new THREE.Vector3(-2 * S, ctx.floorY, 2 * S),      // beyond west wall
    new THREE.Vector3(40 * S, ctx.floorY, 2 * S),      // beyond east boundary
  ];
  console.log(`\n=== PLAYER POSITION RESOLVE (radius=0.25m, height=1.7m) ===`);
  for (const t of targets) {
    const resolved = collision.resolvePosition(t, radius, hgt);
    const distMoved = resolved.distanceTo(start);
    console.log(
      `target=(${t.x.toFixed(2)}, ${t.z.toFixed(2)}) -> resolved=(${resolved.x.toFixed(2)}, ${resolved.z.toFixed(2)}) | moved=${distMoved.toFixed(2)}`
    );
  }

  // Walk a straight line north of the counter through the room and check we
  // never get stuck in furniture.
  console.log('\n===== WALK PATH TEST =====');
  const path = new THREE.Vector3(1.2 * S, ctx.floorY, 2.6 * S);
  let minObstacleDist = Infinity;
  let steps = 48;
  let ok = true;
  for (let i = 0; i < steps; i++) {
    const target = path.clone().add(new THREE.Vector3(-0.5 * S, 0, -0.2 * S));
    const prev = path.clone();
    const stepped = collision.resolvePosition(target, radius, hgt);
    stepped.y = ctx.floorY;
    // if moved absurdly far, something's wrong (step itself is ~0.54*S diagonal)
    if (stepped.distanceTo(prev) > 0.75 * S) { ok = false; console.log(`UNEXPECTED JUMP at step ${i}: ${stepped.distanceTo(prev).toFixed(2)}`); }
    path.copy(stepped);
  }
  console.log(`final=$( ${path.x.toFixed(2)}, ${path.z.toFixed(2)} ) ok=${ok}`);

  // Faucet interactable check
  const interactables = [];
  model.traverse((o) => { if (o.userData.interactable === true) interactables.push(o); });
  console.log(`\n=== INTERACTABLES (${interactables.length}) ===`);
  for (const o of interactables) {
    const line = `node=${o.name} interaction=${o.userData.interaction}` +
      (o.userData.interaction === 'faucet' ? ` faucetOpen=${o.userData.faucetOpen === true}` : '');
    const faucet = o.userData.faucet;
    if (faucet && faucet.nozzle) {
      console.log(line + ` nozzle=(${faucet.nozzle.x.toFixed(3)}, ${faucet.nozzle.y.toFixed(3)}, ${faucet.nozzle.z.toFixed(3)}) splashY=${faucet.splashY.toFixed(3)}`);
    } else {
      console.log(line);
    }
  }
}, (err) => {
  console.error('LOAD ERROR:', err);
  process.exit(1);
});