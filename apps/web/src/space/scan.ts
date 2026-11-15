/**
 * Real 3D interiors for the builder: a .glb/.gltf scan (e.g. one scene from the Habitat-Matterport 3D
 * dataset, HM3D) is loaded in the browser, turned upright, and moved so its floor corner sits at the
 * room origin. The room then takes the scan's size, and equipment is placed on its floor.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface Scan {
  name: string;
  object: THREE.Object3D;
  w: number; // metres along x
  l: number; // metres along z
  h: number; // metres tall
  zUp: boolean;
}

/** Decides whether a mesh was authored Z-up: a house is wider than it is tall, so a tall "y" means y is horizontal. */
export function looksZUp(size: { x: number; y: number; z: number }): boolean {
  return size.y > Math.max(size.x, size.z) * 1.05 || (size.z < size.y * 0.6 && size.z < size.x * 0.6);
}

/** Uprights and re-origins a loaded scene. Exposed for tests. */
export function placeScan(object: THREE.Object3D, zUp?: boolean): { w: number; l: number; h: number; zUp: boolean } {
  object.rotation.set(0, 0, 0);
  object.position.set(0, 0, 0);
  object.updateMatrixWorld(true);
  const raw = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
  const up = zUp ?? looksZUp(raw);
  if (up) object.rotation.x = -Math.PI / 2;
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  object.position.sub(box.min); // min corner → (0,0,0): floor at y=0, corner at the room origin
  object.updateMatrixWorld(true);
  const size = box.getSize(new THREE.Vector3());
  return { w: size.x, l: size.z, h: size.y, zUp: up };
}

export async function loadScan(file: File, zUp?: boolean): Promise<Scan> {
  const buf = await file.arrayBuffer();
  const gltf = await new GLTFLoader().parseAsync(buf, '');
  const object = gltf.scene;
  object.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.receiveShadow = true;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      // Scans are seen from inside: show both faces so walls don't vanish from the wrong side
      mats.forEach((mat) => mat && (mat.side = THREE.DoubleSide));
    }
  });
  const dims = placeScan(object, zUp);
  return { name: file.name.replace(/\.(glb|gltf)$/i, ''), object, ...dims };
}

/** Re-applies the up axis when the user flips it. */
export function reorient(scan: Scan): Scan {
  return { ...scan, ...placeScan(scan.object, !scan.zUp) };
}

export interface Obstacle { x0: number; z0: number; x1: number; z1: number; h: number }

/**
 * Finds the furniture in a scan: look straight down every 10 cm and note where the first surface
 * sits between 15 cm and 2 m above the floor (beds, sofas, counters, tables). Ceilings, walls'
 * tops and ceiling fans are ignored. Neighbouring cells merge into boxes the layout treats as
 * fixed objects, so new equipment isn't dropped through a real sofa.
 */
export function scanObstacles(object: THREE.Object3D, w: number, l: number, h: number, step = 0.1): Obstacle[] {
  const meshes: THREE.Object3D[] = [];
  object.traverse((o) => (o as THREE.Mesh).isMesh && meshes.push(o));
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const nx = Math.max(1, Math.floor(w / step));
  const nz = Math.max(1, Math.floor(l / step));
  const top = Math.min(h - 0.05, 2.2);
  const grid: number[] = new Array(nx * nz).fill(0); // obstacle height per cell, 0 = free floor
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++) {
      ray.set(new THREE.Vector3((i + 0.5) * step, top, (j + 0.5) * step), down);
      ray.far = top + 0.1;
      const hit = ray.intersectObjects(meshes, false)[0];
      if (hit && hit.point.y > 0.15 && hit.point.y < 2.0) grid[i * nz + j] = hit.point.y;
    }
  // greedy merge of occupied cells into rectangles
  const used = new Array(nx * nz).fill(false);
  const out: Obstacle[] = [];
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++) {
      if (!grid[i * nz + j] || used[i * nz + j]) continue;
      let j1 = j;
      while (j1 + 1 < nz && grid[i * nz + j1 + 1] && !used[i * nz + j1 + 1]) j1++;
      let i1 = i;
      const rowOk = (ii: number) => {
        for (let jj = j; jj <= j1; jj++) if (!grid[ii * nz + jj] || used[ii * nz + jj]) return false;
        return true;
      };
      while (i1 + 1 < nx && rowOk(i1 + 1)) i1++;
      let hmax = 0;
      for (let ii = i; ii <= i1; ii++)
        for (let jj = j; jj <= j1; jj++) {
          used[ii * nz + jj] = true;
          hmax = Math.max(hmax, grid[ii * nz + jj]);
        }
      const o = { x0: i * step, z0: j * step, x1: (i1 + 1) * step, z1: (j1 + 1) * step, h: hmax };
      if ((o.x1 - o.x0) * (o.z1 - o.z0) >= 0.04) out.push(o); // ignore specks under 20 x 20 cm
    }
  return out;
}
