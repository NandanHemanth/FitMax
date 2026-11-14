#!/usr/bin/env bash
# FitMax home hub: runs RuView (WiFi sensing server) on an Arduino UNO Q (Debian, arm64).
#
#   ./setup.sh                          # simulated mode (no sensors yet), clearly labelled in FitMax
#   ./setup.sh esp32                    # real sensing: ESP32-S3 nodes stream WiFi CSI to this board
#   ./setup.sh esp32 --home-assistant   # + local MQTT broker so Home Assistant auto-discovers the sensors
#                                       #   (then HA → Google Home / Apple Home / Alexa via Matter or HomeKit)
#   ./setup.sh esp32 --privacy          # never output heart rate, breathing rate or body pose
#   ./setup.sh status | logs | stop
#
# Safe to re-run: keeps the same access token, replaces the containers.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$HERE/.env"
NAME="fitmax-ruview"
IMAGE="${RUVIEW_IMAGE:-ruvnet/wifi-densepose:latest}"
MQTT_IMAGE="eclipse-mosquitto:2"

say() { printf '\033[1;38;5;208m▸\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }
rand_hex() { (openssl rand -hex "$1" 2>/dev/null) || head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }
env_get() { [[ -f "$ENV_FILE" ]] && grep "^$1=" "$ENV_FILE" | cut -d= -f2- || true; }
env_put() { umask 077; printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"; }

DOCKER=docker
need_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    say "Docker not found, installing (needs sudo, ~2 min)…"
    curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
    sudo sh /tmp/get-docker.sh
    sudo usermod -aG docker "$USER" || true
  fi
  if ! docker info >/dev/null 2>&1; then
    sudo systemctl enable --now docker >/dev/null 2>&1 || true
    if docker info >/dev/null 2>&1; then DOCKER=docker; else DOCKER="sudo docker"; fi
  fi
}

case "${1:-}" in
  status) curl -fsS "http://127.0.0.1:3000/health" && echo; exit $? ;;
  logs) need_docker; exec $DOCKER logs -f --tail 100 "$NAME" ;;
  stop) need_docker; $DOCKER rm -f "$NAME" fitmax-mqtt >/dev/null 2>&1 || true; say "Stopped."; exit 0 ;;
esac

MODE="${1:-simulated}"
[[ "$MODE" == simulated || "$MODE" == esp32 ]] || die "Mode must be 'simulated' or 'esp32' (got '$MODE')."
shift || true
HA=0
EXTRA=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --home-assistant|--ha) HA=1; shift ;;
    --privacy) EXTRA+=(--privacy-mode); shift ;;
    *) die "Unknown option: $1" ;;
  esac
done

[[ "$(uname -m)" == aarch64 || "$(uname -m)" == x86_64 ]] || die "Unsupported CPU: $(uname -m)"
need_docker

# --- Network facts ------------------------------------------------------------
IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
if [[ -z "$IP" ]] && command -v ip >/dev/null; then
  IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}' || true)"
fi
[[ -n "$IP" ]] || die "No network address. Connect the UNO Q to WiFi first (App Lab → Settings → Network)."
HOST="$(hostname)"
SUBNET=""   # LAN subnet the ESP32 nodes send from, e.g. 192.168.1.0/24
if command -v ip >/dev/null; then
  CIDR="$(ip -4 -o addr show 2>/dev/null | awk -v ip="$IP" '$4 ~ "^"ip"/" {print $4}' | head -1 || true)"
  if [[ -n "$CIDR" ]] && command -v python3 >/dev/null; then
    SUBNET="$(python3 -c "import ipaddress,sys; print(ipaddress.ip_interface(sys.argv[1]).network)" "$CIDR")"
  fi
fi
UDP_ALLOW="${RUVIEW_UDP_ALLOW:-$SUBNET}"

# --- Secrets (generated once, kept in .env next to this script, mode 600) -------
TOKEN="$(env_get RUVIEW_API_TOKEN)"
[[ -n "$TOKEN" ]] || { TOKEN="$(rand_hex 32)"; env_put RUVIEW_API_TOKEN "$TOKEN"; }
MQTT_PASSWORD=""
if [[ $HA == 1 ]]; then
  MQTT_PASSWORD="$(env_get MQTT_PASSWORD)"
  [[ -n "$MQTT_PASSWORD" ]] || { MQTT_PASSWORD="$(rand_hex 16)"; env_put MQTT_PASSWORD "$MQTT_PASSWORD"; }
fi

# --- Run ------------------------------------------------------------------------
say "Pulling $IMAGE (first time ~300 MB)…"
$DOCKER pull -q "$IMAGE" >/dev/null
$DOCKER rm -f "$NAME" >/dev/null 2>&1 || true
$DOCKER rm -f fitmax-mqtt >/dev/null 2>&1 || true

ARGS=(
  -d --name "$NAME" --restart unless-stopped
  -e RUVIEW_API_TOKEN="$TOKEN"
  -e CSI_SOURCE="$MODE"
  # Lets the laptop reach the API by IP / name (RuView blocks unknown Host headers)
  -e SENSING_ALLOWED_HOSTS="$IP,$HOST,$HOST.local"
  -v fitmax-ruview-data:/app/data
  --security-opt no-new-privileges:true --cap-drop ALL
  --memory 1g --cpus 2
)

if [[ $HA == 1 ]]; then
  # Local Mosquitto on the board (user "fitmax"). RuView publishes over localhost,
  # Home Assistant connects to the board from your network.
  say "Starting local MQTT broker for Home Assistant…"
  $DOCKER pull -q "$MQTT_IMAGE" >/dev/null
  $DOCKER volume create fitmax-mqtt-config >/dev/null
  $DOCKER run --rm -v fitmax-mqtt-config:/c -e P="$MQTT_PASSWORD" "$MQTT_IMAGE" sh -c '
    printf "listener 1883\nallow_anonymous false\npassword_file /c/passwd\npersistence false\n" > /c/mosquitto.conf
    rm -f /c/passwd && touch /c/passwd && chmod 0700 /c/passwd
    mosquitto_passwd -b /c/passwd fitmax "$P"
    chown mosquitto:mosquitto /c/passwd /c/mosquitto.conf'
  $DOCKER run -d --name fitmax-mqtt --restart unless-stopped --network host \
    -v fitmax-mqtt-config:/c "$MQTT_IMAGE" mosquitto -c /c/mosquitto.conf >/dev/null
  ARGS+=(--network host -e MQTT_PASSWORD="$MQTT_PASSWORD")
  EXTRA+=(--mqtt --mqtt-host 127.0.0.1 --mqtt-username fitmax)
else
  ARGS+=(-p 3000:3000 -p 3001:3001 -p 5005:5005/udp)
fi

if [[ "$MODE" == esp32 ]]; then
  [[ -n "$UDP_ALLOW" ]] || die "Couldn't work out your LAN subnet. Re-run with RUVIEW_UDP_ALLOW=192.168.x.0/24 ./setup.sh esp32"
  ARGS+=(-e RUVIEW_UDP_ALLOW="$UDP_ALLOW")
fi

$DOCKER run "${ARGS[@]}" "$IMAGE" "${EXTRA[@]}" >/dev/null

say "Waiting for RuView to come up…"
for _ in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:3000/health" >/dev/null 2>&1 && break
  sleep 2
done
curl -fsS "http://127.0.0.1:3000/health" >/dev/null 2>&1 || { $DOCKER logs --tail 30 "$NAME"; die "RuView didn't start. Logs above."; }

echo
echo "  ✓ RuView is running on this UNO Q  (mode: $MODE$([[ $HA == 1 ]] && echo ', Home Assistant MQTT on'))"
echo
echo "  Paste these two lines into FitMax/apps/web/.env on your laptop, then restart npm run dev:"
echo
echo "      RUVIEW_URL=http://$IP:3000"
echo "      RUVIEW_API_TOKEN=$TOKEN"
echo
echo "  RuView's own dashboard:  http://$IP:3000/ui/index.html"
if [[ "$MODE" == esp32 ]]; then
  echo "  ESP32-S3 nodes: provision with  --target-ip $IP  (UDP 5005, accepted from $UDP_ALLOW)"
else
  echo "  No sensors yet, so data is SIMULATED (FitMax labels it). When ESP32-S3 nodes arrive: ./setup.sh esp32"
fi
if [[ $HA == 1 ]]; then
  echo "  Home Assistant: Settings → Devices & services → Add integration → MQTT"
  echo "      broker $IP · port 1883 · username fitmax · password $MQTT_PASSWORD"
  echo "  The RuView sensors then appear on their own (presence, motion, fall, breathing, …)."
fi
echo "  Starts automatically on boot. Check: ./setup.sh status · Logs: ./setup.sh logs · Stop: ./setup.sh stop"
echo
