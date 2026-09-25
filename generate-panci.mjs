// Generator sementara: membangun panci dapur sederhana (GLB) dengan Three.js.
// Output: public/panci.glb (satuan penulis = meter; ukuran dinormalisasi di
// src/main.ts lewat pola yang sama seperti loadFridge).
//
// Revisi:
//  - Warna putih glossy.
//  - Tutup menyatu dalam GLB (bukan objek runtime terpisah).
//  - Hanya satu pegangan di sisi kanan (+X).
//  - Ukuran tubuh lebih kecil dari versi sebelumnya.
//
// Usage: node generate-panci.mjs
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import fs from 'fs';
import { resolve as resolvePath } from 'path';

// GLTFExporter (mode binary) memakai FileReader untuk membungkus hasil ke
// ArrayBuffer. Di Node tidak ada FileReader; shim minimal dengan Blob.arrayBuffer().
if (typeof globalThis.FileReader !== 'function') {
  globalThis.FileReader = class FileReaderShim {
    readAsArrayBuffer(blob) {
      blob
        .arrayBuffer()
        .then((buf) => {
          this.result = buf;
          if (this.onloadend) this.onloadend();
        })
        .catch((err) => {
          if (this.onerror) this.onerror(err);
        });
    }
  };
}

// ---------------------------------------------------------------------------
// Material — badan & tutup putih glossy; pegangan metal gelap kontras.
// ---------------------------------------------------------------------------
const potMat = new THREE.MeshStandardMaterial({
  name: 'panci_pot',
  color: 0xf4f4f4, // putih
  metalness: 0.15,
  roughness: 0.25, // sedikit glossy
  side: THREE.DoubleSide,
});

const handleMat = new THREE.MeshStandardMaterial({
  name: 'panci_handle',
  color: 0x3a3a3a,
  metalness: 0.6,
  roughness: 0.4,
});

// ---------------------------------------------------------------------------
// Badan panci — profil lathe tertutup (bibir/rim, badan, dinding dalam, dasar).
// Titik (jari-jari, tinggi) dalam meter; sumbu Y adalah sumbu rotasi.
// ---------------------------------------------------------------------------
const potProfile = [
  new THREE.Vector2(0.0, 0.01), // tengah dasar dalam (pada sumbu)
  new THREE.Vector2(0.088, 0.01), // tepi dasar dalam
  new THREE.Vector2(0.094, 0.16), // dinding dalam, melebar ke atas
  new THREE.Vector2(0.094, 0.174), // sisi dalam bibir (vertikal pendek)
  new THREE.Vector2(0.112, 0.174), // bibir/rim atas (cincin datar, terbuka di tengah)
  new THREE.Vector2(0.11, 0.162), // sisi luar bibir bawah
  new THREE.Vector2(0.102, 0.15), // bahu dinding luar
  new THREE.Vector2(0.09, 0.005), // dinding luar bawah
  new THREE.Vector2(0.0, 0.005), // tengah dasar luar (pada sumbu)
];

const bodyGeo = new THREE.LatheGeometry(potProfile, 56);
const body = new THREE.Mesh(bodyGeo, potMat);
body.name = 'panci_body';

// ---------------------------------------------------------------------------
// Tutup — cakram berundak + kubah tipis, terpasang di atas bibir badan
// (y=0.174 = bidang bibir atas). Menjadi satu bagian asset GLB.
// ---------------------------------------------------------------------------
const lidProfile = [
  new THREE.Vector2(0.0, 0.174), // tengah permukaan bawah tutup (pada sumbu)
  new THREE.Vector2(0.1, 0.174), // permukaan bawah (menutup bukaan)
  new THREE.Vector2(0.114, 0.174), // tepi bawah tutup (menggantung di atas rim)
  new THREE.Vector2(0.114, 0.182), // dinding luar tepi tutup
  new THREE.Vector2(0.1, 0.182), // cincin atas datar
  new THREE.Vector2(0.05, 0.19), // awal kubah
  new THREE.Vector2(0.0, 0.192), // puncak kubah (pada sumbu)
];

const lidGeo = new THREE.LatheGeometry(lidProfile, 56);
const lid = new THREE.Mesh(lidGeo, potMat);
lid.name = 'panci_lid';
// Naikkan ~1mm agar permukaan bawah tutup tidak sebidang (z-fighting) dengan
// cincin bibir badan di y=0.174.
lid.position.y = 0.001;

// Kenop kecil di tengah tutup (pegangan buka tutup).
const knobStemGeo = new THREE.CylinderGeometry(0.006, 0.008, 0.008, 16);
const knobStem = new THREE.Mesh(knobStemGeo, potMat);
knobStem.name = 'panci_knob_stem';
knobStem.position.y = 0.197;

const knobTopGeo = new THREE.SphereGeometry(0.014, 20, 16);
const knobTop = new THREE.Mesh(knobTopGeo, potMat);
knobTop.name = 'panci_knob';
knobTop.position.y = 0.202;

// ---------------------------------------------------------------------------
// Satu pegangan utama di sisi kanan (+X) — loop vertikal menonjol ke kanan.
// ---------------------------------------------------------------------------
const handleGeo = new THREE.TorusGeometry(0.028, 0.007, 12, 28);
const handleR = new THREE.Mesh(handleGeo, handleMat);
handleR.name = 'panci_handle_R';
handleR.position.set(0.118, 0.11, 0);

// ---------------------------------------------------------------------------
// Kelompok panci
// ---------------------------------------------------------------------------
const pot = new THREE.Group();
pot.name = 'panci';
pot.add(body, lid, knobStem, knobTop, handleR);

// ---------------------------------------------------------------------------
// Bounding box penulis (untuk info)
// ---------------------------------------------------------------------------
const bbox = new THREE.Box3().setFromObject(pot);
const size = new THREE.Vector3();
bbox.getSize(size);
console.log('Authored bbox size (m):', size.x.toFixed(3), size.y.toFixed(3), size.z.toFixed(3));
console.log('Authored bbox min:', bbox.min.toArray().map((v) => v.toFixed(4)).join(', '));
console.log('Authored bbox max:', bbox.max.toArray().map((v) => v.toFixed(4)).join(', '));

// ---------------------------------------------------------------------------
// Export GLB
// ---------------------------------------------------------------------------
const exporter = new GLTFExporter();
exporter.parse(
  pot,
  (result) => {
    if (result instanceof ArrayBuffer) {
      const outPath = resolvePath('public/panci.glb');
      fs.writeFileSync(outPath, Buffer.from(new Uint8Array(result)));
      console.log('Wrote', outPath, '(', Buffer.byteLength(new Uint8Array(result)), 'bytes )');
    } else {
      console.error('Exporter returned non-binary result');
      process.exit(1);
    }
  },
  (error) => {
    console.error('Export error:', error);
    process.exit(1);
  },
  { binary: true }
);