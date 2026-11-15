# FitMax home hub — RuView on the Arduino UNO Q

The UNO Q runs [RuView](https://github.com/ruvnet/RuView), a WiFi-sensing server, so FitMax can watch the home without cameras. It covers presence, movement, active minutes, possible falls, long stillness, and resting breathing and heart rate. Everything stays on your network. The FitMax web app only **views** the data (Monitor tab).

```
 ESP32-S3 nodes (~$9 each)  ──UDP 5005──▶  UNO Q hub: RuView  ──REST──▶  laptop: FitMax (npm run dev) ──▶ phone / browser
                                               └─MQTT──▶ Home Assistant ──▶ Google Home · Apple Home · Alexa
```

**Why ESP32 nodes?** Full WiFi sensing needs raw *channel state information* (CSI) from the radio. The UNO Q's Qualcomm WiFi chip (ath10k driver) doesn't expose CSI, so with CSI the UNO Q acts as the **hub** while ESP32-S3 boards are the **sensors**.

## No extra hardware? Use RSSI mode

With only a laptop and the UNO Q, run:

```bash
./setup.sh rssi
```

This installs `rssi_sense.py` as a service. It samples the board's own WiFi signal strength and ping latency 10 times a second, and serves the same API as RuView, so FitMax's Monitor works unchanged. The badge reads **Live · rssi**.

| Works in RSSI mode | Needs CSI hardware (ESP32-S3 or an Intel AX200/AX210 card) |
| --- | --- |
| Presence, motion level, active minutes | Breathing, heart rate |
| Repetitive exercise: cadence and rep count (±1–2 reps) | Fall detection |
| Inactivity alerts | Position, heatmap, people count |

How to get good readings:

1. Put the UNO Q and the router 2–6 m apart and exercise **between** them; movement across that line swings the signal most.
2. Leave the room for 15 s, then calibrate the empty-room baseline (the command is printed by setup). This helps it notice someone sitting still.
3. Test it: `curl -H "Authorization: Bearer <token>" http://<uno-q-ip>:3000/api/v1/sensing/latest`
4. To try it without the board: `python3 rssi_sense.py --token test --source synthetic` on the laptop, then set `RUVIEW_URL=http://localhost:3000`.

It also runs on a Linux laptop (`python3 rssi_sense.py --token … --port 3000`), using the laptop's WiFi link instead.

The rest of this guide covers the CSI path with RuView. Until ESP32 boards stream to it, RuView runs in **simulated** mode and FitMax marks every reading and alert as simulated.

## 1. Get a shell on the UNO Q

Choose one of these:

- **USB (from the laptop it's plugged into):**
  ```bash
  sudo apt install android-sdk-platform-tools   # once
  adb shell
  ```
- **Arduino App Lab:** open the board and use its *Terminal*.
- **Over WiFi:** `ssh arduino@<board-name>.local`. The default password is `arduino`; change it with `passwd`.

The board must be on your WiFi: App Lab → board settings → Network. Check with `hostname -I`.

## 2. Copy this folder over and run it

From the laptop, in the FitMax repo:

```bash
# over WiFi
scp -r hub/uno-q arduino@<board-name>.local:~/fitmax-hub
# or over USB
adb push hub/uno-q /home/arduino/fitmax-hub
```

On the UNO Q:

```bash
cd ~/fitmax-hub
chmod +x setup.sh
./setup.sh              # simulated mode for now
```

The script installs Docker if it's missing and starts RuView (`ruvnet/wifi-densepose`, arm64), which restarts automatically on boot. It prints two lines:

```
RUVIEW_URL=http://192.168.1.42:3000
RUVIEW_API_TOKEN=…
```

## 3. Point FitMax at the hub

Paste the two printed lines into `apps/web/.env` on the laptop. Then restart:

```bash
npm run dev
```

Open **Monitor** in FitMax. The laptop's dev server holds the token and proxies a fixed, read-only set of RuView endpoints, so the token never reaches the browser or the phone.

## 4. Add real sensors (ESP32-S3)

1. Get an ESP32-S3 dev board. Use 2 or more per room for better presence and fall detection, placed on opposite sides of the room at about chest height.
2. Flash the RuView CSI firmware. It comes from the [RuView releases](https://github.com/ruvnet/RuView/releases) or `firmware/esp32-csi-node` in that repo:
   ```bash
   pip install esptool
   python -m esptool --chip esp32s3 --port <PORT> --baud 460800 write_flash \
     0x0 bootloader.bin 0x8000 partition-table.bin 0xf000 ota_data_initial.bin 0x20000 esp32-csi-node.bin
   python firmware/esp32-csi-node/provision.py --port <PORT> \
     --ssid "<your wifi>" --password "<wifi password>" --target-ip <UNO_Q_IP>
   ```
3. On the UNO Q, switch to real data:
   ```bash
   ./setup.sh esp32
   ```
   This accepts sensor packets only from your LAN subnet. FitMax's badge changes from **Simulated** to **Live · esp32**, and the nodes are listed with their signal strength.

**Calibration:** heart and breathing rate are published only after a fresh calibration with exactly one person in the room. Until then RuView *abstains* rather than guessing, and FitMax shows "Needs one-person calibration". Do the calibration from RuView's own dashboard at `http://<UNO_Q_IP>:3000/ui/index.html`.

## 5. Later: Google Home, Apple Home, Alexa

```bash
./setup.sh esp32 --home-assistant
```

This also starts a password-protected MQTT broker on the board. In Home Assistant, go to **Settings → Devices & services → Add integration → MQTT** and enter the broker IP, user `fitmax` and the password the script printed. RuView's sensors appear automatically, among them:

- presence, motion level and person count;
- a fall event;
- breathing and heart rate;
- someone sleeping, possible distress, and an elderly-inactivity anomaly.

From Home Assistant:

- **Apple Home:** use the built-in *HomeKit Bridge* integration.
- **Google Home / Alexa:** use the *Matter Bridge* add-on, or Home Assistant's Google Assistant / Alexa integrations.

Fall and inactivity alerts can then trigger phone notifications, lights or speaker announcements through ordinary Home Assistant automations.

## Privacy

```bash
./setup.sh esp32 --privacy
```

This strips heart rate, breathing rate and body pose from every output, including FitMax, MQTT and the dashboard. Presence, motion and person count still work.

## Day to day

| Command | What it does |
| --- | --- |
| `./setup.sh status` | Health check |
| `./setup.sh logs` | Follow RuView's logs |
| `./setup.sh stop` | Stop the hub |
| re-run `./setup.sh …` | Change mode; keeps the same token |

Secrets live in `~/fitmax-hub/.env` on the board (mode 600). Don't commit it.

**Limits:** WiFi sensing is approximate and **not a medical device**. RuView's body-pose estimate isn't accurate enough to judge exercise form; FitMax's camera coach handles that. Use the hub for presence, activity and safety alerts.
