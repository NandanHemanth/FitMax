/**
 * Furniture physics with Jolt (github.com/jrouwe/JoltPhysics, via the JoltPhysics.js WebAssembly
 * port). Each item is a rigid box on the floor; walls (and furniture detected in a scanned room)
 * are static. While you drag an item it is kinematic, so it shoves the others out of the way with
 * real contact forces instead of passing through them; when you let go everything settles.
 * Items slide on the floor plane only (no tipping), which is how furniture behaves when pushed.
 */
// Types come from the package; the module is loaded lazily so the 3D screen stays light.
import type JoltType from 'jolt-physics';

type J = typeof JoltType;
type JI = Awaited<ReturnType<J>>;

const NON_MOVING = 0;
const MOVING = 1;

export interface Box { x: number; z: number; w: number; d: number; h: number }
export interface Body { uid: string; x: number; z: number; w: number; d: number; h: number; mass: number }

let joltPromise: Promise<JI> | null = null;
export function loadJolt(): Promise<JI> {
  if (!joltPromise) joltPromise = import('jolt-physics').then((m) => (m.default as unknown as J)());
  return joltPromise;
}

export class FurniturePhysics {
  private J: JI;
  private iface: InstanceType<JI['JoltInterface']>;
  private bi: ReturnType<ReturnType<InstanceType<JI['JoltInterface']>['GetPhysicsSystem']>['GetBodyInterface']>;
  private bodies = new Map<string, { id: InstanceType<JI['BodyID']>; body: Body }>();
  private statics: InstanceType<JI['BodyID']>[] = [];
  private dragging: string | null = null;

  constructor(J: JI, room: { w: number; l: number }, obstacles: Box[] = []) {
    this.J = J;
    const settings = new J.JoltSettings();
    settings.mMaxWorkerThreads = 1;
    const pairs = new J.ObjectLayerPairFilterTable(2);
    pairs.EnableCollision(NON_MOVING, MOVING);
    pairs.EnableCollision(MOVING, MOVING);
    const bp = new J.BroadPhaseLayerInterfaceTable(2, 2);
    bp.MapObjectToBroadPhaseLayer(NON_MOVING, new J.BroadPhaseLayer(0));
    bp.MapObjectToBroadPhaseLayer(MOVING, new J.BroadPhaseLayer(1));
    settings.mObjectLayerPairFilter = pairs;
    settings.mBroadPhaseLayerInterface = bp;
    settings.mObjectVsBroadPhaseLayerFilter = new J.ObjectVsBroadPhaseLayerFilterTable(bp, 2, pairs, 2);
    this.iface = new J.JoltInterface(settings);
    J.destroy(settings);
    const sys = this.iface.GetPhysicsSystem();
    sys.SetGravity(new J.Vec3(0, 0, 0)); // the floor carries the weight; we only slide in x/z
    this.bi = sys.GetBodyInterface();
    // Walls: 0.2 m thick boxes just outside the room
    const t = 0.2;
    const H = 3;
    for (const b of [
      { x: room.w / 2, z: -t / 2, w: room.w + 2 * t, d: t, h: H },
      { x: room.w / 2, z: room.l + t / 2, w: room.w + 2 * t, d: t, h: H },
      { x: -t / 2, z: room.l / 2, w: t, d: room.l, h: H },
      { x: room.w + t / 2, z: room.l / 2, w: t, d: room.l, h: H },
      ...obstacles,
    ])
      this.statics.push(this.box(b, J.EMotionType_Static, NON_MOVING, 0));
  }

  private box(b: Box, motion: number, layer: number, mass: number) {
    const J = this.J;
    const shape = new J.BoxShape(new J.Vec3(Math.max(0.02, b.w / 2 - 0.005), Math.max(0.02, b.h / 2), Math.max(0.02, b.d / 2 - 0.005)), 0.01, undefined as never);
    const cs = new J.BodyCreationSettings(shape, new J.RVec3(b.x, b.h / 2, b.z), J.Quat.prototype.sIdentity(), motion as never, layer);
    if (motion !== J.EMotionType_Static) {
      cs.mAllowedDOFs = (J.EAllowedDOFs_TranslationX | J.EAllowedDOFs_TranslationZ) as never; // slide, don't tip or lift
      cs.mOverrideMassProperties = J.EOverrideMassProperties_CalculateInertia;
      cs.mMassPropertiesOverride.mMass = Math.max(1, mass);
      cs.mLinearDamping = 6; // floor friction: pushed furniture stops quickly
      cs.mFriction = 0.7;
      cs.mRestitution = 0;
      cs.mMotionQuality = J.EMotionQuality_LinearCast;
    }
    const body = this.bi.CreateBody(cs);
    J.destroy(cs);
    this.bi.AddBody(body.GetID(), J.EActivation_Activate);
    return body.GetID();
  }

  set(items: Body[]) {
    const keep = new Set(items.map((i) => i.uid));
    for (const [uid, b] of this.bodies) if (!keep.has(uid)) this.remove(uid) || b;
    for (const it of items) {
      const cur = this.bodies.get(it.uid);
      if (cur && cur.body.w === it.w && cur.body.d === it.d) {
        if (this.dragging !== it.uid) this.bi.SetPosition(cur.id, new this.J.RVec3(it.x, it.h / 2, it.z), this.J.EActivation_Activate);
        cur.body = it;
        continue;
      }
      if (cur) this.remove(it.uid);
      this.bodies.set(it.uid, { id: this.box(it, this.J.EMotionType_Dynamic, MOVING, it.mass), body: it });
    }
  }

  remove(uid: string): boolean {
    const b = this.bodies.get(uid);
    if (!b) return false;
    this.bi.RemoveBody(b.id);
    this.bi.DestroyBody(b.id);
    this.bodies.delete(uid);
    return true;
  }

  /** Move an item toward (x, z) as an unstoppable hand; it pushes whatever is in the way. */
  drag(uid: string, x: number, z: number, dt = 1 / 60) {
    const b = this.bodies.get(uid);
    if (!b) return;
    if (this.dragging !== uid) {
      this.bi.SetMotionType(b.id, this.J.EMotionType_Kinematic, this.J.EActivation_Activate);
      this.dragging = uid;
    }
    this.bi.MoveKinematic(b.id, new this.J.RVec3(x, b.body.h / 2, z), this.J.Quat.prototype.sIdentity(), dt);
  }

  release() {
    if (!this.dragging) return;
    const b = this.bodies.get(this.dragging);
    if (b) {
      this.bi.SetMotionType(b.id, this.J.EMotionType_Dynamic, this.J.EActivation_Activate);
      this.bi.SetLinearVelocity(b.id, new this.J.Vec3(0, 0, 0));
    }
    this.dragging = null;
  }

  step(dt = 1 / 60, substeps = 2) {
    this.iface.Step(dt, substeps);
  }

  /** Current item centres. */
  positions(): Record<string, { x: number; z: number }> {
    const out: Record<string, { x: number; z: number }> = {};
    for (const [uid, b] of this.bodies) {
      const p = this.bi.GetPosition(b.id);
      out[uid] = { x: p.GetX(), z: p.GetZ() };
    }
    return out;
  }

  /** Run the world until nothing moves (or `maxSteps`). Returns how many steps it took. */
  settle(maxSteps = 240) {
    let prev = this.positions();
    for (let i = 0; i < maxSteps; i++) {
      this.step();
      const cur = this.positions();
      const moved = Object.keys(cur).some((k) => Math.abs(cur[k].x - prev[k].x) + Math.abs(cur[k].z - prev[k].z) > 1e-4);
      prev = cur;
      if (!moved && i > 3) return i;
    }
    return maxSteps;
  }

  dispose() {
    for (const uid of [...this.bodies.keys()]) this.remove(uid);
    for (const id of this.statics) {
      this.bi.RemoveBody(id);
      this.bi.DestroyBody(id);
    }
    this.J.destroy(this.iface);
  }
}
