# Sentivo — Android App Design Brief

Monitor and control your Windows laptop from your Android phone. Anti-theft + full
remote control. App-only (no Telegram). Self-hosted relay. Free, sideloaded APK.

---

## 1. Design language

- **Light theme only** (approved design) — bright, clean, high-contrast. No dark variant.
- **Feel:** calm security dashboard — a control room, not a toy. Breathing room, big tap
  targets, one clear primary action per screen.
- **Shape:** white rounded cards (16–20px) with soft shadows on a light canvas, 1px
  hairline separators.
- **Motion:** **springy micro-interactions on every element** — press scale-bounce,
  mount/enter stagger, tab-switch spring, animated value/number changes, pulsing "live"
  dot. Keep springs **short & snappy** (~180–280ms, high stiffness) so it feels alive
  but never sluggish. Use Reanimated (runs on the UI thread → 60fps, fast).
- **Data-viz over words** — the app has realtime data the bot never did: show it.
  CPU/RAM as **ring gauges + live sparklines**, disk as bars, uptime/battery as chips,
  **running processes as an animated bar list** (by RAM/CPU). Clean, minimal text, more
  visuals — a glanceable dashboard, not paragraphs.
- **Density:** generous. Home is scannable in one glance from across a room.

### Color tokens (from the approved design — status colors carry meaning)
| Token | Light | Meaning |
|-------|-------|---------|
| `canvas` | `#EDF1F7` | app background (subtle radial gradient) |
| `card` | `#FFFFFF` | cards |
| `card2` | `#F2F5FA` | nested / pressed |
| `ink` | `#0F1720` | primary text |
| `muted` | `#6C7A89` | secondary text |
| `line` | `#E7ECF3` | separators / borders |
| `emerald` | `#10B981` | **armed / connected / safe** |
| `slate` | `#64748B` | **disarmed / idle** |
| `red` | `#EF4444` | **alert / danger / destructive** |
| `amber` | `#F59E0B` | **warning / attention** |
| `blue` | `#3B82F6` | **live / streaming / info** |
| `violet` | `#8B5CF6` | accents, biometric |
| `dark` | `#0E141B` | primary buttons / high-contrast accents |

Rule: **green = protected, slate = off, red = danger, blue = live, amber = warning.**
Same as the desktop tray shield, so app and desktop feel like one product.

### Typography
- **Inter** (or system). Sizes: Display 28/bold, Title 20/semibold, Body 15,
  Label 13, Caption 11. Numerals tabular for stats.

---

## 2. Icons — huge pack

**Primary: Phosphor** (`phosphor-react-native`) — ~9,000 icons, 6 weights
(thin/light/regular/bold/fill/duotone). Use **duotone** for feature tiles, **bold**
for nav, **fill** for status. This is the "huge, clean, consistent" set.

Alternative if we want zero setup: **MaterialCommunityIcons** via
`@expo/vector-icons` (~7,000 icons, ships with Expo).

Suggested mapping (Phosphor names):
- Home `House` · Screen `Monitor` / `Broadcast`(live) · Guard `ShieldCheck` /
  `ShieldWarning` · Activity `Bell` / `PulseWave` · Settings `GearSix`
- Status: `Pulse`(cpu) `Memory`(ram) `HardDrives`(disk) `Clock`(uptime)
  `Lock`/`LockOpen` `BatteryHigh` `WifiHigh`
- Actions: `Camera` `Microphone` `Power` `MoonStars`(sleep) `ArrowClockwise`(restart)
  `SignOut`(logoff) `Alarm` `MapPin`(locate) `Bluetooth` `Clipboard` `FolderOpen`
  `Skull`(kill) `Cpu`(processes)
- Security: `Fingerprint`/`ShieldStar`(biometric) `Eye`(watch) `Detective`(tamper)

---

## 3. Information architecture

**Bottom tab bar (5):** `Home` · `Screen` · `Guard` · `Activity` · `Settings`
Everything else opens as a stacked screen or bottom sheet from Home cards.

```
Connect/Pair ──▶ [ Home  Screen  Guard  Activity  Settings ]
                    │        │       │       │         │
   Home cards ──────┼─▶ Power, Camera, Files, Processes, Clipboard, Devices
   biometric sheet ◀──────┘ (intercepts any dangerous action)
```

**Primary flows**
1. **First run:** Connect → pair device (token/QR) → Home.
2. **Daily:** open → Home glanceable status → quick action or tab.
3. **Alert:** push → tap → Activity or the relevant screen → act (biometric if dangerous).
4. **Leaving the laptop:** Guard → Arm (one tap).

---

## 4. Screens (every page, its meaning, contents, states)

### 4.1 Connect / Pair  *(onboarding, first launch only)*
**Meaning:** bind this phone to a laptop + relay. No account walls.
- Fields: **Relay URL** (`wss://host:port`), **Device token** (paste or **scan QR**
  shown by the installer), optional **cert fingerprint** (advanced).
- Big **Connect** button → validates → success animation → Home.
- States: idle · connecting (spinner) · bad-token/offline (inline error) · success.
- Secondary: "How do I install the agent?" link.

### 4.2 Home / Dashboard  *(the hero screen)*
**Meaning:** is my laptop OK, and what's it doing — in one glance.
- **Top: device hero card** — device name, big **status ring** (emerald armed /
  slate disarmed), connection pill (🟢 Connected / 🔴 Reconnecting), last-seen.
- **Live stat row:** CPU %, RAM %, Disk %, Uptime, Battery, Lock state — tabular,
  auto-refreshing, tiny sparkline optional.
- **Primary action:** big **Arm / Disarm** toggle (the #1 thing).
- **Quick actions grid** (duotone tiles): Screenshot · Live Screen · Camera ·
  Lock · Clipboard · Files · Processes · Power.
- **Recent activity** mini-list (last 3 events) → tap = Activity tab.
- Pull-to-refresh. Multi-device: tappable device name → Devices switcher.
- States: connected · reconnecting (skeleton stats) · offline (dimmed + "last seen").

### 4.3 Screen  *(live control — full remote desktop)*
**Meaning:** see and **completely** drive the laptop in real time.
- Full-bleed **live video** (MJPEG frames), pulsing blue "LIVE" chip, FPS/latency.
- **Tap/drag = mouse**, on-screen **keyboard** toggle for typing, buttons: click,
  right-click, scroll, Esc, Win, Ctrl-Alt-Del.
- **One-shot Screenshot** button (when not streaming) → full-res viewer (pinch-zoom,
  save/share).
- Stream **auto-stops** when you leave the screen (saves laptop resources — show this).
- States: connecting · live · paused/backgrounded · error.
- **Completely drivable:** pointer move · tap=click · long-press=right-click · drag ·
  two-finger scroll · pinch; full keyboard + modifiers, paste text, Alt-Tab / Ctrl-Alt-Del.

### 4.3b Cast — share *your phone's* screen to the laptop  *(reverse direction)*
**Meaning:** mirror your Android screen onto the laptop — the inverse of §4.3.
- Phone captures its screen via **MediaProjection** (Android's one-tap "Start casting?"
  consent each session), encodes ~10–15 fps, streams to the relay.
- The **laptop** shows it: the agent opens a lightweight viewer window (or the default
  browser to a relay `/cast` page) rendering the frames; closes when you stop.
- Controls: Start / Stop cast · quality · "keep laptop awake while casting".
- Reuses the streaming pipe, reversed (phone = source, laptop = viewer).
- States: requesting permission · casting · stopped · laptop-not-watching.

### 4.4 Camera
**Meaning:** eyes on the surroundings + motion alerts.
- **Take photo** (webcam) → viewer. Toggle **camera sensor** (motion → alert).
- Toggle **microphone sensor** (sound → alert). Show live mic level meter.
- Recent motion snapshots strip.
- Note: sensors only fire while **Armed** — surface that clearly.

### 4.5 Guard  *(anti-theft / security)*
**Meaning:** the security posture, one place.
- Giant **Arm / Disarm** switch with explanation of what arming does.
- Sensor toggles: **Camera motion**, **Microphone**, **Activity-after-idle** (someone
  touched it), each with on/off + last-trip time.
- **Locate** (IP geolocation) → map card + coords + ISP.
- **Sound alarm** (destructive-styled, biometric) — blares the laptop.
- **Windows-notification forwarding** toggle.
- Tamper banner if a recent anomaly was detected.

### 4.6 Power
**Meaning:** control the machine's power state. Dangerous actions gated by biometric.
- Tiles: **Lock**, **Wake display**, **Sleep**, **Sleep in… (timer)**, **Restart**,
  **Shut down**, **Log off**, **Cancel pending**.
- Destructive ones (restart/shutdown/logoff) are red + require biometric + confirm sheet.

### 4.7 Files
**Meaning:** move files between phone and laptop.
- **Get from laptop:** path field / recent paths → downloads to phone (progress).
- **Send to laptop:** pick a file → uploads to `Downloads\Sentivo` (progress).
- Transfer history list. Size caps shown.

### 4.8 Processes
**Meaning:** see what's running, kill runaways.
- Live list (top by RAM/CPU): name, PID, RAM, CPU. Search/sort.
- Swipe or tap → **Kill** (biometric + confirm). Refresh.

### 4.9 Clipboard
**Meaning:** share text/links both ways.
- **Laptop clipboard** card (pull current) → copy / open-link buttons.
- **Send text to laptop** field → sets laptop clipboard.
- **Clipboard sync** toggle: everything copied on the laptop streams into a feed here
  (each entry: copy button, open-if-link).
- This is the phone-side twin of the desktop tray "Recent messages".

### 4.10 Activity / Notifications
**Meaning:** the timeline of everything Sentivo saw. Mirrors push notifications.
- Reverse-chronological feed, grouped by day. Each item: icon (by type), title, detail,
  time, thumbnail if any (motion snap, screenshot).
- **Types & color:** 🔴 Alert (agent dropped/dead-man, motion, mic, tamper) · 🔵 Live
  (viewer connected) · 🟢 System (armed/disarmed, connected) · ⚪ Windows notification
  (forwarded) · action results.
- Filter chips (All / Alerts / Windows / System). Tap alert → jump to relevant screen.
- Swipe to dismiss, "clear all".

### 4.11 Devices  *(multi-laptop)*
**Meaning:** manage more than one machine.
- List of paired laptops: name, status dot, last-seen. Tap = make active.
- **Add device** (→ Pair flow). Rename / remove.

### 4.12 Settings
**Meaning:** configuration + account.
- **Security:** app biometric lock (fingerprint/face to open the app + to confirm
  dangerous actions), the **require-confirm action list**, grace-period length, and the
  device-pairing key (view / rotate / revoke). No TOTP typing.
- **Sensors:** camera device, motion sensitivity, mic threshold.
- **Connection:** relay URL, fingerprint, reconnect, disconnect device.
- **Notifications:** per-channel toggles (Alerts / Activity / Windows), quiet hours,
  test-notification button.
- **Appearance:** dark/light/system, accent.
- **About:** version, GitHub link, agent install guide.

### 4.13 Confirm sheet  *(modal, intercepts dangerous actions)*
**Meaning:** prove it's you before shutdown/kill/alarm/locate — **one touch, no codes**.
- Bottom sheet: action name + **biometric confirm** (fingerprint / face, Android
  BiometricPrompt); device-PIN fallback. No typed TOTP, ever.
- Why it's still maximum security: the phone is paired once (device key lives in the
  Android Keystore = "something you have"), biometric = "something you are", pinned TLS
  carries the session. A stolen/lost phone can't act — actions are biometric-gated.
- Optional **grace window** ("no re-confirm for 5 min ✓") for rapid repeated actions.

---

## 5. Notifications (push) — "proper" spec

**Channels (Android notification channels, user-controllable):**
1. **Alerts** — max priority, sound+vibrate, bypass DND option. Anti-theft: agent
   dropped (dead-man), motion, mic, tamper/activity-after-idle.
2. **Activity** — default priority. Armed/disarmed, connected, command results.
3. **Windows** — low priority, silent. Forwarded toasts (grouped under one summary).

**Rich actions on the notification itself** (act without opening the app):
- Alert (dead-man / motion): **[ Lock ]** **[ Sound alarm ]** **[ Locate ]** **[ View ]**
- Windows toast: **[ Copy ]** (if text) / **[ Open ]** (if link) / **[ Mute app ]**
- Destructive actions from a notification still route through biometric in-app.

**Behavior:** group by device, collapse Windows toasts into a summary, thumbnail for
motion/screenshot alerts, deep-link tap → the right screen. Delivered via **Expo Push**
(free); needs a dev/standalone build (not Expo Go).

---

## 6. Home-screen widgets (Android)

Built with `react-native-android-widget` (Expo config plugin). Ship several the user
can pick per purpose:

1. **Status widget (2×1):** device name, status dot (armed/disarmed), connection,
   CPU/RAM. Tap → Home. *Purpose: at-a-glance safety.*
2. **Guard toggle (1×1):** giant Arm/Disarm button, color = state. Tap = toggle
   (biometric-aware). *Purpose: one-tap arm when leaving.*
3. **Quick actions (4×1):** Lock · Screenshot · Camera · Alarm. *Purpose: instant control.*
4. **Last alert (2×2):** most recent alert + thumbnail (motion/screenshot) + time.
   Tap → Activity. *Purpose: anti-theft glance.*
5. **Live thumbnail (2×2):** last screenshot, "tap to go live". *Purpose: quick peek.*

Widget visual language matches the app: dark card, status color, big icon (Phosphor
rendered to the widget), tabular stats.

---

## 6b. Resource discipline (mobile · laptop · server) — hard requirement

Nothing runs unless it's needed; everything turns off when it isn't.
- **App:** WebSocket is open only while the app is **foreground** (background → close, rely
  on push). The **live stream is requested only while the Screen tab is focused** and
  stopped on leave. Status is fetched on demand, not on a timer. No background polling.
- **Laptop agent:** screen frames captured **only while a viewer is connected** (~5 fps);
  camera/mic/notify pollers run **only when that feature is enabled**; idle ≈ 22 MB / ~0% CPU.
- **Relay:** event-driven; fans out only to connected clients, no polling loops.

## 7. Cross-cutting states (design all of these)

- **Connection:** connected · reconnecting (skeletons) · offline (dimmed, "last seen X",
  actions disabled with a note) · never-paired (→ Connect).
- **Empty:** no activity, no devices, no transfers — friendly illustration + one CTA.
- **Loading:** skeletons, not spinners, on cards.
- **Error/permission:** notification-access not granted, camera needs ffmpeg (auto-installs),
  biometric required — inline, actionable.
- **Destructive confirm:** red sheet + biometric for shutdown/restart/logoff/kill/alarm.

---

## 8. Reusable components (name them in the design)

`StatusRing`, `ConnectionPill`, `StatCell`, `ActionTile` (duotone icon + label),
`BigToggle` (Arm/Disarm), `ActivityRow`, `SensorRow` (label + switch + last-trip),
`CodeInput` (6-digit), `TransferRow`, `ProcessRow`, `SheetConfirm`, `LiveChip`,
`DeviceCard`, `MapCard`.

---

## 9. What to hand the design tool

"Design a dark-first Android security/monitoring app called **Sentivo**. 5 bottom tabs
(Home, Screen, Guard, Activity, Settings). Status color system: emerald=armed/safe,
slate=off, red=danger, blue=live, amber=warning. Rounded cards on near-black canvas,
generous spacing, Phosphor duotone icons, Inter type, tabular numerals. Produce every
screen in §4, the biometric sheet, the notification designs in §5, and the 5 home widgets in
§6, with connected / reconnecting / offline / empty states."
