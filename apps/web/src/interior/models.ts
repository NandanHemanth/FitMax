/**
 * Low-poly 3D models for furniture and gym equipment, built in code with three.js primitives
 * (no downloaded assets, so no licensing questions, and every piece is exactly the size in the
 * catalog). Each builder returns a Group whose footprint is centred on the origin, front = +z,
 * floor at y = 0. A GLB from any CC0 library (Poly Pizza, Kenney) can replace one via `fromGlb`.
 */
import * as THREE from 'three';
import type { Model, Thing } from './things';

const mats = new Map<string, THREE.MeshStandardMaterial>();
export function mat(color: string, rough = 0.75, metal = 0.05, opacity = 1): THREE.MeshStandardMaterial {
  const k = `${color}|${rough}|${metal}|${opacity}`;
  let m = mats.get(k);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, transparent: opacity < 1, opacity });
    mats.set(k, m);
  }
  return m;
}
const box = (g: THREE.Group, w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, r = 0) => {
  const geo = r > 0 ? roundedBox(w, h, d, r) : new THREE.BoxGeometry(w, h, d);
  const me = new THREE.Mesh(geo, m);
  me.position.set(x, y, z);
  me.castShadow = true;
  me.receiveShadow = true;
  g.add(me);
  return me;
};
const cyl = (g: THREE.Group, rt: number, rb: number, h: number, x: number, y: number, z: number, m: THREE.Material, axis: 'y' | 'x' | 'z' = 'y', seg = 16) => {
  const me = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
  if (axis === 'x') me.rotation.z = Math.PI / 2;
  if (axis === 'z') me.rotation.x = Math.PI / 2;
  me.position.set(x, y, z);
  me.castShadow = true;
  g.add(me);
  return me;
};
function roundedBox(w: number, h: number, d: number, r: number) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  r = Math.min(r, w / 2, h / 2);
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false, curveSegments: 4 });
  g.translate(0, 0, -d / 2);
  return g;
}

const DARK = '#2b2d31';
const STEEL = '#8a8f98';
const WOOD = '#a57c52';

type Build = (g: THREE.Group, t: Thing) => void;

const B: Partial<Record<Model, Build>> = {
  sofa: (g, { w, d, h, color }) => {
    const m = mat(color, 0.9);
    box(g, w, 0.18, d, 0, 0.18, 0, mat(DARK)); // base
    box(g, w - 0.3, 0.16, d - 0.25, 0, 0.36, 0.08, m, 0.05); // seat cushions
    box(g, w, h - 0.25, 0.22, 0, 0.25 + (h - 0.25) / 2, -d / 2 + 0.11, m, 0.06); // back
    box(g, 0.16, 0.42, d, -w / 2 + 0.08, 0.4, 0, m, 0.05);
    box(g, 0.16, 0.42, d, w / 2 - 0.08, 0.4, 0, m, 0.05);
    box(g, 0.45, 0.22, 0.12, -w / 4, 0.55, -d / 2 + 0.28, mat('#d7cdbd', 0.95), 0.05); // lumbar pillows
    box(g, 0.45, 0.22, 0.12, w / 4, 0.55, -d / 2 + 0.28, mat('#d7cdbd', 0.95), 0.05);
  },
  sectional: (g, { w, d, color }) => {
    const m = mat(color, 0.95);
    box(g, w, 0.42, 1.0, 0, 0.21, -d / 2 + 0.5, m, 0.12);
    box(g, 1.0, 0.42, d - 1.0, w / 2 - 0.5, 0.21, 0.5, m, 0.12);
    box(g, w, 0.33, 0.3, 0, 0.58, -d / 2 + 0.15, m, 0.12);
  },
  armchair: (g, { w, d, h, color }) => {
    const m = mat(color, 0.9);
    box(g, w, 0.38, d, 0, 0.27, 0, m, 0.05);
    box(g, w, h - 0.45, 0.16, 0, 0.45 + (h - 0.45) / 2, -d / 2 + 0.08, m, 0.05);
    for (const s of [-1, 1]) box(g, 0.12, 0.25, d, s * (w / 2 - 0.06), 0.58, 0, m, 0.04);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(g, 0.02, 0.015, 0.1, sx * (w / 2 - 0.08), 0.05, sz * (d / 2 - 0.08), mat(WOOD));
  },
  chair: (g, { w, d, h, color, rf }) => {
    const m = mat(color, 0.6, rf === 'metal' ? 0.3 : 0.05);
    box(g, w * 0.9, 0.07, d * 0.85, 0, 0.47, 0.03, m, 0.03);
    box(g, w * 0.85, h - 0.55, 0.06, 0, 0.55 + (h - 0.55) / 2, -d / 2 + 0.06, m, 0.03);
    if (rf === 'metal') {
      cyl(g, 0.025, 0.025, 0.4, 0, 0.24, 0, mat(STEEL, 0.3, 0.8));
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        box(g, 0.32, 0.03, 0.04, Math.cos(a) * 0.14, 0.04, Math.sin(a) * 0.14, mat(STEEL, 0.3, 0.8)).rotation.y = -a;
      }
    } else for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, 0.035, 0.45, 0.035, sx * (w / 2 - 0.05), 0.225, sz * (d / 2 - 0.05), m);
  },
  bed: (g, { w, d, color }) => {
    box(g, w, 0.3, d, 0, 0.15, 0, mat(WOOD, 0.7));
    box(g, w - 0.06, 0.22, d - 0.1, 0, 0.41, 0.03, mat('#f4f1ea', 0.95), 0.06); // mattress
    box(g, w - 0.04, 0.06, d * 0.6, 0, 0.53, 0.2, mat(color, 0.95), 0.03); // duvet
    box(g, w, 0.9, 0.08, 0, 0.45, -d / 2 + 0.04, mat(WOOD, 0.7), 0.02); // headboard
    for (const s of [-1, 1]) box(g, w / 2 - 0.12, 0.12, 0.32, (s * w) / 4, 0.58, -d / 2 + 0.3, mat('#ffffff', 0.95), 0.05);
  },
  nightstand: (g, { w, d, h, color }) => {
    box(g, w, h, d, 0, h / 2, 0, mat(color, 0.7), 0.02);
    cyl(g, 0.08, 0.1, 0.3, 0, h + 0.15, 0, mat('#efe6d2', 0.6));
  },
  wardrobe: (g, { w, d, h, color }) => {
    box(g, w, h, d, 0, h / 2, 0, mat(color, 0.7), 0.01);
    box(g, 0.01, h - 0.1, 0.01, 0, h / 2, d / 2, mat('#00000055'));
    for (const s of [-1, 1]) box(g, 0.02, 0.25, 0.03, s * 0.06, h / 2, d / 2 + 0.01, mat(STEEL, 0.3, 0.8));
  },
  desk: (g, { w, d, h, color }) => {
    box(g, w, 0.035, d, 0, h, 0, mat(color, 0.6), 0.01);
    for (const s of [-1, 1]) {
      box(g, 0.07, h, 0.07, s * (w / 2 - 0.15), h / 2, 0, mat(DARK, 0.4, 0.6));
      box(g, 0.07, 0.04, d - 0.05, s * (w / 2 - 0.15), 0.02, 0, mat(DARK, 0.4, 0.6));
    }
    box(g, 0.6, 0.36, 0.03, 0, h + 0.4, -d / 2 + 0.15, mat('#111318', 0.3)); // monitor
    box(g, 0.05, 0.2, 0.05, 0, h + 0.12, -d / 2 + 0.15, mat(DARK));
  },
  walkpad: (g, { w, d, color }) => {
    box(g, w, 0.1, d, 0, 0.05, 0, mat(color, 0.5), 0.03);
    box(g, w - 0.12, 0.02, d - 0.2, 0, 0.11, 0, mat('#15161a', 0.9));
  },
  table: (g, { w, d, h, color }) => {
    box(g, w, 0.04, d, 0, h, 0, mat(color, 0.6), 0.01);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, 0.05, h, 0.05, sx * (w / 2 - 0.08), h / 2, sz * (d / 2 - 0.08), mat(color, 0.6));
    // chairs around
    const c = mat('#c9b79c', 0.8);
    for (const sx of [-0.35, 0.35]) for (const sz of [-1, 1]) {
      box(g, 0.42, 0.05, 0.42, sx * w, 0.46, sz * (d / 2 + 0.25), c);
      box(g, 0.42, 0.45, 0.05, sx * w, 0.7, sz * (d / 2 + 0.44), c);
    }
  },
  coffee: (g, { w, d, h, color }) => {
    box(g, w, 0.05, d, 0, h, 0, mat(color, 0.5), 0.02);
    box(g, w - 0.1, 0.03, d - 0.1, 0, 0.12, 0, mat(color, 0.6));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, 0.04, h, 0.04, sx * (w / 2 - 0.06), h / 2, sz * (d / 2 - 0.06), mat(DARK));
  },
  tv: (g, { w, d }) => {
    box(g, w, 0.45, d, 0, 0.225, 0, mat('#3a3631', 0.6), 0.02);
    box(g, w * 0.85, w * 0.85 * 0.5625, 0.04, 0, 0.5 + (w * 0.85 * 0.5625) / 2, -d / 2 + 0.08, mat('#0b0c0f', 0.2, 0.3));
  },
  rug: (g, { w, d, color }) => {
    box(g, w, 0.012, d, 0, 0.006, 0, mat(color, 1));
    box(g, w - 0.2, 0.013, d - 0.2, 0, 0.007, 0, mat('#ffffff', 1, 0, 0.12));
  },
  floor: (g, { w, d, color }) => box(g, w, 0.01, d, 0, 0.005, 0, mat(color, 0.95)),
  plant: (g, { h }) => {
    cyl(g, 0.16, 0.12, 0.32, 0, 0.16, 0, mat('#d9d1c3', 0.8));
    const leaf = mat('#3f7d4e', 0.8);
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.2 + (i % 3) * 0.04, 8, 6), leaf);
      s.position.set(Math.cos(i * 1.7) * 0.12, 0.45 + (i / 6) * (h - 0.6), Math.sin(i * 1.7) * 0.12);
      s.castShadow = true;
      g.add(s);
    }
  },
  lamp: (g, { h, color }) => {
    cyl(g, 0.15, 0.15, 0.03, 0, 0.015, 0, mat(DARK));
    cyl(g, 0.012, 0.012, h - 0.3, 0, (h - 0.3) / 2, 0, mat(DARK, 0.4, 0.6));
    const shade = cyl(g, 0.12, 0.2, 0.3, 0, h - 0.15, 0, new THREE.MeshStandardMaterial({ color, emissive: '#ffcf8a', emissiveIntensity: 0.6, roughness: 0.9 }));
    shade.castShadow = false;
    const l = new THREE.PointLight('#ffd9a0', 0.6, 3.5);
    l.position.set(0, h - 0.2, 0);
    g.add(l);
  },
  shelf: (g, { w, d, h, color }) => {
    const m = mat(color, 0.7);
    for (const s of [-1, 1]) box(g, 0.03, h, d, s * (w / 2 - 0.015), h / 2, 0, m);
    for (let i = 0; i <= 4; i++) box(g, w, 0.025, d, 0, (i * h) / 4.05 + 0.02, 0, m);
    const cols = ['#b5523b', '#3e5c76', '#d9b44a', '#5d7b4f', '#7a5c8c'];
    for (let i = 0; i < 4; i++) for (let k = 0; k < 6; k++) box(g, 0.05, 0.26, d * 0.8, -w / 2 + 0.12 + k * 0.13, (i * h) / 4.05 + 0.16, 0, mat(cols[(i + k) % 5], 0.8));
  },
  aquarium: (g, { w, d, h }) => {
    box(g, w, 0.7, d, 0, 0.35, 0, mat(DARK, 0.6));
    box(g, w, h - 0.7, d, 0, 0.7 + (h - 0.7) / 2, 0, mat('#4aa3c7', 0.1, 0.1, 0.55));
  },
  fridge: (g, { w, d, h, color }) => {
    box(g, w, h, d, 0, h / 2, 0, mat(color, 0.25, 0.7), 0.03);
    box(g, 0.02, h * 0.3, 0.03, w / 2 - 0.08, h * 0.65, d / 2 + 0.01, mat(DARK));
  },
  counter: (g, { w, d, h, color }) => {
    box(g, w, h - 0.04, d, 0, (h - 0.04) / 2, 0, mat('#f1efe9', 0.7));
    box(g, w, 0.04, d + 0.02, 0, h - 0.02, 0.01, mat(color, 0.3));
    box(g, w, 0.7, 0.35, 0, h + 0.85, -d / 2 + 0.175, mat('#f1efe9', 0.7));
  },
  island: (g, { w, d, h, color }) => {
    box(g, w, h - 0.04, d, 0, (h - 0.04) / 2, 0, mat('#3f4a56', 0.6));
    box(g, w + 0.05, 0.04, d + 0.05, 0, h - 0.02, 0, mat(color, 0.3));
  },
  tub: (g, { w, d, h }) => {
    box(g, w, h, d, 0, h / 2, 0, mat('#f7f7f5', 0.3), 0.08);
    box(g, w - 0.14, 0.02, d - 0.14, 0, h - 0.05, 0, mat('#bfe0ef', 0.1, 0, 0.8));
  },
  vanity: (g, { w, d, h }) => {
    box(g, w, h, d, 0, h / 2, 0, mat('#8c7a66', 0.7));
    box(g, w * 0.8, 0.6, 0.03, 0, h + 0.55, -d / 2 + 0.02, mat('#cfe3ea', 0.05, 0.9));
  },
  washer: (g, { w, d, h, color }) => {
    for (const s of [-1, 1]) {
      box(g, w / 2 - 0.02, h, d, (s * w) / 4, h / 2, 0, mat(color, 0.4, 0.2), 0.03);
      cyl(g, 0.17, 0.17, 0.02, (s * w) / 4, h * 0.45, d / 2 + 0.01, mat('#9fb4c4', 0.1, 0.3), 'z', 24);
    }
  },
  car: (g, { w, d, color }) => {
    box(g, w, 0.7, d, 0, 0.55, 0, mat(color, 0.35, 0.6), 0.25);
    box(g, w - 0.15, 0.5, d * 0.5, 0, 1.1, -0.1, mat('#1d2633', 0.15, 0.5), 0.15);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(g, 0.33, 0.33, 0.22, sx * (w / 2 - 0.08), 0.33, sz * (d / 2 - 0.75), mat('#111'), 'x', 18);
  },
  // ---------------------------------------------------------------- gym
  rack: (g, { w, d, h, color }) => {
    const m = mat(color, 0.4, 0.7);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, 0.075, h, 0.075, sx * (w / 2 - 0.04), h / 2, sz * (d / 2 - 0.04), m);
    for (const sz of [-1, 1]) box(g, w, 0.075, 0.075, 0, h - 0.04, sz * (d / 2 - 0.04), m);
    for (const sx of [-1, 1]) {
      box(g, 0.075, 0.075, d, sx * (w / 2 - 0.04), h - 0.04, 0, m);
      box(g, 0.075, 0.05, d, sx * (w / 2 - 0.04), 0.03, 0, m);
    }
    cyl(g, 0.014, 0.014, 2.2, 0, 1.35, d / 2 - 0.15, mat(STEEL, 0.25, 0.9), 'x');
    for (const s of [-1, 1]) cyl(g, 0.225, 0.225, 0.07, s * 0.85, 1.35, d / 2 - 0.15, mat('#16171a', 0.6), 'x', 24);
  },
  bench: (g, { w, d, color }) => {
    box(g, w * 0.45, 0.08, d, 0, 0.44, 0, mat(color, 0.8), 0.03);
    box(g, 0.08, 0.4, d * 0.8, 0, 0.2, 0, mat(STEEL, 0.4, 0.7));
    for (const s of [-1, 1]) box(g, w, 0.05, 0.07, 0, 0.03, s * (d / 2 - 0.1), mat(STEEL, 0.4, 0.7));
  },
  box: (g, { w, d, h, color, key }) => {
    if (key === 'dumbbells' || key === 'kettlebells') {
      box(g, w, 0.05, d, 0, h * 0.55, 0, mat(DARK, 0.4, 0.6));
      for (const sx of [-1, 1]) box(g, 0.05, h * 0.55, d * 0.9, sx * (w / 2 - 0.03), (h * 0.55) / 2, 0, mat(DARK, 0.4, 0.6));
      const n = key === 'dumbbells' ? 2 : 4;
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + ((i + 0.5) * w) / n;
        if (key === 'dumbbells') {
          cyl(g, 0.1, 0.1, d * 0.75, x, h * 0.55 + 0.1, 0, mat('#2c2e33', 0.5), 'z', 14);
        } else {
          const s = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), mat('#1b1c20', 0.5, 0.3));
          s.position.set(x, h * 0.55 + 0.1, 0);
          s.castShadow = true;
          g.add(s);
        }
      }
    } else box(g, w, h, d, 0, h / 2, 0, mat(color, 0.8), 0.02);
  },
  treadmill: (g, { w, d, h, color }) => {
    box(g, w, 0.18, d, 0, 0.09, 0, mat(color, 0.6), 0.04);
    box(g, w - 0.18, 0.02, d - 0.35, 0, 0.19, 0.1, mat('#0f1013', 0.95));
    for (const s of [-1, 1]) box(g, 0.05, h - 0.2, 0.05, s * (w / 2 - 0.05), (h - 0.2) / 2 + 0.18, -d / 2 + 0.15, mat(STEEL, 0.3, 0.8));
    box(g, w, 0.28, 0.12, 0, h - 0.05, -d / 2 + 0.15, mat('#202227', 0.4), 0.03);
  },
  bike: (g, { d, h, color }) => {
    box(g, 0.08, 0.05, d, 0, 0.03, 0, mat(DARK, 0.5, 0.5));
    cyl(g, 0.25, 0.25, 0.06, 0, 0.35, -d / 2 + 0.25, mat(color, 0.4, 0.4), 'x', 24);
    box(g, 0.05, 0.7, 0.05, 0, 0.55, 0.12, mat(DARK, 0.5, 0.5)).rotation.x = -0.25;
    box(g, 0.22, 0.06, 0.28, 0, 0.92, 0.25, mat('#111', 0.8), 0.03);
    box(g, 0.05, 0.75, 0.05, 0, 0.6, -d / 2 + 0.3, mat(DARK, 0.5, 0.5)).rotation.x = 0.2;
    box(g, 0.45, 0.04, 0.04, 0, h - 0.05, -d / 2 + 0.22, mat(DARK, 0.5, 0.5));
  },
  rower: (g, { w, d, color }) => {
    box(g, 0.12, 0.08, d, 0, 0.3, 0.1, mat(STEEL, 0.4, 0.7));
    cyl(g, 0.24, 0.24, 0.2, 0, 0.3, -d / 2 + 0.3, mat(color, 0.4, 0.3), 'x', 24);
    box(g, 0.3, 0.06, 0.3, 0, 0.38, 0.4, mat('#111', 0.8), 0.03);
    box(g, w, 0.04, 0.06, 0, 0.03, d / 2 - 0.1, mat(DARK));
  },
  platform: (g, { w, d }) => {
    box(g, w, 0.05, d, 0, 0.025, 0, mat('#2a2b2f', 0.95));
    box(g, w * 0.45, 0.052, d - 0.05, 0, 0.026, 0, mat('#b08a5a', 0.7));
    cyl(g, 0.014, 0.014, 2.2, 0, 0.225, 0, mat(STEEL, 0.25, 0.9), 'x');
    for (const s of [-1, 1]) cyl(g, 0.225, 0.225, 0.07, s * 0.85, 0.225, 0, mat('#16171a', 0.6), 'x', 24);
  },
  cable: (g, { w, d, h, color }) => {
    const m = mat(color, 0.4, 0.6);
    for (const s of [-1, 1]) {
      box(g, 0.1, h, 0.1, s * (w / 2 - 0.05), h / 2, -d / 2 + 0.1, m);
      box(g, 0.25, 1.0, 0.18, s * (w / 2 - 0.15), 0.6, -d / 2 + 0.12, mat('#1b1c20', 0.6));
    }
    box(g, w, 0.1, 0.1, 0, h - 0.05, -d / 2 + 0.1, m);
    box(g, 0.08, 0.05, d, 0, 0.03, 0, m);
  },
  bar: (g, { w, h }) => {
    for (const s of [-1, 1]) box(g, 0.05, 0.4, 0.05, s * (w / 2 - 0.1), h - 0.2, 0, mat(DARK, 0.4, 0.6));
    cyl(g, 0.016, 0.016, w, 0, h - 0.05, 0.3, mat(STEEL, 0.25, 0.9), 'x');
    for (const s of [-1, 1]) box(g, 0.04, 0.04, 0.32, s * (w / 2 - 0.1), h - 0.05, 0.15, mat(DARK, 0.4, 0.6));
  },
  mat: (g, { w, d, color }) => box(g, w, 0.02, d, 0, 0.01, 0, mat(color, 0.95), 0.005),
  mirror: (g, { w, d, h }) => {
    box(g, w, h, d, 0, 0.3 + h / 2, 0, mat('#cfe3ea', 0.03, 1), 0.01);
    box(g, w + 0.04, h + 0.04, d * 0.5, 0, 0.3 + h / 2, -0.01, mat(DARK));
  },
};

export function buildModel(t: Thing): THREE.Group {
  const g = new THREE.Group();
  (B[t.model] ?? ((gg: THREE.Group) => box(gg, t.w, t.h, t.d, 0, t.h / 2, 0, mat(t.color))))(g, t);
  g.userData.key = t.key;
  return g;
}
