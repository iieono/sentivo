# Features

One system: `agent` (Windows) ⇄ `relay` (VPS/Dokploy or on-device) ⇄ **Sentivo Android
app**. One protocol, outbound-only agent, TLS, FCM push for closed-app alerts. Single-user.

Status: ✅ done · 🔜 next · 🔲 planned · ⚠️ hard limit (read the note)

## Remote control (phone → laptop)
- ✅ Power — lock, sleep, restart, shut down, log off, wake display (dangerous ones
  biometric-confirmed), in the **Power** sheet
- ✅ **Performance modes** — Saver / Balanced / Performance / **🎮 Gaming** (Ultimate power
  plan + Windows Game Mode), and **screen brightness** (25/50/75/100%, WMI)
- ✅ **Apps** — list running apps; **launch**, **focus** (bring one to front), or kill; launch
  executables straight from the file browser
- ✅ **Terminal** — run PowerShell on the laptop from the phone (biometric-gated)
- ✅ **Media** — play/pause (reactive ▶/⏸), next/prev, volume, **mic mute/unmute**, and the
  **now-playing** title/artist read from Windows' media transport controls
- ✅ **Paste** — one tap drops the phone clipboard into the laptop at the cursor (Ctrl+V)
- ⚠️ Wake from full power-off / real Wake-on-LAN — unreliable on laptops over WiFi

## Live screen & control
- ✅ Live view — agent captures JPEG at a **configurable** frame rate (auto-max **30 fps**
  while controlling for low latency); fullscreen, floating controls, no per-frame flicker
- ✅ Full control — **tap-to-click**, hold for right-click, keyboard + modifier combos, and a
  **trackpad mode** (drag = relative cursor, tap = click, 2-finger tap = right-click)
- ✅ **Control mode forces landscape** immediately (best for a widescreen laptop)
- ✅ Screenshot → **pinch-to-zoom viewer**, save to a Sentivo album, or **download/share**
- 🔲 phone → PC **cast** (MediaProjection) · phone as a **second monitor** — native, needs a
  device build loop
- 🔲 Optional real codec (H.264/WebRTC) if 60fps / lowest-latency ever needed

## Resources
- ✅ CPU, RAM, **GPU** — each an animated ring with **CPU°/GPU° temps** when the hardware
  reports them; **every fixed disk gets its own ring** (C:, D:, …)
- ✅ **Tap any ring for a live history chart** (CPU / RAM / GPU / per-drive)
- ✅ WiFi (SSID + **signal %**), battery, uptime, lock state; GPU/stat sampling only while on
  screen (resource discipline)

## Files (2-way, all drives)
- ✅ Browse **This PC → every drive** (C:/D:/E:…), dirs-first, sizes, up/back
- ✅ **Temp preview** — tap an image to view it fullscreen (downloaded to cache, not saved;
  optional Save) · download other files (share sheet, with a progress banner)
- ✅ Upload a file from the phone (≤20 MB) · **launch** .exe/.lnk from here

## Clipboard
- ✅ Send text to the laptop (input at the bottom) · **live-sync** copies back with a
  Copy/Open snackbar · state persists across reopen
- ✅ When the app is **closed**, copies arrive as a **push notification** (relay → FCM)
- ⚠️ Automatic phone→laptop sync only while the app is open — Android blocks background
  clipboard reads; the **Paste** button covers the one-shot case

## Alerts & monitoring (laptop → phone)
- ✅ Dead-man (agent killed / power pulled) · lock/unlock · activity-after-idle (armed) · USB
  inserted · power unplugged / low battery · forwarded Windows toasts
- ✅ **Global toast feedback** — every action shows a green ✓ / red ⚠ so you know it worked
- ✅ Delivered to the **closed app via FCM** at no battery cost (Expo → FCM; no Google secrets
  on the relay)
- ✅ **Automations** — when-this-then-that rules (e.g. on-lock → screenshot); **sensor tuning**
  (motion / mic sensitivity, away timeout)

## Sensors (opt-in, OFF by default, gated by armed state)
- ✅ Mic level (Core Audio peak meter) · camera motion tripwire + snapshot (ffmpeg
  auto-installed on first use); both fire only while **armed**
- ✅ **Arm / disarm** master switch

## Anti-theft
- ✅ Approximate location (IP geolocation → **Open in Maps**) · **loud alarm that loops until
  you stop it** (Stop button on the phone) · tamper snapshot on the activity alert

## Security
- ✅ Outbound-only agent → no open ports, NAT/firewall friendly, auto-reconnect
- ✅ TLS — valid cert via a proxy **or** self-signed with **fingerprint pinning**
- ✅ Token auth (single account from `AUTH_TOKEN`), in the app's secure storage, never in a
  URL; ephemeral 10-min view-only tokens for live links
- ✅ **Biometric** confirms sensitive actions, and **optionally locks the app on open**;
  optional **TOTP** command gating verified on-device
- ✅ FCM credentials live in Expo, never in the relay or repo

## App
- ✅ Light-themed Expo/Android app: floating tab bar, bottom sheets, animated rings & charts,
  spring animations, custom toggles, refresh icons that spin + flash green when done
- ✅ **No login flash** on open (splash while creds load) · loading/empty/data states
- ✅ **QR pairing** (or manual) · landscape live view · biometric app-lock

---
### Honest limits (don't design around these)
1. No reliable remote wake from full power-off on a laptop.
2. IP "locate" is coarse; nothing locates a powered-off machine.
3. Live streaming is lightweight *while idle* — it costs real bandwidth while active.
4. Closed-app push requires an EAS build with FCM configured (see `NOTIFICATIONS.md`).
5. phone→PC cast & second-monitor are native features that still need a device build loop.
