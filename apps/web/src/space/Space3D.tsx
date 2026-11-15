import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { ItemDef } from './catalog';
import type { Footprint, Ground } from './home';
import { bodyRect, clearRect, type Issue, type Placed, type Room } from './layout';

export type View = 'home' | 'room';

export interface Space3DHandle {
  snapshot: () => string | null;
}

interface Props {
  view: View;
  dark: boolean;
  footprint: Footprint | null;
  ground: Ground | null;
  room: Room;
  items: Placed[];
  defs: (k: string) => ItemDef | undefined;
  issues: Issue[];
  selected: string | null;
  onSelect: (uid: string | null) => void;
  onMove: (uid: string, x: number, z: number) => void;
  handleRef?: React.MutableRefObject<Space3DHandle | null>;
  /** A real scanned interior (e.g. HM3D .glb) placed with its floor corner at the room origin */
  scan?: THREE.Object3D | null;
}

const SNAP = 0.05;
const snap = (v: number) => Math.round(v / SNAP) * SNAP;

/** Where the room's (0,0) corner sits in world metres: centred on the footprint's centroid. */
export function roomOrigin(fp: Footprint | null, room: Room): [number, number] {
  if (!fp) return [-room.w / 2, -room.l / 2];
  const cx = fp.points.reduce((s, p) => s + p[0], 0) / fp.points.length;
  const cz = fp.points.reduce((s, p) => s + p[1], 0) / fp.points.length;
  return [cx - room.w / 2, cz - room.l / 2];
}

function mat(color: string, opts: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.15, ...opts });
}
function box(w: number, h: number, d: number, color: string, x = 0, y = 0, z = 0, m?: THREE.Material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m ?? mat(color));
  mesh.position.set(x, y + h / 2, z);
  mesh.castShadow = true;
  return mesh;
}
function cyl(r: number, len: number, color: string, axis: 'x' | 'y' | 'z', x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 20), mat(color, { metalness: 0.5 }));
  if (axis === 'x') mesh.rotation.z = Math.PI / 2;
  if (axis === 'z') mesh.rotation.x = Math.PI / 2;
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
}

/** A simple, recognisable model of each kind of equipment. Local frame: centred, floor at y=0, front = +z. */
function model(d: ItemDef): THREE.Group {
  const g = new THREE.Group();
  const { w, h } = d;
  const D = d.d;
  const c = d.color;
  switch (d.shape) {
    case 'rack': {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.07, h, 0.07, c, (sx * (w - 0.07)) / 2, 0, (sz * (D - 0.07)) / 2));
      for (const sz of [-1, 1]) g.add(box(w, 0.07, 0.07, c, 0, h - 0.07, (sz * (D - 0.07)) / 2));
      g.add(cyl(0.016, w + 0.3, '#c0c4cc', 'x', 0, 1.35, D / 2 - 0.05)); // bar on the hooks
      for (const sx of [-1, 1]) g.add(cyl(0.22, 0.05, '#18181b', 'x', sx * (w / 2 + 0.08), 1.35, D / 2 - 0.05));
      break;
    }
    case 'bench':
      g.add(box(w * 0.5, 0.06, D * 0.95, '#18181b', 0, 0.4, 0));
      g.add(box(0.06, 0.4, 0.06, '#71717a', 0, 0, -D * 0.35));
      g.add(box(0.06, 0.4, 0.06, '#71717a', 0, 0, D * 0.35));
      g.add(box(w, 0.05, 0.08, '#71717a', 0, 0, -D * 0.42));
      g.add(box(w, 0.05, 0.08, '#71717a', 0, 0, D * 0.42));
      break;
    case 'treadmill':
      g.add(box(w, 0.18, D, c, 0, 0, 0));
      g.add(box(w * 0.8, 0.02, D * 0.85, '#3f3f46', 0, 0.18, -0.05));
      for (const sx of [-1, 1]) g.add(box(0.05, h - 0.2, 0.05, '#52525b', (sx * (w - 0.08)) / 2, 0.18, D / 2 - 0.15));
      g.add(box(w, 0.25, 0.25, '#18181b', 0, h - 0.3, D / 2 - 0.15));
      break;
    case 'bike':
      g.add(box(0.08, 0.06, D * 0.9, '#3f3f46', 0, 0, 0));
      g.add(cyl(0.24, 0.06, c, 'x', 0, 0.3, D * 0.28));
      g.add(box(0.06, 0.75, 0.06, '#3f3f46', 0, 0, -D * 0.2));
      g.add(box(0.18, 0.06, 0.28, '#18181b', 0, 0.78, -D * 0.2));
      g.add(box(0.06, h - 0.1, 0.06, '#3f3f46', 0, 0, D * 0.35));
      g.add(box(0.5, 0.04, 0.12, '#18181b', 0, h - 0.1, D * 0.4));
      break;
    case 'rower':
      g.add(box(0.12, 0.12, D, '#d4d4d8', 0, 0.15, 0));
      g.add(box(w, 0.5, 0.45, c, 0, 0, D / 2 - 0.25));
      g.add(box(0.3, 0.06, 0.32, '#18181b', 0, 0.3, 0));
      g.add(box(w, 0.04, 0.1, '#52525b', 0, 0, -D / 2 + 0.05));
      break;
    case 'platform':
      g.add(box(w, 0.05, D, c, 0, 0, 0));
      g.add(box(w * 0.4, 0.051, D, '#2a2a2e', 0, 0, 0));
      g.add(cyl(0.014, 2.2, '#c0c4cc', 'x', 0, 0.27, 0));
      for (const sx of [-1, 1]) g.add(cyl(0.225, 0.08, '#18181b', 'x', sx * 0.85, 0.275, 0));
      break;
    case 'mat':
      g.add(box(w, Math.max(0.01, h), D, c, 0, 0, 0, mat(c, { roughness: 1 })));
      break;
    case 'mirror':
      g.add(box(w, h, 0.03, c, 0, 0.25, 0, mat(c, { metalness: 0.9, roughness: 0.05 })));
      break;
    case 'cable':
      for (const sx of [-1, 1]) g.add(box(0.18, h, 0.3, c, (sx * (w - 0.18)) / 2, 0, -D / 2 + 0.15));
      g.add(box(w, 0.1, 0.2, c, 0, h - 0.1, -D / 2 + 0.15));
      g.add(box(w * 0.7, 0.04, D, '#52525b', 0, 0, 0));
      for (const sx of [-1, 1]) g.add(box(0.14, 0.9, 0.12, '#71717a', (sx * (w - 0.18)) / 2, 0.1, -D / 2 + 0.38));
      break;
    case 'bar':
      for (const sx of [-1, 1]) g.add(box(0.05, 0.05, D, '#52525b', (sx * w) / 2.4, h - 0.05, 0));
      g.add(cyl(0.016, w, c, 'x', 0, h, D / 2 - 0.05));
      break;
    default: // 'box'
      g.add(box(w, h, D, c));
  }
  return g;
}

export function Space3D(p: Props) {
  const host = useRef<HTMLDivElement>(null);
  const three = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls; content: THREE.Group; scanGroup: THREE.Group; itemMeshes: Map<THREE.Object3D, string> } | null>(null);
  const props = useRef(p);
  props.current = p;

  // One-time scene setup
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.shadowMap.enabled = true;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI / 2.05;
    scene.add(new THREE.HemisphereLight('#ffffff', '#666670', 1.6));
    const sun = new THREE.DirectionalLight('#ffffff', 1.6);
    sun.position.set(20, 40, 15);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40 });
    scene.add(sun);
    const content = new THREE.Group();
    scene.add(content);
    const scanGroup = new THREE.Group(); // not disposed on rebuilds: the scan is owned by the screen
    scene.add(scanGroup);
    three.current = { renderer, scene, camera, controls, content, scanGroup, itemMeshes: new Map() };

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = el;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    // Drag equipment on the floor
    const ray = new THREE.Raycaster();
    const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const ndc = new THREE.Vector2();
    let drag: { uid: string; dx: number; dz: number } | null = null;
    const toNdc = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
    };
    const floorHit = () => ray.ray.intersectPlane(floor, new THREE.Vector3());
    const onDown = (e: PointerEvent) => {
      const t = three.current;
      if (!t) return;
      toNdc(e);
      const hits = ray.intersectObjects([...t.itemMeshes.keys()], true);
      let uid: string | undefined;
      for (const h of hits) {
        let o: THREE.Object3D | null = h.object;
        while (o && !t.itemMeshes.has(o)) o = o.parent;
        if (o) {
          uid = t.itemMeshes.get(o);
          break;
        }
      }
      if (!uid) {
        props.current.onSelect(null);
        return;
      }
      props.current.onSelect(uid);
      const it = props.current.items.find((i) => i.uid === uid);
      const hit = floorHit();
      if (!it || !hit) return;
      const [ox, oz] = roomOrigin(props.current.footprint, props.current.room);
      drag = { uid, dx: it.x - (hit.x - ox), dz: it.z - (hit.z - oz) };
      controls.enabled = false;
      renderer.domElement.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      toNdc(e);
      const hit = floorHit();
      if (!hit) return;
      const [ox, oz] = roomOrigin(props.current.footprint, props.current.room);
      props.current.onMove(drag.uid, snap(hit.x - ox + drag.dx), snap(hit.z - oz + drag.dz));
    };
    const onUp = () => {
      drag = null;
      controls.enabled = true;
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointercancel', onUp);

    let raf = 0;
    const loop = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();
    if (p.handleRef) p.handleRef.current = { snapshot: () => (renderer.render(scene, camera), renderer.domElement.toDataURL('image/png')) };

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
      three.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Camera framing per view
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    const [ox, oz] = roomOrigin(p.footprint, p.room);
    const cx = ox + p.room.w / 2;
    const cz = oz + p.room.l / 2;
    if (p.view === 'home') {
      const span = Math.max(30, p.ground?.sizeM ?? 60) * 0.55;
      t.camera.position.set(cx + span * 0.6, span * 0.9, cz + span);
      t.controls.target.set(cx, 0, cz);
    } else {
      const span = Math.max(p.room.w, p.room.l);
      t.camera.position.set(cx + span * 0.9, span * 1.35, cz + span * 1.55);
      t.controls.target.set(cx, 0.6, cz);
    }
    t.controls.update();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.view, p.footprint, p.room.w, p.room.l]);

  // The scanned interior sits at the room origin
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    t.scanGroup.clear();
    if (p.scan) {
      const [ox, oz] = roomOrigin(p.footprint, p.room);
      t.scanGroup.position.set(ox, 0, oz);
      t.scanGroup.add(p.scan);
    }
  }, [p.scan, p.footprint, p.room]);

  // Rebuild content on change
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    const { content, itemMeshes } = t;
    content.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mm = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mm)) mm.forEach((x) => x.dispose());
      else mm?.dispose?.();
    });
    content.clear();
    itemMeshes.clear();

    const homeView = p.view === 'home';
    const [ox, oz] = roomOrigin(p.footprint, p.room);

    // Ground: aerial / map image, else plain
    const gSize = p.ground?.sizeM ?? 60;
    const groundMat = new THREE.MeshStandardMaterial({ color: p.ground ? '#ffffff' : p.dark ? '#1c2230' : '#e5e7eb', roughness: 1 });
    if (p.ground) {
      const tex = new THREE.TextureLoader().load(p.ground.url);
      tex.colorSpace = THREE.SRGBColorSpace;
      groundMat.map = tex;
    }
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(gSize, gSize), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    content.add(ground);

    // House shell from the real footprint (x-ray in home view, faint outline in room view)
    if (p.footprint && !(p.scan && !homeView)) {
      const shape = new THREE.Shape(p.footprint.points.map(([x, z]) => new THREE.Vector2(x, -z)));
      const geo = new THREE.ExtrudeGeometry(shape, { depth: p.footprint.height, bevelEnabled: false });
      geo.rotateX(-Math.PI / 2);
      const shell = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#f8fafc', transparent: true, opacity: homeView ? 0.35 : 0.06, depthWrite: false }));
      content.add(shell);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: '#ff6b2c', transparent: true, opacity: homeView ? 0.9 : 0.25 }));
      content.add(edges);
    }

    // The gym room
    const room = new THREE.Group();
    room.position.set(ox, 0, oz);
    content.add(room);
    const floorMat = new THREE.MeshStandardMaterial({ color: p.dark ? '#2a303c' : '#d6d3cd', roughness: 0.9 });
    const hasScan = Boolean(p.scan);
    if (hasScan) floorMat.visible = false;
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(p.room.w, p.room.l), floorMat);
    fl.rotation.x = -Math.PI / 2;
    fl.position.set(p.room.w / 2, 0.005, p.room.l / 2);
    fl.receiveShadow = true;
    room.add(fl);
    const grid = new THREE.GridHelper(Math.max(p.room.w, p.room.l), Math.round(Math.max(p.room.w, p.room.l) * 2), '#8b93a3', '#8b93a3');
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.18;
    grid.position.set(Math.max(p.room.w, p.room.l) / 2, 0.01, Math.max(p.room.w, p.room.l) / 2);
    room.add(grid);
    // Cut-away walls: back two walls full height, front two low so you can see in
    const wallMat = new THREE.MeshStandardMaterial({ color: p.dark ? '#3a4150' : '#f1efe9', transparent: true, opacity: homeView ? 0.5 : 0.85, visible: !hasScan });
    const wallH = p.room.h;
    room.add(box(p.room.w, wallH, 0.08, '', p.room.w / 2, 0, -0.04, wallMat));
    room.add(box(0.08, wallH, p.room.l, '', -0.04, 0, p.room.l / 2, wallMat));
    room.add(box(p.room.w, 0.25, 0.08, '', p.room.w / 2, 0, p.room.l + 0.04, wallMat));
    room.add(box(0.08, 0.25, p.room.l, '', p.room.w + 0.04, 0, p.room.l / 2, wallMat));
    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(p.room.w, p.room.h, p.room.l)),
      new THREE.LineBasicMaterial({ color: '#ff6b2c' }),
    );
    outline.position.set(p.room.w / 2, p.room.h / 2, p.room.l / 2);
    room.add(outline);

    // Equipment + safety zones
    const worst = new Map<string, Issue['severity']>();
    for (const i of p.issues) {
      const cur = worst.get(i.uid);
      if (i.severity === 'error' || (i.severity === 'warn' && cur !== 'error') || !cur) worst.set(i.uid, i.severity);
    }
    for (const it of p.items) {
      const d = p.defs(it.key);
      if (!d) continue;
      const sev = worst.get(it.uid);
      const zoneColor = sev === 'error' ? '#ef4444' : sev === 'warn' ? '#f5b524' : '#22c55e';
      const c = clearRect(it, d);
      const zone = new THREE.Mesh(
        new THREE.PlaneGeometry(c.x1 - c.x0, c.z1 - c.z0),
        new THREE.MeshBasicMaterial({ color: zoneColor, transparent: true, opacity: it.uid === p.selected ? 0.32 : 0.16, depthWrite: false }),
      );
      zone.rotation.x = -Math.PI / 2;
      zone.position.set((c.x0 + c.x1) / 2, 0.015, (c.z0 + c.z1) / 2);
      room.add(zone);
      const b = bodyRect(it, d);
      const foot = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.PlaneGeometry(b.x1 - b.x0, b.z1 - b.z0)),
        new THREE.LineBasicMaterial({ color: it.uid === p.selected ? '#ff6b2c' : zoneColor }),
      );
      foot.rotation.x = -Math.PI / 2;
      foot.position.set((b.x0 + b.x1) / 2, 0.02, (b.z0 + b.z1) / 2);
      room.add(foot);

      const m = model(d);
      m.position.set(it.x, 0, it.z);
      m.rotation.y = (-it.rot * Math.PI) / 180;
      if (it.uid === p.selected)
        m.traverse((o) => {
          const mm = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
          if (mm?.emissive) {
            mm.emissive.set('#ff6b2c');
            mm.emissiveIntensity = 0.35;
          }
        });
      room.add(m);
      itemMeshes.set(m, it.uid);
    }
  }, [p.view, p.dark, p.footprint, p.ground, p.room, p.items, p.issues, p.selected, p.defs, p.scan]);

  return <div ref={host} className="space3d" />;
}
