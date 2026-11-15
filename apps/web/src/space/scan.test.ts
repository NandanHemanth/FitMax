import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { looksZUp, placeScan } from './scan';

const room = (x: number, y: number, z: number) => new THREE.Mesh(new THREE.BoxGeometry(x, y, z));

describe('scan placement', () => {
  it('detects a Z-up scan (tall in y) and stands it upright with the floor at y=0', () => {
    const m = room(7, 5, 2.6); // authored Z-up: 7 x 5 floor, 2.6 m up the z axis
    m.position.set(10, -3, 4);
    expect(looksZUp({ x: 7, y: 5, z: 2.6 })).toBe(true);
    const d = placeScan(m);
    expect(d.zUp).toBe(true);
    expect(d.w).toBeCloseTo(7);
    expect(d.h).toBeCloseTo(2.6);
    expect(d.l).toBeCloseTo(5);
    const box = new THREE.Box3().setFromObject(m);
    expect(box.min.x).toBeCloseTo(0);
    expect(box.min.y).toBeCloseTo(0);
    expect(box.min.z).toBeCloseTo(0);
  });
  it('leaves a Y-up scan as it is', () => {
    const d = placeScan(room(8, 2.5, 6));
    expect(d.zUp).toBe(false);
    expect(d.h).toBeCloseTo(2.5);
  });
});

import { scanObstacles } from './scan';
describe('scan furniture detection', () => {
  it('finds a sofa-sized box on the floor and ignores the floor itself', async () => {
    const THREE = await import('three');
    const room = new THREE.Group();
    const floor = new THREE.Mesh(new THREE.BoxGeometry(4, 0.02, 3), new THREE.MeshBasicMaterial());
    floor.position.set(2, 0, 1.5);
    const sofa = new THREE.Mesh(new THREE.BoxGeometry(2, 0.8, 0.9), new THREE.MeshBasicMaterial());
    sofa.position.set(1.5, 0.4, 0.6);
    room.add(floor, sofa);
    room.updateMatrixWorld(true);
    const obs = scanObstacles(room, 4, 3, 2.5);
    expect(obs.length).toBe(1);
    const o = obs[0];
    expect(o.x0).toBeCloseTo(0.5, 1);
    expect(o.x1).toBeCloseTo(2.5, 1);
    expect(o.z1).toBeCloseTo(1.0, 1);
    expect(o.h).toBeCloseTo(0.8, 1);
  });
});
