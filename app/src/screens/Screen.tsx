import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Animated, Image, LayoutChangeEvent, Modal, PanResponder, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Broadcast, Copy, Cursor, CursorClick, DeviceMobile, DownloadSimple, Export, Image as ImageIcon, Keyboard as KeyboardIcon, Stop, X } from 'phosphor-react-native';
import * as Clip from 'expo-clipboard';
import { Screen as Wrap, T } from '../ui';
import { Bounce } from '../anim';
import * as ScreenOrientation from 'expo-screen-orientation';
import { setImmersive } from '../immersive';
import { useBackHandler } from '../useBack';
import { saveToGallery } from '../media';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import { startCast, stopCast, onFrame } from '../../modules/screencast';
import { C } from '../theme';
import { Msg, useConn } from '../conn';

// LiveImage double-buffers the JPEG stream: the incoming frame decodes on the hidden layer and
// only becomes visible on its onLoad, so the shown frame never blanks out — kills the flicker.
function LiveImage({ data, style, resizeMode = 'contain' as const }: { data: string | null; style?: any; resizeMode?: 'contain' | 'cover' }) {
  const [a, setA] = useState<string | null>(null);
  const [b, setB] = useState<string | null>(null);
  const [showA, setShowA] = useState(true);
  const showARef = useRef(true);
  showARef.current = showA;
  useEffect(() => {
    if (!data) return;
    if (showARef.current) setB(data); else setA(data); // load into the hidden buffer
  }, [data]);
  return (
    <View style={style} pointerEvents="none">
      {a ? (
        <Image source={{ uri: 'data:image/jpeg;base64,' + a }} style={[StyleSheet.absoluteFill, { opacity: showA ? 1 : 0 }]} resizeMode={resizeMode} fadeDuration={0}
          onLoad={() => { if (!showARef.current) setShowA(true); }} />
      ) : null}
      {b ? (
        <Image source={{ uri: 'data:image/jpeg;base64,' + b }} style={[StyleSheet.absoluteFill, { opacity: showA ? 0 : 1 }]} resizeMode={resizeMode} fadeDuration={0}
          onLoad={() => { if (showARef.current) setShowA(false); }} />
      ) : null}
    </View>
  );
}

// LiveControl: the live view as a proper remote-control surface — pinch to zoom (1–4×), drag to
// pan when zoomed, two-finger drag to scroll the laptop, tap = left-click (right-click via
// two-finger tap) mapped through the zoom so clicks land where you aimed.
function LiveControl({ data, onInput, ctrlMode, onTap }: { data: string | null; onInput: (o: any) => void; ctrlMode: boolean; onTap: () => void }) {
  const size = useRef({ w: 1, h: 1 });
  const s = useRef(1), x = useRef(0), y = useRef(0);
  const aS = useRef(new Animated.Value(1)).current;
  const aX = useRef(new Animated.Value(0)).current;
  const aY = useRef(new Animated.Value(0)).current;
  const g = useRef<any>(null);
  const commit = () => { aS.setValue(s.current); aX.setValue(x.current); aY.setValue(y.current); };
  const clampPan = () => {
    const mx = (size.current.w * (s.current - 1)) / 2, my = (size.current.h * (s.current - 1)) / 2;
    x.current = Math.max(-mx, Math.min(mx, x.current));
    y.current = Math.max(-my, Math.min(my, y.current));
  };
  const d2 = (t: any[]) => Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY);
  const mid = (t: any[]) => ({ x: (t[0].pageX + t[1].pageX) / 2, y: (t[0].pageY + t[1].pageY) / 2 });

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, gs) => Math.abs(gs.dx) > 2 || Math.abs(gs.dy) > 2 || gs.numberActiveTouches === 2,
      onPanResponderGrant: (e) => {
        const t = e.nativeEvent.touches;
        g.current = {
          t0: Date.now(), n: Math.max(1, t.length), moved: false, d0: t.length >= 2 ? d2(t) : 0,
          s0: s.current, x0: x.current, y0: y.current, acc: 0,
          cx: t.length >= 2 ? mid(t).x : t[0]?.pageX ?? 0, cy: t.length >= 2 ? mid(t).y : t[0]?.pageY ?? 0,
          tapX: t[0]?.locationX ?? 0, tapY: t[0]?.locationY ?? 0,
        };
      },
      onPanResponderMove: (e) => {
        const t = e.nativeEvent.touches, st = g.current;
        if (!st) return;
        st.n = Math.max(st.n, t.length);
        if (t.length >= 2) {
          st.moved = true;
          const d = d2(t), m = mid(t);
          if (st.d0 > 0) s.current = Math.max(1, Math.min(4, st.s0 * (d / st.d0)));
          if (s.current > 1.03) { x.current = st.x0 + (m.x - st.cx); y.current = st.y0 + (m.y - st.cy); clampPan(); }
          else { st.acc += m.y - st.cy; st.cy = m.y; while (Math.abs(st.acc) >= 22) { onInput({ t: 'scroll', dy: st.acc > 0 ? -1 : 1 }); st.acc += st.acc > 0 ? -22 : 22; } }
          commit();
        } else if (s.current > 1.03) {
          const nx = e.nativeEvent.pageX, ny = e.nativeEvent.pageY;
          if (Math.abs(nx - st.cx) > 3 || Math.abs(ny - st.cy) > 3) st.moved = true;
          x.current = st.x0 + (nx - st.cx); y.current = st.y0 + (ny - st.cy); clampPan(); commit();
        }
      },
      onPanResponderRelease: (e) => {
        const st = g.current;
        if (!st) return;
        g.current = null;
        if (st.moved || Date.now() - st.t0 >= 280) return; // a drag/pinch, not a tap
        if (!ctrlMode) { onTap(); return; } // viewing mode → just toggle the controls
        const w = size.current.w, h = size.current.h;
        const ix = (st.tapX - w / 2 - x.current) / s.current + w / 2; // undo pan+center-scale
        const iy = (st.tapY - h / 2 - y.current) / s.current + h / 2;
        const b = st.n >= 2 ? 'right' : 'left';
        const nx = Math.max(0, Math.min(1, ix / w)), ny = Math.max(0, Math.min(1, iy / h));
        onInput({ t: 'down', x: nx, y: ny, b });
        onInput({ t: 'up', x: nx, y: ny, b });
      },
    })
  ).current;

  return (
    <View style={StyleSheet.absoluteFill} onLayout={(e) => { const l = e.nativeEvent.layout; size.current = { w: l.width || 1, h: l.height || 1 }; }} {...pan.panHandlers}>
      <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX: aX }, { translateY: aY }, { scale: aS }] }]}>
        {data ? (
          <LiveImage data={data} style={StyleSheet.absoluteFill} />
        ) : (
          <View style={styles.center}>
            <Broadcast size={44} color={C.slate} weight="duotone" />
            <Text style={{ color: '#8894A3', marginTop: 10, fontWeight: '600' }}>Connecting…</Text>
          </View>
        )}
      </Animated.View>
    </View>
  );
}

export default function LiveScreen() {
  const { send, sendInput, sendCast, setKeepAlive, subscribe, presence, status } = useConn();
  const nav = useNavigation<any>();
  const [img, setImg] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [kb, setKb] = useState(false);
  const [trackpad, setTrackpad] = useState(false);
  const [casting, setCasting] = useState(false);
  const castSub = useRef<{ remove: () => void } | null>(null);
  const tpLast = useRef({ x: 0, y: 0 });
  const tpMoved = useRef(false);
  const tpStart = useRef(0);
  const [controls, setControls] = useState(true);
  const [ctrlMode, setCtrlMode] = useState(false); // tap = click the laptop
  const liveRef = useRef(false);
  const size = useRef({ w: 1, h: 1 });
  const ctlTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // only live frames + screenshot replies belong on this view — not file downloads or tamper snaps
  useEffect(() => subscribe((m: Msg) => { if (m.Data && (m.Kind === 'frame' || (m.Kind === 'reply' && m.Text === '📸'))) setImg(m.Data); }), [subscribe]);
  useEffect(() => {
    setImmersive(live);
    // go live → auto-orient to landscape (a laptop screen is widescreen); exit → back to portrait.
    if (live) ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
    else ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }, [live]);

  const stop = useCallback(() => {
    if (liveRef.current) {
      send('stream-stop');
      liveRef.current = false;
      setLive(false);
      setImmersive(false);
    }
  }, [send]);
  useFocusEffect(useCallback(() => () => stop(), [stop]));

  // hardware back: leave fullscreen live view first, rather than jumping off the tab.
  useBackHandler(useCallback(() => {
    if (liveRef.current) { stop(); return true; }
    return false;
  }, [stop]));

  const showCtl = () => {
    setControls(true);
    if (ctlTimer.current) clearTimeout(ctlTimer.current);
    ctlTimer.current = setTimeout(() => setControls(false), 3500);
  };
  const goLive = () => {
    send('stream-start'); // uses the frame rate you set in Settings ▸ Live stream (no longer forced to 60)
    liveRef.current = true;
    setLive(true);
    showCtl();
  };

  // Cast: mirror the PHONE screen onto the laptop (MediaProjection → relay → laptop browser).
  const startCasting = async () => {
    try {
      const ok = await startCast(12, 55); // fps, jpeg quality
      if (!ok) return; // user declined the capture prompt
      setKeepAlive(true); // keep the socket alive when you leave the app to show your screen
      send('cast-start'); // relay opens the /cast viewer on the laptop
      castSub.current = onFrame((b64) => sendCast(b64));
      setCasting(true);
    } catch {}
  };
  const stopCasting = () => {
    stopCast();
    castSub.current?.remove();
    castSub.current = null;
    setKeepAlive(false);
    setCasting(false);
  };
  useEffect(() => () => { if (castSub.current) { stopCast(); castSub.current.remove(); } }, []);

  const canAct = status === 'connected' && presence === 'online';
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    size.current = { w: width || 1, h: height || 1 };
  };
  const click = (e: any, b: 'left' | 'right') => {
    const x = Math.max(0, Math.min(1, e.nativeEvent.locationX / size.current.w));
    const y = Math.max(0, Math.min(1, e.nativeEvent.locationY / size.current.h));
    sendInput({ t: 'down', x, y, b });
    sendInput({ t: 'up', x, y, b });
  };
  const onKey = (e: any) => {
    const k = e?.nativeEvent?.key;
    if (!k) return;
    sendInput({ t: 'key', k, d: true });
    sendInput({ t: 'key', k, d: false });
  };

  // trackpad: drag anywhere to move the cursor (relative), tap to click, 2-finger tap = right-click
  const tpMax = useRef(1);
  const trackpadPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        tpLast.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
        tpMoved.current = false;
        tpMax.current = 1;
        tpStart.current = Date.now();
      },
      onPanResponderMove: (e, g) => {
        tpMax.current = Math.max(tpMax.current, g.numberActiveTouches);
        if (g.numberActiveTouches >= 2) return;
        const x = e.nativeEvent.pageX, y = e.nativeEvent.pageY;
        const dx = Math.round((x - tpLast.current.x) * 1.7);
        const dy = Math.round((y - tpLast.current.y) * 1.7);
        if (dx || dy) { sendInput({ t: 'rmove', dx, dy }); tpMoved.current = true; }
        tpLast.current = { x, y };
      },
      onPanResponderRelease: () => {
        if (!tpMoved.current && Date.now() - tpStart.current < 260) {
          sendInput({ t: 'click', b: tpMax.current >= 2 ? 'right' : 'left' });
        }
      },
    })
  ).current;
  const onStageTap = (e: any) => {
    if (ctrlMode) click(e, 'left');
    else if (controls) setControls(false);
    else showCtl();
  };
  const saveShot = async () => {
    if (!img) return;
    const ok = await saveToGallery(img);
    Alert.alert(ok ? 'Saved' : 'Not saved', ok ? 'Added to your Sentivo album.' : 'Gallery access is needed to save.');
  };
  // copyShot puts the screenshot itself on the clipboard (paste it straight into chat/notes).
  const copyShot = async () => {
    if (!img) return;
    try { await Clip.setImageAsync(img); Alert.alert('Copied', 'Screenshot copied to your clipboard.'); }
    catch { Alert.alert('Not copied', 'Could not copy the image.'); }
  };
  // shareShot opens the system share sheet (save to Downloads, send to any app…).
  const shareShot = async () => {
    if (!img) return;
    try {
      const file = new File(Paths.cache, `sentivo-${Date.now()}.jpg`);
      try { if (file.exists) file.delete(); } catch {}
      file.create();
      file.write(img, { encoding: 'base64' });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri);
    } catch {}
  };

  // ---------- FULLSCREEN LIVE ----------
  if (live) {
    return (
      <View style={styles.fs}>
        {trackpad ? (
          <View style={StyleSheet.absoluteFill} onLayout={onLayout} {...trackpadPan.panHandlers}>
            {img ? (
              <LiveImage data={img} style={StyleSheet.absoluteFill} />
            ) : (
              <View style={styles.center}>
                <Broadcast size={44} color={C.slate} weight="duotone" />
                <Text style={{ color: '#8894A3', marginTop: 10, fontWeight: '600' }}>Connecting…</Text>
              </View>
            )}
          </View>
        ) : (
          <LiveControl data={img} onInput={sendInput} ctrlMode={ctrlMode} onTap={() => (controls ? setControls(false) : showCtl())} />
        )}

        {controls || trackpad ? (
          <>
            <SafeAreaView style={styles.top} edges={['top']} pointerEvents="box-none">
              <FloatBtn icon={X} onPress={stop} />
              <View style={styles.liveChip}>
                <View style={styles.dot} />
                <Text style={styles.liveTxt}>LIVE</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <FloatBtn icon={DownloadSimple} onPress={saveShot} />
                <FloatBtn icon={ImageIcon} onPress={() => send('screenshot')} />
              </View>
            </SafeAreaView>
            <SafeAreaView style={styles.bottom} edges={['bottom']} pointerEvents="box-none">
              <FloatBtn icon={CursorClick} label="Control" active={ctrlMode} onPress={() => { setCtrlMode((m) => !m); showCtl(); }} />
              <FloatBtn icon={Cursor} label="Pad" active={trackpad} onPress={() => { setTrackpad((t) => !t); showCtl(); }} />
              <FloatBtn icon={KeyboardIcon} label="Keys" active={kb} onPress={() => { setKb((k) => !k); showCtl(); }} />
              <FloatBtn icon={Stop} label="Stop" danger onPress={stop} />
            </SafeAreaView>
          </>
        ) : null}

        {kb ? (
          <TextInput autoFocus value="" onKeyPress={onKey} onChangeText={() => {}} placeholder="Keys → laptop" placeholderTextColor="#7C8794" style={styles.kbFs} />
        ) : null}
        {!controls && !trackpad ? (
          <View style={styles.hint}>
            <Text style={styles.hintTxt}>
              {ctrlMode ? 'Tap = click · 2-finger tap = right-click · pinch = zoom · 2-finger scroll' : 'Pinch = zoom · drag = pan · 2-finger scroll · turn on Control to click'}
            </Text>
          </View>
        ) : null}
      </View>
    );
  }

  // ---------- NORMAL ----------
  return (
    <Wrap title="Screen" subtitle="Live view & control" scroll={false}>
      <View style={styles.stage} onLayout={onLayout}>
        {img ? (
          <Pressable style={styles.frame} onPress={() => setZoom(true)}>
            <Image source={{ uri: 'data:image/jpeg;base64,' + img }} style={styles.frame} resizeMode="contain" fadeDuration={0} />
          </Pressable>
        ) : (
          <View style={styles.center}>
            <Broadcast size={40} color={C.slate} weight="duotone" />
            <Text style={{ color: '#93A0AE', marginTop: 10, fontWeight: '600' }}>{canAct ? 'Take a screenshot or go live' : 'Device offline'}</Text>
          </View>
        )}
      </View>
      {zoom && img ? <ZoomView uri={img} onClose={() => setZoom(false)} /> : null}
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
        <Btn label="Screenshot" icon={ImageIcon} onPress={() => send('screenshot')} disabled={!canAct} />
        <Btn label="Go live" icon={Broadcast} color={C.blue} filled onPress={goLive} disabled={!canAct} />
      </View>
      <View style={{ flexDirection: 'row', marginTop: 10 }}>
        <Btn
          label={casting ? 'Stop casting my phone' : 'Cast my phone → PC'}
          icon={casting ? Stop : DeviceMobile}
          color={casting ? C.red : C.violet}
          filled
          onPress={casting ? stopCasting : startCasting}
          disabled={!canAct}
        />
      </View>
      <View style={{ flexDirection: 'row', marginTop: 10 }}>
        <Btn label="Keyboard & mouse (no video)" icon={CursorClick} onPress={() => nav.navigate('Control')} disabled={!canAct} />
      </View>
      {img ? (
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
          <Btn label="Save to gallery" icon={DownloadSimple} onPress={saveShot} />
          <Btn label="Copy" icon={Copy} onPress={copyShot} />
        </View>
      ) : null}
      <Text style={[T.muted, { textAlign: 'center', marginTop: 12 }]}>Tap a screenshot to zoom · live opens fullscreen.</Text>
    </Wrap>
  );
}

// ZoomView: fullscreen pinch-to-zoom + pan viewer for a screenshot. Built on the RN
// PanResponder + Animated (no gesture-handler/reanimated dep). ponytail: reads Animated
// values via a listener-kept ref instead of pulling in a gesture lib for one screen.
function ZoomView({ uri, onClose }: { uri: string; onClose: () => void }) {
  const scale = useRef(new Animated.Value(1)).current;
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;
  const cur = useRef({ s: 1, x: 0, y: 0 });
  const startDist = useRef(0);
  const startPan = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const a = scale.addListener(({ value }) => (cur.current.s = value));
    const b = tx.addListener(({ value }) => (cur.current.x = value));
    const c = ty.addListener(({ value }) => (cur.current.y = value));
    return () => { scale.removeListener(a); tx.removeListener(b); ty.removeListener(c); };
  }, [scale, tx, ty]);

  const springHome = () =>
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true }),
      Animated.spring(tx, { toValue: 0, useNativeDriver: true }),
      Animated.spring(ty, { toValue: 0, useNativeDriver: true }),
    ]).start();

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false, // let the close/save buttons take taps
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 2 || Math.abs(g.dy) > 2 || g.numberActiveTouches === 2,
      onPanResponderGrant: () => {
        startDist.current = 0;
        startPan.current = { x: cur.current.x, y: cur.current.y };
      },
      onPanResponderMove: (e, g) => {
        const t = e.nativeEvent.touches;
        if (t.length === 2) {
          const dx = t[0].pageX - t[1].pageX, dy = t[0].pageY - t[1].pageY;
          const dist = Math.hypot(dx, dy);
          if (!startDist.current) startDist.current = dist;
          scale.setValue(Math.max(1, Math.min(5, cur.current.s * (dist / startDist.current))));
          startDist.current = dist;
        } else if (t.length === 1 && cur.current.s > 1) {
          tx.setValue(startPan.current.x + g.dx);
          ty.setValue(startPan.current.y + g.dy);
        }
      },
      onPanResponderRelease: () => {
        if (cur.current.s <= 1.05) springHome();
      },
    })
  ).current;

  const save = async () => {
    const ok = await saveToGallery(uri);
    Alert.alert(ok ? 'Saved' : 'Not saved', ok ? 'Added to your Sentivo album.' : 'Gallery access is needed to save.');
  };
  const shareUri = async () => {
    try {
      const file = new File(Paths.cache, `sentivo-${Date.now()}.jpg`);
      try { if (file.exists) file.delete(); } catch {}
      file.create();
      file.write(uri, { encoding: 'base64' });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri);
    } catch {}
  };

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.zoomBg} {...pan.panHandlers}>
        <Animated.Image
          source={{ uri: 'data:image/jpeg;base64,' + uri }}
          resizeMode="contain"
          fadeDuration={0}
          style={[StyleSheet.absoluteFill, { transform: [{ scale }, { translateX: tx }, { translateY: ty }] }]}
        />
        <SafeAreaView style={styles.top} edges={['top']} pointerEvents="box-none">
          <FloatBtn icon={X} onPress={onClose} />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <FloatBtn icon={Export} onPress={shareUri} />
            <FloatBtn icon={DownloadSimple} onPress={save} />
          </View>
        </SafeAreaView>
        <View style={styles.zoomHint} pointerEvents="none">
          <Text style={styles.hintTxt}>Pinch to zoom · drag to pan</Text>
        </View>
      </View>
    </Modal>
  );
}

function FloatBtn({ icon: Icon, label, onPress, danger, active }: any) {
  const bg = danger ? C.red : active ? C.blue : 'rgba(14,20,27,0.74)';
  return (
    <Bounce onPress={onPress} style={[styles.fbtn, { backgroundColor: bg }, label ? { paddingHorizontal: 15 } : null]}>
      <Icon size={19} color="#fff" weight="bold" />
      {label ? <Text style={styles.fbtnLabel}>{label}</Text> : null}
    </Bounce>
  );
}

function Btn({ label, icon: Icon, onPress, color = C.ink, filled, disabled }: any) {
  return (
    <Bounce
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.btn,
        filled ? { backgroundColor: color } : { backgroundColor: C.card, borderWidth: 1, borderColor: C.line },
        disabled && { opacity: 0.4 },
      ]}
    >
      <Icon size={18} color={filled ? '#fff' : color} weight="bold" />
      <Text style={{ color: filled ? '#fff' : C.ink, fontWeight: '700', fontSize: 13.5 }}>{label}</Text>
    </Bounce>
  );
}

const styles = StyleSheet.create({
  fs: { flex: 1, backgroundColor: '#0A0E14' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 6 },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingBottom: 16 },
  fbtn: { minWidth: 44, height: 44, borderRadius: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 12 },
  fbtnLabel: { color: '#fff', fontWeight: '700', fontSize: 13 },
  liveChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.blue, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 },
  dot: { width: 7, height: 7, borderRadius: 7, backgroundColor: '#fff' },
  liveTxt: { color: '#fff', fontWeight: '800', fontSize: 11, letterSpacing: 0.4 },
  kbFs: { position: 'absolute', bottom: 78, left: 16, right: 16, height: 46, backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: 14, paddingHorizontal: 14, fontSize: 15, color: C.ink },
  hint: { position: 'absolute', top: 14, alignSelf: 'center', backgroundColor: 'rgba(14,20,27,0.6)', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999 },
  hintTxt: { color: '#fff', fontSize: 12, fontWeight: '600' },
  zoomBg: { flex: 1, backgroundColor: '#000' },
  zoomHint: { position: 'absolute', bottom: 40, alignSelf: 'center', backgroundColor: 'rgba(14,20,27,0.6)', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999 },
  stage: { flex: 1, backgroundColor: '#0E141B', borderRadius: 18, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  frame: { width: '100%', height: '100%' },
  btn: { flex: 1, height: 50, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
});
