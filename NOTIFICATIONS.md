# Push notifications

Sentivo delivers alerts (dead-man / motion / mic / tamper / forwarded Windows toasts)
to the phone **in the Sentivo app**, with **no battery cost** and **no extra app** — using
FCM behind Expo's push service. No Firebase credentials ever touch the relay.

```
agent event ─▶ relay ─▶ Expo push service ─▶ FCM ─▶ Sentivo app (even when closed)
```

## Architecture

- The app registers an **Expo push token** (`getExpoPushTokenAsync`) and sends it to the
  relay (`pushtoken` action). See `app/src/notify.ts`.
- The relay stores tokens per account and POSTs to `https://exp.host/--/api/v2/push/send`
  on events and on the offline dead-man alert. See `relay/push.go`, `relay/main.go`.
- Expo relays to FCM using the **FCM V1 service account** uploaded to the Expo project — so
  the relay holds no Google secrets.
- **Local fallback (no FCM):** while the app is open/recently used it also raises local
  notifications over the live socket. Settings ▸ **Background alerts** keeps the socket
  alive for a bounded window after you leave the app (off by default = battery-safe).

## What's already set up

- Firebase project **`sentivo-22cb6`** (free Spark plan), Android app **`uz.relayt.sentivo`**.
- Expo project **`@relayt/sentivo`** created; its `projectId` + `owner` are wired into `app.json`.
- `app/google-services.json` — in place, referenced by `app.json`, **gitignored**.
- `app/fcm-service-account.json` — the FCM V1 key, **gitignored** (never commit; upload to Expo).
- App + relay code committed and building.

## Remaining steps (need the Expo CLI — run in `app/`)

The Expo project + `projectId` are already set, so **no `eas init` needed**:

```bash
npm i -g eas-cli        # if needed
eas login               # the @relayt account
eas credentials         # Android ▸ Push Notifications (FCM V1) ▸
                        #   upload app/fcm-service-account.json   (also generates the keystore)
eas build -p android --profile preview   # produces the APK to install
```

After installing the built APK and pairing, sensor/offline alerts arrive even with the app
fully closed. (Expo Go and the web preview cannot receive FCM pushes — only an EAS build can.)

## Security

- FCM is free with no practical message limit.
- Secrets live outside git (`google-services.json`, `fcm-service-account.json`) and in Expo
  (the service account) — never in the relay or the repo.
