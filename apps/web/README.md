# FitMax web app

A web app you can install on your phone (PWA) with five sections:

- **Sign-in and onboarding.** "Continue with Google / Apple" and the fitness-data permissions screen are demo stubs (no account is created). Onboarding collects sex, age, height, weight, target weight, goal, training experience in half-year steps, intensity, days per week, injuries and dietary restrictions.
- **Dashboard.** Goal milestones, today's stats, what your progress counts for (each line tied to a study), the form-score trend, quick reads and videos. Steps, heart rate and sleep are simulated and labelled "demo data".
- **Train.** The bicep-curl coach: rep counting, form flags, a 0 to 100 form score and voice cues. Pose tracking runs on the phone with MediaPipe Pose Landmarker, so camera frames are never uploaded.
- **Nutrition.** Daily targets from the profile, barcode scanning (Open Food Facts) with diet-conflict checks, food search, meal-photo and fridge-photo AI, recipes for your goal and a goal-based shopping list.
- **Places (CoStar track).** A live map of homes, each with a FitMax Score. Hovering a home highlights the gyms, groceries, parks, courts, bike lanes and run trails within 1.2 km.

## Run it

```bash
cd apps/web
npm install        # also copies the MediaPipe wasm and downloads the pose model into public/
npm run dev        # http://localhost:5173 (camera works on localhost)
npm test           # curl engine unit tests
npm run build      # production build in dist/
```

## AI features (meal photo, fridge to recipes, shopping list)

Copy `.env.example` to `.env` and set `NVIDIA_API_KEY` (free from build.nvidia.com). The key stays on the server: `/api/ai` runs as Vite middleware locally and as a Vercel function (`api/ai.mjs`) in production, so set the same variable in the Vercel project. Without a key, recipes and the shopping list fall back to the built-in recipe library, and the photo features say what's missing.

## Places data

`public/data/places/*.json` are OpenStreetMap snapshots for the demo areas, so the map loads instantly during judging. Refresh them with `npm run places` (or `npm run places -- la princeton`). Any other area you search loads live from Overpass. The score lives in `src/places/score.ts` (tested in `score.test.ts`):

| Category | Inputs | Weight for hypertrophy |
| --- | --- | --- |
| Gyms & studios | nearest gym + number within 1 km | 38% |
| Healthy groceries | nearest grocery + choice within 1.5 km | 25% |
| Parks & outdoor | nearest park + courts, tracks, pools within 1.2 km | 14% |
| Run & ride routes | km of bike lanes and named trails within 1 km | 10% |
| Physio & recovery | nearest physiotherapist | 13% (left out where the area has no data) |

Weights change with the goal. Joint injuries shift cardio toward cycling, and any injury adds weight to physio. CoStar listings and amenities, Matterport interiors and Vexcel detections plug in through `src/places/data.ts`.

## Home monitor (RuView on the Arduino UNO Q)

The **Monitor** tab is a read-only view of a [RuView](https://github.com/ruvnet/RuView) WiFi-sensing hub running on the UNO Q. It shows:

- presence and movement;
- active minutes at home and a 3-hour timeline;
- resting breathing and heart rate (only when RuView is confident);
- alerts for a possible fall, long stillness while someone is home, vitals out of range, and the hub going offline.

Setup is in [`hub/uno-q/README.md`](../../hub/uno-q/README.md): run `./setup.sh` on the board, then put the two lines it prints into `.env`:

```
RUVIEW_URL=http://<uno-q-ip>:3000
RUVIEW_API_TOKEN=...
```

The dev/preview server proxies a fixed allowlist of GET endpoints (`/api/ruview/*`), so the token stays on the laptop. With no ESP32 sensors, the hub runs in simulated mode and FitMax labels every reading as simulated. Alert logic and its tests are in `src/monitor/`.

**Live demo (no hardware needed):** the Monitor tab's *Live demo* toggle plays a scripted day at home at 1 second = 1 minute: sleep, bed exit, a home workout with squat reps, sofa time, a fall, then recovery. It runs through the same alert engine as the real hub and shows a live room heatmap, motion and breathing waveforms, heart-rate zone and recovery, and a grid of everything FitMax can track. *My hub* switches to the UNO Q.

## Put it on iPhones (HTTPS + QR)

iOS Safari only allows camera access over HTTPS. Use either option:

```bash
# Option A: permanent URL (Vercel, free)
npm run build && npx vercel deploy --prod      # set the project root to apps/web

# Option B: quick tunnel from your laptop
npm run build && npm run preview               # serves on :4173
npx cloudflared tunnel --url http://localhost:4173
```

Then make the QR code: `npm run qr -- https://your-url` writes `fitmax-qr.png`. Testers scan it with the iPhone camera, then use Share → Add to Home Screen to run it full screen.

## How it works

| File | What it does |
| --- | --- |
| `src/engine/curl.ts` | Rep state machine and per-rep metrics: ROM, up/down tempo, elbow drift, body swing, fatigue. Also form flags, a 0 to 100 form score, and at most one cue per rep. |
| `src/engine/ideal.ts` | The ideal rep (165° to 40°, about 2 s up, 2.5 s down), used for the demo and the live "ghost" arm |
| `src/ui/LiveSet.tsx` | Camera, MediaPipe loop, auto arm detection, voice cues, HUD |
| `src/ui/draw.ts` | Skeleton overlay: the tracked arm is green when form is clean and amber when there is something to fix; the ghost arm is dashed blue |
| `src/ui/DemoFigure.tsx` | Animated ideal curl shown before the set |
| `src/store.ts` | Sets and settings in localStorage; each saved set is the profile record the agents will read later |

Thresholds live in `CURL_CONFIG` (`src/engine/curl.ts`). They are starting defaults: tune them on your own recordings.

| Flag | Rule | Penalty | Cue |
| --- | --- | --- | --- |
| Body swing | trunk lean changes more than 10° during the lift | 25 | "No swinging. Lighten the weight." |
| Elbow drift | upper arm moves forward more than 20° vs the torso | 25 | "Pin your elbow to your side." |
| Short at the top | elbow never closes past 60° | 20 | "Squeeze all the way to the top." |
| Short at the bottom | arm opens to less than 155° before the lift | 10 | "Straighten your arm at the bottom." |
| Fast lowering | lowering takes under 1.0 s | 10 | "Slow the lowering." |
| Slowing down | lift is 30% slower than reps 1 and 2 (from rep 4) | 0 | "Two more, then rack it." (said once) |

A rep counts when the elbow goes from more than 140° to less than 90° and back to more than 140°. That gap between the thresholds (hysteresis) stops jitter from counting a rep twice.

## Camera setup

Stand side-on with your working arm toward the camera. Prop the phone at hip height about 2 m away, so your shoulder, elbow, wrist and hip stay in frame.
