#!/usr/bin/env bash
# Run on the VPS from the repo root:  sudo bash deploy/setup-relay.sh
# Installs the relay as a systemd service, generates secrets on first run,
# and prints the TLS fingerprint you paste into the agent installer.
set -euo pipefail

APP=/opt/control
ENVFILE=/etc/control/relay.env
mkdir -p "$APP" /etc/control

# --- binary: prefer a prebuilt one, else build with Go ---
BIN=""
for c in ./dist/relay ./relay; do [ -f "$c" ] && BIN="$c" && break; done
if [ -z "$BIN" ]; then
  command -v go >/dev/null || { echo "need dist/relay binary or Go installed"; exit 1; }
  echo "building relay..."
  go build -ldflags "-s -w" -o /tmp/relay ./relay
  BIN=/tmp/relay
fi
cp "$BIN" "$APP/relay"
chmod +x "$APP/relay"

# --- secrets (first run only) ---
if [ ! -f "$ENVFILE" ]; then
  TOKEN=$(openssl rand -hex 24)
  read -rp "Public URL for streaming (e.g. https://your.vps:8443, blank to skip): " PURL
  cat > "$ENVFILE" <<EOF
AUTH_TOKEN=$TOKEN
ADDR=:8443
PUBLIC_URL=$PURL
EOF
  chmod 600 "$ENVFILE"
  echo
  echo ">>> AUTH_TOKEN (goes in the agent RELAY_URL ?token=): $TOKEN"
fi

# --- service ---
cp deploy/relay.service /etc/systemd/system/control-relay.service
systemctl daemon-reload
systemctl enable --now control-relay
sleep 1

echo
echo ">>> RELAY_FP (set as agent RELAY_FP):"
for _ in $(seq 1 15); do
  [ -f "$APP/fingerprint.txt" ] && { cat "$APP/fingerprint.txt"; echo; break; }
  sleep 0.5
done
echo
echo "Open the firewall for TCP 8443, then run install-agent.ps1 on the laptop."
