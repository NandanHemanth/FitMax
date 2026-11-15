import { describe, expect, it } from 'vitest';
import { FurniturePhysics, loadJolt } from './physics';

describe('furniture physics (Jolt)', () => {
  it('dragging one box shoves another out of the way, and walls hold', async () => {
    const J = await loadJolt();
    const p = new FurniturePhysics(J, { w: 4, l: 3 });
    p.set([
      { uid: 'a', x: 1, z: 1.5, w: 0.6, d: 0.6, h: 0.8, mass: 20 },
      { uid: 'b', x: 2, z: 1.5, w: 0.6, d: 0.6, h: 0.8, mass: 20 },
    ]);
    for (let i = 0; i < 90; i++) {
      p.drag('a', Math.min(2.2, 1 + i * 0.02), 1.5);
      p.step();
    }
    p.release();
    p.settle();
    const pos = p.positions();
    expect(pos.a.x).toBeGreaterThan(2.0);
    expect(pos.b.x - pos.a.x).toBeGreaterThan(0.55); // b was pushed, not overlapped
    expect(pos.b.x).toBeLessThanOrEqual(4 - 0.29); // and stopped by the wall
    p.dispose();
  });

  it('static obstacles (scanned furniture) block items', async () => {
    const J = await loadJolt();
    const p = new FurniturePhysics(J, { w: 4, l: 3 }, [{ x: 2, z: 1.5, w: 0.5, d: 3, h: 1 }]);
    p.set([{ uid: 'a', x: 1, z: 1.5, w: 0.6, d: 0.6, h: 0.8, mass: 20 }]);
    for (let i = 0; i < 120; i++) {
      p.drag('a', 1 + i * 0.03, 1.5);
      p.step();
    }
    p.release();
    // kinematic bodies ignore statics while dragged; once released the solver pushes it out
    p.settle(400);
    const x = p.positions().a.x;
    expect(x < 1.46 || x > 2.54).toBe(true);
    p.dispose();
  });
});
