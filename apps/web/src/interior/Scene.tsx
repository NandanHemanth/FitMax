/**
 * The 3D home: a cut-away "dollhouse" of the whole floor plan. Tap a room to fly in; inside a
 * room, drag furniture and equipment around. Dragging runs through Jolt physics, so the piece you
 * hold shoves the others aside instead of passing through them, and walls stop everything.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { dims, type Item } from './engine';
import type { Plan, PlanRoom, RoomType } from './floorplan';
import { buildModel, mat } from './models';
import { FurniturePhysics, loadJolt } from './physics';
import { thing } from './things';

export interface SceneHandle {
  snapshot: () => string | null;
}

interface Props {
  plan: Plan;
  level: number;
  items: Record<string, Item[]>; // per room id
  roomId: string | null;
  selected: string | null;
  dark: boolean;
  links?: [[number, number], [number, number]][] | null; // sensing lines in room coords
  onPickRoom: (id: string | null) => void;
  onSelect: (uid: string | null) => void;
  onCommit: (roomId: string, items: Item[]) => void;
}

const FLOOR: Record<RoomType, [string, string]> = {
  living: ['#e9e1d4', '#3a352e'], family: ['#e9e1d4', '#3a352e'], dining: ['#e3d6c3', '#3b342b'], kitchen: ['#ece9e3', '#34363a'],
  office: ['#dfe4ea', '#2f343b'], gym: ['#d4dbd4', '#2c332d'], primary: ['#efe5da', '#3d3530'], bed: ['#efe5da', '#3d3530'],
  bath: ['#e6eef2', '#2e3438'], laundry: ['#e6eef2', '#2e3438'], hall: ['#ddd6cc', '#33302c'], garage: ['#cfcfcf', '#2a2a2a'],
};
const WALL_H_HOUSE = 1.05;
const WALL_H_ROOM = 1.25;
const T = 0.1;

interface State {
  renderer: THREE.WebGLRenderer;
  labels: CSS2DRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  world: THREE.Group;
  meshes: Map<string, { g: THREE.Object3D; room: PlanRoom }>;
  floors: THREE.Mesh[];
  tween: { from: [THREE.Vector3, THREE.Vector3]; to: [THREE.Vector3, THREE.Vector3]; t0: number } | null;
  physics: FurniturePhysics | null;
  physicsRoom: string | null;
  drag: { uid: string; off: THREE.Vector3; room: PlanRoom } | null;
  raf: number;
}

export const Scene = forwardRef<SceneHandle, Props>(function Scene(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const st = useRef<State | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  useImperativeHandle(ref, () => ({
    snapshot: () => {
      const s = st.current;
      if (!s) return null;
      s.renderer.render(s.scene, s.camera);
      return s.renderer.domElement.toDataURL('image/png');
    },
  }));

  // ------------------------------------------------------------ setup once
  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    el.appendChild(renderer.domElement);
    const labels = new CSS2DRenderer();
    labels.domElement.className = 'scene-labels';
    el.appendChild(labels.domElement);
    const scene = new THREE.Scene();
    // soft studio reflections, so metal looks like metal instead of black
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.55;
    const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 400);
    camera.position.set(0, 20, 18);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI * 0.47;
    controls.minDistance = 2;
    controls.maxDistance = 80;
    scene.add(new THREE.HemisphereLight('#ffffff', '#8a8070', 1.1));
    const sun = new THREE.DirectionalLight('#fff3e0', 1.6);
    sun.position.set(8, 18, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -25;
    sun.shadow.camera.right = 25;
    sun.shadow.camera.top = 25;
    sun.shadow.camera.bottom = -25;
    scene.add(sun);
    const world = new THREE.Group();
    scene.add(world);
    const s: State = { renderer, labels, scene, camera, controls, world, meshes: new Map(), floors: [], tween: null, physics: null, physicsRoom: null, drag: null, raf: 0 };
    st.current = s;

    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      renderer.setSize(w, h);
      labels.setSize(w, h);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    const loop = () => {
      s.raf = requestAnimationFrame(loop);
      if (s.tween) {
        const k = Math.min(1, (performance.now() - s.tween.t0) / 700);
        const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
        camera.position.lerpVectors(s.tween.from[0], s.tween.to[0], e);
        controls.target.lerpVectors(s.tween.from[1], s.tween.to[1], e);
        if (k >= 1) s.tween = null;
      }
      controls.update();
      renderer.render(scene, camera);
      labels.render(scene, camera);
    };
    loop();

    // ---------------------------------------------------------- picking & dragging
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const toNdc = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
    };
    let downAt: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      downAt = { x: e.clientX, y: e.clientY };
      const p = propsRef.current;
      if (!p.roomId) return;
      toNdc(e);
      const roomMeshes = [...s.meshes.entries()].filter(([, m]) => m.room.id === p.roomId);
      const hits = ray.intersectObjects(
        roomMeshes.map(([, m]) => m.g),
        true,
      );
      if (!hits.length) return;
      let o: THREE.Object3D | null = hits[0].object;
      while (o && !o.userData.uid) o = o.parent;
      if (!o) return;
      const uid = o.userData.uid as string;
      const m = s.meshes.get(uid)!;
      const hit = new THREE.Vector3();
      ray.ray.intersectPlane(floorPlane, hit);
      s.drag = { uid, off: hit.sub(m.g.position), room: m.room };
      controls.enabled = false;
      p.onSelect(uid);
      renderer.domElement.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      const d = s.drag;
      if (!d) return;
      toNdc(e);
      const hit = new THREE.Vector3();
      if (!ray.ray.intersectPlane(floorPlane, hit)) return;
      const it = (propsRef.current.items[d.room.id] ?? []).find((x) => x.uid === d.uid);
      const t = it && thing(it.key);
      if (!it || !t) return;
      const { w, d: dd } = dims(t, it.rot);
      const lx = Math.min(d.room.w - w / 2, Math.max(w / 2, hit.x - d.off.x - d.room.x));
      const lz = Math.min(d.room.d - dd / 2, Math.max(dd / 2, hit.z - d.off.z - d.room.z));
      if (s.physics && s.physicsRoom === d.room.id) {
        s.physics.drag(d.uid, lx, lz);
        s.physics.step();
        s.physics.step();
        const pos = s.physics.positions();
        for (const [uid, q] of Object.entries(pos)) {
          const mm = s.meshes.get(uid);
          if (mm) mm.g.position.set(d.room.x + q.x, mm.g.position.y, d.room.z + q.z);
        }
      } else {
        const mm = s.meshes.get(d.uid)!;
        mm.g.position.set(d.room.x + lx, mm.g.position.y, d.room.z + lz);
      }
    };
    const onUp = (e: PointerEvent) => {
      const p = propsRef.current;
      const d = s.drag;
      if (d) {
        s.drag = null;
        controls.enabled = true;
        const list = p.items[d.room.id] ?? [];
        let pos: Record<string, { x: number; z: number }> = {};
        if (s.physics && s.physicsRoom === d.room.id) {
          s.physics.release();
          s.physics.settle(120);
          pos = s.physics.positions();
        } else {
          const mm = s.meshes.get(d.uid)!;
          pos[d.uid] = { x: mm.g.position.x - d.room.x, z: mm.g.position.z - d.room.z };
        }
        const r2 = (v: number) => Math.round(v * 100) / 100;
        p.onCommit(
          d.room.id,
          list.map((it) => (pos[it.uid] ? { ...it, x: r2(pos[it.uid].x), z: r2(pos[it.uid].z) } : it)),
        );
        return;
      }
      // a click (not an orbit drag): pick a room in house view, or deselect
      if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 5) {
        toNdc(e);
        const hits = ray.intersectObjects(s.floors, false);
        if (!p.roomId && hits.length) p.onPickRoom(hits[0].object.userData.roomId);
        else if (p.roomId && !hits.some((h) => h.object.userData.roomId === p.roomId)) p.onSelect(null);
      }
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerup', onUp);

    return () => {
      cancelAnimationFrame(s.raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerup', onUp);
      s.physics?.dispose();
      controls.dispose();
      renderer.dispose();
      el.innerHTML = '';
      st.current = null;
    };
  }, []);

  // ------------------------------------------------------------ build the house
  const { plan, level, items, roomId, selected, dark, links } = props;
  useEffect(() => {
    const s = st.current;
    if (!s) return;
    for (const c of [...s.world.children]) {
      s.world.remove(c);
      c.traverse((o) => {
        if (o instanceof CSS2DObject) o.element.remove();
        if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose();
      });
    }
    s.meshes.clear();
    s.floors = [];
    const rooms = plan.rooms.filter((r) => r.level === level);
    const focus = roomId ? rooms.find((r) => r.id === roomId) ?? null : null;
    const wallMat = mat(dark ? '#4a4d55' : '#f4f2ee', 0.9);
    const wallFade = mat(dark ? '#4a4d55' : '#f4f2ee', 0.9, 0, 0.18);
    const winMat = mat('#9fd0ff', 0.1, 0.1, 0.55);
    // ground
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(plan.w + 30, plan.d + 30), mat(dark ? '#16181c' : '#e8ece6', 1));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(plan.w / 2 + 3, -0.02, plan.d / 2);
    ground.receiveShadow = true;
    s.world.add(ground);

    for (const r of rooms) {
      const active = !focus || focus.id === r.id;
      const fl = new THREE.Mesh(new THREE.BoxGeometry(r.w - 0.02, 0.06, r.d - 0.02), mat(FLOOR[r.type][dark ? 1 : 0], 0.85, 0, active ? 1 : 0.35));
      fl.position.set(r.x + r.w / 2, -0.03, r.z + r.d / 2);
      fl.receiveShadow = true;
      fl.userData.roomId = r.id;
      s.world.add(fl);
      s.floors.push(fl);
      // walls with a door gap and windows on exterior sides
      const wh = focus ? WALL_H_ROOM : WALL_H_HOUSE;
      const wm = active ? wallMat : wallFade;
      const seg = (x0: number, z0: number, x1: number, z1: number) => {
        const len = Math.hypot(x1 - x0, z1 - z0);
        if (len < 0.05) return;
        const m = new THREE.Mesh(new THREE.BoxGeometry(x0 === x1 ? T : len, wh, x0 === x1 ? len : T), wm);
        m.position.set((x0 + x1) / 2, wh / 2, (z0 + z1) / 2);
        m.castShadow = active;
        m.receiveShadow = true;
        s.world.add(m);
      };
      const sides: { k: 'n' | 's' | 'w' | 'e'; a: [number, number]; b: [number, number] }[] = [
        { k: 'n', a: [r.x, r.z], b: [r.x + r.w, r.z] },
        { k: 's', a: [r.x, r.z + r.d], b: [r.x + r.w, r.z + r.d] },
        { k: 'w', a: [r.x, r.z], b: [r.x, r.z + r.d] },
        { k: 'e', a: [r.x + r.w, r.z], b: [r.x + r.w, r.z + r.d] },
      ];
      for (const sd of sides) {
        const [ax, az] = sd.a;
        const [bx, bz] = sd.b;
        if (r.door.wall === sd.k && r.type !== 'hall') {
          const len = Math.hypot(bx - ax, bz - az);
          const c = r.door.at * len;
          const g0 = Math.max(0, c - 0.45) / len;
          const g1 = Math.min(len, c + 0.45) / len;
          seg(ax, az, ax + (bx - ax) * g0, az + (bz - az) * g0);
          seg(ax + (bx - ax) * g1, az + (bz - az) * g1, bx, bz);
        } else if (r.type !== 'hall') seg(ax, az, bx, bz);
        if (r.windows.includes(sd.k) && active) {
          const len = Math.hypot(bx - ax, bz - az);
          const wl = Math.min(1.6, len * 0.5);
          const win = new THREE.Mesh(new THREE.BoxGeometry(ax === bx ? T + 0.02 : wl, 0.5, ax === bx ? wl : T + 0.02), winMat);
          win.position.set((ax + bx) / 2, wh - 0.3, (az + bz) / 2);
          s.world.add(win);
        }
      }
      // label
      if (!focus) {
        const div = document.createElement('div');
        div.className = 'room-label';
        div.textContent = r.name;
        const lab = new CSS2DObject(div);
        lab.position.set(r.x + r.w / 2, 1.3, r.z + r.d / 2);
        s.world.add(lab);
      }
      // furniture
      if (!active) continue;
      for (const it of items[r.id] ?? []) {
        const t = thing(it.key);
        if (!t) continue;
        const g = buildModel(t);
        g.position.set(r.x + it.x, 0, r.z + it.z);
        g.rotation.y = (-it.rot * Math.PI) / 180;
        g.userData.uid = it.uid;
        if (it.uid === selected) {
          const { w, d } = dims(t, 0);
          const ring = new THREE.Mesh(new THREE.BoxGeometry(w + 0.08, 0.02, d + 0.08), mat('#ff6a2b', 0.4, 0, 0.5));
          ring.position.y = 0.012;
          g.add(ring);
          // safety clearance outline
          if (t.clear.front + t.clear.back + t.clear.side > 0) {
            const cw = w + 2 * t.clear.side;
            const cd = d + t.clear.front + t.clear.back;
            const zone = new THREE.Mesh(new THREE.BoxGeometry(cw, 0.01, cd), mat('#3ddc84', 1, 0, 0.18));
            zone.position.set(0, 0.008, (t.clear.front - t.clear.back) / 2);
            g.add(zone);
          }
        }
        s.world.add(g);
        s.meshes.set(it.uid, { g, room: r });
      }
      // WiFi sensing lines
      if (focus && focus.id === r.id && links?.length) {
        const lm = new THREE.LineBasicMaterial({ color: '#5b9dff', transparent: true, opacity: 0.85 });
        for (const [a, b] of links) {
          const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(r.x + a[0], 1.1, r.z + a[1]), new THREE.Vector3(r.x + b[0], 1.1, r.z + b[1])]);
          s.world.add(new THREE.Line(geo, lm));
          for (const p of [a, b]) {
            const n = new THREE.Mesh(new THREE.OctahedronGeometry(0.09), mat('#5b9dff', 0.3));
            n.position.set(r.x + p[0], 1.1, r.z + p[1]);
            s.world.add(n);
          }
        }
      }
    }

    // physics world for the focused room
    if (focus) {
      const list = items[focus.id] ?? [];
      const bodies = list
        .map((it) => ({ it, t: thing(it.key) }))
        .filter((x) => x.t && x.t.h > 0.05)
        .map(({ it, t }) => {
          const { w, d } = dims(t!, it.rot);
          return { uid: it.uid, x: it.x, z: it.z, w, d, h: t!.h, mass: t!.mass };
        });
      if (s.physicsRoom !== focus.id) {
        s.physics?.dispose();
        s.physics = null;
        s.physicsRoom = focus.id;
        const want = focus.id;
        void loadJolt()
          .then((J) => {
            if (!st.current || st.current.physicsRoom !== want) return;
            st.current.physics = new FurniturePhysics(J, { w: focus.w, l: focus.d });
            st.current.physics.set(bodies);
          })
          .catch(() => undefined); // no WASM: dragging still works, just without shoving
      } else s.physics?.set(bodies);
    } else if (s.physics) {
      s.physics.dispose();
      s.physics = null;
      s.physicsRoom = null;
    }
  }, [plan, level, items, roomId, selected, dark, links]);

  // ------------------------------------------------------------ camera
  useEffect(() => {
    const s = st.current;
    if (!s) return;
    const r = roomId ? plan.rooms.find((x) => x.id === roomId) : null;
    const cx = r ? r.x + r.w / 2 : plan.w / 2 + (plan.rooms.some((x) => x.type === 'garage') ? 3 : 0);
    const cz = r ? r.z + r.d / 2 : plan.d / 2;
    const span = r ? Math.max(r.w, r.d) : Math.max(plan.w + 6, plan.d);
    const dist = r ? span * 1.25 + 2 : span * 0.95 + 4;
    const to: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(cx, dist * 0.95, cz + dist * 0.75), new THREE.Vector3(cx, 0, cz)];
    s.tween = { from: [s.camera.position.clone(), s.controls.target.clone()], to, t0: performance.now() };
  }, [roomId, plan, level]);

  return <div className="scene3d" ref={host} />;
});
