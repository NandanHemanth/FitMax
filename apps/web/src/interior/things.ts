/**
 * Everything you can place in a room: furniture, decor and gym equipment.
 * Each item carries the physical facts the recommender reasons with:
 *   - footprint, height, mass, and the clear space it needs in use (front / back / sides)
 *   - ergonomics for seats and beds (seat height & depth, firmness, fabric, lumbar support)
 *   - how it interacts with WiFi (rf): metal reflects, water absorbs, wood/fabric barely matter
 *   - a modern-style score, used by the "Modern" recommendation
 * Sources are summarised in docs and in `ERGO_NOTES`.
 */
import { CATALOG as GYM, type Role } from '../space/catalog';
import type { RoomType } from './floorplan';

export type Rf = 'metal' | 'water' | 'wood' | 'fabric' | 'glass' | 'electronics' | 'stone';
export type Model =
  | 'sofa' | 'sectional' | 'armchair' | 'bed' | 'nightstand' | 'desk' | 'chair' | 'table' | 'coffee' | 'tv' | 'plant' | 'lamp' | 'wardrobe' | 'rug' | 'shelf'
  | 'aquarium' | 'fridge' | 'counter' | 'island' | 'tub' | 'vanity' | 'washer' | 'car' | 'walkpad' | 'floor'
  | 'rack' | 'bench' | 'box' | 'treadmill' | 'bike' | 'rower' | 'platform' | 'mat' | 'mirror' | 'cable' | 'bar';

export interface Ergo {
  seatH?: number; // m
  seatD?: number; // m
  firmness?: 'soft' | 'medium' | 'medium-firm' | 'firm';
  fabric?: string;
  lumbar?: boolean;
  backScore: number; // 0..1, how back-friendly
  why: string;
}

export interface Thing {
  key: string;
  name: string;
  cat: 'furniture' | 'gym' | 'decor';
  model: Model;
  w: number;
  d: number;
  h: number;
  clear: { front: number; back: number; side: number };
  wall?: boolean;
  rf: Rf;
  mass: number; // kg
  price: number;
  color: string;
  rooms: RoomType[];
  modern: number; // 0..1
  ergo?: Ergo;
  roles?: Role[];
  minCeiling?: number;
  avoidFor?: string[];
  note?: string;
}

const ALL: RoomType[] = ['living', 'family', 'bed', 'primary', 'office', 'gym', 'garage', 'dining', 'kitchen'];

export const FURNITURE: Thing[] = [
  // ---- seating: the back-pain-relevant pieces
  { key: 'sofa_ergo', name: 'Sofa, supportive (3-seat)', cat: 'furniture', model: 'sofa', w: 2.1, d: 0.9, h: 0.85, clear: { front: 0.45, back: 0, side: 0.1 }, wall: true, rf: 'fabric', mass: 55, price: 1400, color: '#5b6b7a', rooms: ['living', 'family'], modern: 0.85,
    ergo: { seatH: 0.46, seatD: 0.53, firmness: 'medium-firm', fabric: 'tight-weave performance fabric', lumbar: true, backScore: 0.9, why: '46 cm seat keeps hips level with knees; 53 cm depth lets your back reach the backrest with feet flat; high-resilience foam (≈35 kg/m³) doesn’t bottom out, so the pelvis doesn’t tilt back.' } },
  { key: 'sofa_cloud', name: 'Sofa, deep “cloud” sectional', cat: 'furniture', model: 'sectional', w: 2.8, d: 1.7, h: 0.75, clear: { front: 0.45, back: 0, side: 0.1 }, wall: true, rf: 'fabric', mass: 90, price: 2600, color: '#c9c2b6', rooms: ['living', 'family'], modern: 0.75,
    ergo: { seatH: 0.4, seatD: 0.66, firmness: 'soft', fabric: 'bouclé over down', lumbar: false, backScore: 0.3, why: '66 cm deep, soft down: you slump into posterior pelvic tilt unless you stack pillows. Comfortable to lounge, poor for long sitting with back pain.' } },
  { key: 'armchair', name: 'Armchair with lumbar', cat: 'furniture', model: 'armchair', w: 0.8, d: 0.85, h: 0.95, clear: { front: 0.45, back: 0, side: 0.1 }, rf: 'fabric', mass: 22, price: 550, color: '#8a6f5a', rooms: ['living', 'family', 'primary', 'office'], modern: 0.8,
    ergo: { seatH: 0.45, seatD: 0.5, firmness: 'medium-firm', fabric: 'wool blend', lumbar: true, backScore: 0.85, why: 'Upright back, arms at elbow height to push up from (helps knees and backs).' } },
  { key: 'chair_task', name: 'Ergonomic desk chair', cat: 'furniture', model: 'chair', w: 0.65, d: 0.65, h: 1.15, clear: { front: 0.3, back: 0.6, side: 0.1 }, rf: 'metal', mass: 18, price: 450, color: '#2a2d33', rooms: ['office', 'bed', 'primary'], modern: 0.8,
    ergo: { seatH: 0.48, seatD: 0.46, firmness: 'medium-firm', fabric: 'breathable mesh', lumbar: true, backScore: 0.9, why: 'Adjustable lumbar and seat height; mesh breathes in long sessions.' } },
  { key: 'dining_chair', name: 'Dining chair', cat: 'furniture', model: 'chair', w: 0.48, d: 0.52, h: 0.85, clear: { front: 0.2, back: 0.6, side: 0.05 }, rf: 'wood', mass: 6, price: 120, color: '#a07850', rooms: ['dining', 'kitchen'], modern: 0.7 },
  // ---- sleep
  { key: 'bed_queen', name: 'Queen bed, medium-firm mattress', cat: 'furniture', model: 'bed', w: 1.6, d: 2.1, h: 0.6, clear: { front: 0.6, back: 0, side: 0.6 }, wall: true, rf: 'fabric', mass: 70, price: 1500, color: '#e7e1d6', rooms: ['bed', 'primary'], modern: 0.8,
    ergo: { firmness: 'medium-firm', fabric: 'breathable cotton/latex', backScore: 0.9, why: 'Medium-firm beat firm for chronic low-back pain in a 313-person double-blind trial (Kovacs et al., Lancet 2003).' } },
  { key: 'bed_full', name: 'Full bed', cat: 'furniture', model: 'bed', w: 1.4, d: 2.0, h: 0.55, clear: { front: 0.6, back: 0, side: 0.5 }, wall: true, rf: 'fabric', mass: 55, price: 900, color: '#e3dccf', rooms: ['bed'], modern: 0.7,
    ergo: { firmness: 'medium-firm', backScore: 0.85, why: 'Medium-firm mattress.' } },
  { key: 'nightstand', name: 'Nightstand', cat: 'furniture', model: 'nightstand', w: 0.5, d: 0.4, h: 0.55, clear: { front: 0.3, back: 0, side: 0 }, wall: true, rf: 'wood', mass: 10, price: 150, color: '#b08a62', rooms: ['bed', 'primary'], modern: 0.7 },
  { key: 'wardrobe', name: 'Wardrobe', cat: 'furniture', model: 'wardrobe', w: 1.2, d: 0.6, h: 2.0, clear: { front: 0.8, back: 0, side: 0 }, wall: true, rf: 'wood', mass: 80, price: 600, color: '#d8d2c8', rooms: ['bed', 'primary'], modern: 0.6 },
  // ---- work
  { key: 'desk_stand', name: 'Sit-stand desk', cat: 'furniture', model: 'desk', w: 1.4, d: 0.7, h: 0.74, clear: { front: 0.9, back: 0, side: 0.1 }, wall: true, rf: 'metal', mass: 35, price: 550, color: '#d9d4cc', rooms: ['office', 'bed', 'primary', 'family'], modern: 0.9,
    ergo: { backScore: 0.85, why: 'Switching sitting/standing through the day cuts sitting time; top 72–76 cm when seated, screen at eye level.' } },
  { key: 'walkpad', name: 'Under-desk walking pad', cat: 'gym', model: 'walkpad', w: 0.6, d: 1.35, h: 0.15, clear: { front: 0.2, back: 0.5, side: 0.3 }, rf: 'metal', mass: 22, price: 350, color: '#30343b', rooms: ['office', 'bed', 'living'], modern: 0.75, roles: ['cardio'], note: '2–3 km/h while working adds steps without a workout.' },
  { key: 'shelf', name: 'Bookshelf', cat: 'furniture', model: 'shelf', w: 1.0, d: 0.35, h: 1.8, clear: { front: 0.6, back: 0, side: 0 }, wall: true, rf: 'wood', mass: 40, price: 250, color: '#c4a77d', rooms: ['living', 'family', 'office', 'bed'], modern: 0.65 },
  // ---- living & dining
  { key: 'coffee', name: 'Coffee table', cat: 'furniture', model: 'coffee', w: 1.1, d: 0.6, h: 0.42, clear: { front: 0.4, back: 0.4, side: 0.3 }, rf: 'wood', mass: 18, price: 300, color: '#9b7a57', rooms: ['living', 'family'], modern: 0.75 },
  { key: 'tv', name: 'TV + low console', cat: 'furniture', model: 'tv', w: 1.8, d: 0.45, h: 1.25, clear: { front: 1.8, back: 0, side: 0.1 }, wall: true, rf: 'electronics', mass: 35, price: 900, color: '#16181d', rooms: ['living', 'family', 'gym'], modern: 0.8 },
  { key: 'dining', name: 'Dining table (4)', cat: 'furniture', model: 'table', w: 1.6, d: 0.9, h: 0.75, clear: { front: 0.75, back: 0.75, side: 0.6 }, rf: 'wood', mass: 40, price: 700, color: '#a07850', rooms: ['dining', 'kitchen'], modern: 0.75 },
  { key: 'rug', name: 'Low-pile wool rug', cat: 'decor', model: 'rug', w: 2.4, d: 1.7, h: 0.01, clear: { front: 0, back: 0, side: 0 }, rf: 'fabric', mass: 8, price: 350, color: '#d6c7b0', rooms: ['living', 'family', 'bed', 'primary', 'dining', 'office'], modern: 0.85, note: 'Low pile is a trip-free surface; anchors a seating group.' },
  { key: 'plant', name: 'Tall plant', cat: 'decor', model: 'plant', w: 0.5, d: 0.5, h: 1.6, clear: { front: 0, back: 0, side: 0 }, rf: 'water', mass: 15, price: 90, color: '#3f7d4e', rooms: ALL, modern: 0.9, note: 'Mostly water: absorbs WiFi a little, like a person standing still.' },
  { key: 'lamp', name: 'Floor lamp (warm, dimmable)', cat: 'decor', model: 'lamp', w: 0.4, d: 0.4, h: 1.6, clear: { front: 0, back: 0, side: 0 }, rf: 'metal', mass: 6, price: 160, color: '#e9e2d0', rooms: ALL, modern: 0.85 },
  { key: 'aquarium', name: 'Aquarium (120 L)', cat: 'decor', model: 'aquarium', w: 1.0, d: 0.4, h: 1.3, clear: { front: 0.6, back: 0, side: 0 }, wall: true, rf: 'water', mass: 160, price: 450, color: '#4aa3c7', rooms: ['living', 'family', 'office'], modern: 0.5, note: '120 L of water blocks most WiFi through it: keep it off the sensing triangle.' },
  // ---- kitchen, bath, laundry, garage (context pieces)
  { key: 'counter', name: 'Kitchen counter run', cat: 'furniture', model: 'counter', w: 2.4, d: 0.62, h: 0.92, clear: { front: 1.0, back: 0, side: 0 }, wall: true, rf: 'stone', mass: 200, price: 3000, color: '#e6e3dc', rooms: ['kitchen'], modern: 0.7 },
  { key: 'fridge', name: 'Refrigerator', cat: 'furniture', model: 'fridge', w: 0.9, d: 0.75, h: 1.8, clear: { front: 0.9, back: 0, side: 0.05 }, wall: true, rf: 'metal', mass: 120, price: 1800, color: '#c8ccd2', rooms: ['kitchen'], modern: 0.7, note: 'A big metal box: reflects WiFi strongly.' },
  { key: 'island', name: 'Kitchen island', cat: 'furniture', model: 'island', w: 1.8, d: 0.9, h: 0.92, clear: { front: 0.9, back: 0.9, side: 0.6 }, rf: 'stone', mass: 250, price: 2500, color: '#dcd6cc', rooms: ['kitchen'], modern: 0.85 },
  { key: 'tub', name: 'Bathtub', cat: 'furniture', model: 'tub', w: 1.6, d: 0.75, h: 0.55, clear: { front: 0.6, back: 0, side: 0 }, wall: true, rf: 'water', mass: 60, price: 900, color: '#f3f3f1', rooms: ['bath'], modern: 0.6 },
  { key: 'vanity', name: 'Vanity', cat: 'furniture', model: 'vanity', w: 1.0, d: 0.55, h: 0.85, clear: { front: 0.7, back: 0, side: 0 }, wall: true, rf: 'stone', mass: 50, price: 700, color: '#e9e5de', rooms: ['bath'], modern: 0.7 },
  { key: 'washer', name: 'Washer + dryer', cat: 'furniture', model: 'washer', w: 1.3, d: 0.7, h: 0.9, clear: { front: 0.9, back: 0, side: 0 }, wall: true, rf: 'metal', mass: 150, price: 1600, color: '#e8eaed', rooms: ['laundry'], modern: 0.6 },
  { key: 'car', name: 'Car', cat: 'furniture', model: 'car', w: 1.85, d: 4.6, h: 1.45, clear: { front: 0.5, back: 0.4, side: 0.7 }, rf: 'metal', mass: 1500, price: 0, color: '#6b7280', rooms: ['garage'], modern: 0.5 },
  { key: 'rubber', name: 'Rubber gym flooring (8 mm)', cat: 'gym', model: 'floor', w: 3.0, d: 3.0, h: 0.01, clear: { front: 0, back: 0, side: 0 }, rf: 'fabric', mass: 60, price: 300, color: '#25272b', rooms: ['gym', 'garage', 'bed', 'family'], modern: 0.7, note: 'Protects the floor and dampens dropped weights.' },
];

/** The gym catalog from the room builder, with the physics fields added. */
const GYM_RF: Record<string, Rf> = { mat: 'fabric', recovery: 'fabric', mirror: 'glass', platform: 'wood', plyo: 'wood' };
const GYM_MASS: Record<string, number> = { rack: 110, bench: 30, dumbbells: 45, platform: 120, cable: 180, treadmill: 100, bike: 45, rower: 40, pullup: 8, kettlebells: 60, mat: 2, recovery: 5, mirror: 25, plyo: 18 };
export const GYM_THINGS: Thing[] = GYM.map((g) => ({
  key: g.key,
  name: g.name,
  cat: 'gym',
  model: g.shape as Model,
  w: g.w,
  d: g.d,
  h: g.h,
  clear: g.clear,
  wall: g.wall,
  rf: GYM_RF[g.key] ?? 'metal',
  mass: GYM_MASS[g.key] ?? 30,
  price: g.price,
  color: g.color,
  rooms: ['gym', 'garage', 'bed', 'family', 'living', 'office'],
  modern: g.key === 'mirror' || g.key === 'mat' ? 0.8 : 0.6,
  roles: g.roles,
  minCeiling: g.minCeiling,
  avoidFor: g.avoidFor,
}));

export const THINGS: Thing[] = [...FURNITURE, ...GYM_THINGS];
export const thing = (key: string) => THINGS.find((t) => t.key === key);

/** What the research says, in one place (shown in the app's "Why" panel). */
export const ERGO_NOTES = [
  { title: 'Mattress: medium-firm', body: 'In a double-blind trial of 313 adults with chronic low-back pain, medium-firm mattresses beat firm ones for pain in bed, on rising and disability (Kovacs et al., Lancet 2003).' },
  { title: 'Sofa: geometry beats fabric', body: 'Seat height ~43–48 cm keeps hips level with knees; seat depth ~50–55 cm lets your back reach the backrest with feet flat. Deep, soft sofas tilt the pelvis back and flatten the lumbar curve. Add lumbar support 14–16 in. above the seat.' },
  { title: 'Fabric: what it changes', body: 'Fabric decides breathability, grip and cleaning, not spinal support. Tight-weave performance fabric or leather keeps cushions from sliding; wool and cotton breathe. Firm high-resilience foam (≥ 2 lb/ft³) under it is what holds posture.' },
  { title: 'Treadmill clearance', body: 'ASTM F2115: at least 2 m (78 in.) clear behind the belt and 0.5 m each side, so a fall off the back lands on floor, not a wall.' },
  { title: 'Free-weight stations', body: '~0.9 m in front of a rack or dumbbell stand and ~0.6 m to the sides; rack against a wall; rubber flooring under drops.' },
  { title: 'Make movement the default', body: 'Put the mat, kettlebells or walking pad where you can see them from the sofa or desk; visible cues raise use. Train facing a window or a mirror, not a wall.' },
  { title: 'Light', body: 'Bright daylight in the morning anchors your body clock: put the training spot and the desk near a window; keep bedrooms dim and warm at night.' },
  { title: 'WiFi sensing friendly', body: 'Metal (racks, fridges, mirrors with metal backing) reflects WiFi and water (aquariums, people) absorbs it; wood and fabric barely matter. Keep big metal and water off the lines between your sensing devices, and train inside the triangle.' },
];
