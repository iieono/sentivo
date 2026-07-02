import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Polygon, Polyline } from 'react-native-svg';
import { useFocusEffect, useNavigation } from '@react-navigation/native';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
import {
  AppWindow,
  ArrowClockwise,
  BatteryHigh,
  Bell,
  Broadcast,
  Camera,
  Clipboard,
  ClipboardText,
  Clock,
  Cpu,
  Folder,
  GraphicsCard,
  HardDrives,
  Image as ImageIcon,
  Lock,
  LockOpen,
  Microphone,
  MicrophoneSlash,
  MoonStars,
  MusicNotes,
  Pause,
  Play,
  Power,
  SkipBack,
  SkipForward,
  SpeakerSimpleHigh,
  SpeakerSimpleLow,
  SpeakerSimpleX,
  ShieldCheck,
  SignOut,
  TerminalWindow,
  Thermometer,
  WifiHigh,
} from 'phosphor-react-native';
import * as ClipAPI from 'expo-clipboard';
import { Card, Dot, Row, Screen as Wrap, T } from '../ui';
import { Bounce, Rise } from '../anim';
import { Sheet, SheetHeader, SheetRow } from '../Sheet';
import { ensureAuth } from '../auth';
import { C, tint } from '../theme';
import { Msg, useConn } from '../conn';

type DiskE = { drive: string; used: number; total: number; pct: number };
type Stat = {
  host: string; cpu: number; ramUsed: number; ramTotal: number; ramPct: number;
  diskUsed: number; diskTotal: number; diskPct: number; uptime: number;
  battery: number; charging: boolean; locked: boolean;
  armed: boolean; mic: boolean; cam: boolean; clip: boolean; notify: boolean; visible: boolean;
  gpu: number; cpuTemp: number; gpuTemp: number; wifi: { ssid: string; signal: number; connected: boolean }; disks: DiskE[];
};

const ACTIONS: { key: string; label: string; icon: any; color: string; nav?: string }[] = [
  { key: 'screenshot', label: 'Screenshot', icon: ImageIcon, color: C.blue, nav: 'Screen' },
  { key: 'stream', label: 'Live screen', icon: Broadcast, color: C.blue, nav: 'Screen' },
  { key: 'photo', label: 'Camera', icon: Camera, color: C.violet },
  { key: 'lock', label: 'Lock', icon: Lock, color: C.slate },
  { key: 'clip', label: 'Clipboard', icon: Clipboard, color: C.emerald, nav: 'Clipboard' },
  { key: 'paste', label: 'Paste', icon: ClipboardText, color: C.violet },
  { key: 'ps', label: 'Processes', icon: Cpu, color: C.amber, nav: 'Processes' },
  { key: 'files', label: 'Files', icon: Folder, color: C.amber, nav: 'Files' },
  { key: 'terminal', label: 'Terminal', icon: TerminalWindow, color: C.slate, nav: 'Terminal' },
  { key: 'apps', label: 'Apps', icon: AppWindow, color: C.blue, nav: 'Apps' },
  { key: 'network', label: 'Network', icon: WifiHigh, color: C.emerald, nav: 'Network' },
  { key: 'media', label: 'Media', icon: MusicNotes, color: C.violet },
  { key: 'power', label: 'Power', icon: Power, color: C.red },
];

function heat(pct: number, base: string) {
  return pct >= 85 ? C.red : pct >= 65 ? C.amber : base;
}
const tempC = (t: number) => (t >= 80 ? C.red : t >= 65 ? C.amber : C.slate);
const GPU_C = '#EC4899';

// metricInfo resolves a metric key (cpu/ram/gpu/disk:<drive>) to its detail-sheet display.
function metricInfo(key: string, stat: Stat | null) {
  if (key === 'cpu') return { title: 'CPU', sub: `${stat?.cpu ?? 0}% right now`, color: C.blue };
  if (key === 'ram') return { title: 'Memory', sub: stat ? `${stat.ramUsed.toFixed(1)} / ${stat.ramTotal.toFixed(0)} GB · ${stat.ramPct}%` : '', color: C.violet };
  if (key === 'gpu') return { title: 'GPU', sub: stat ? `${stat.gpu}% right now${stat.gpuTemp > 0 ? `  ·  ${stat.gpuTemp}°C` : ''}` : '', color: GPU_C };
  const drive = key.slice(5);
  const d = stat?.disks?.find((x) => x.drive === drive);
  if (d) return { title: `Disk ${drive}`, sub: `${d.used.toFixed(0)} / ${d.total.toFixed(0)} GB · ${d.pct}%`, color: C.emerald };
  return { title: 'Disk', sub: stat ? `${stat.diskUsed.toFixed(0)} / ${stat.diskTotal.toFixed(0)} GB · ${stat.diskPct}%` : '', color: C.emerald };
}
function fmtUp(sec: number) {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function Ring({ pct, color, label, sub, onPress }: { pct: number; color: string; label: string; sub?: string; onPress?: () => void }) {
  const size = 78, sw = 8, r = (size - sw) / 2, c = 2 * Math.PI * r;
  const anim = useRef(new Animated.Value(pct)).current;
  const pop = useRef(new Animated.Value(1)).current;
  const [display, setDisplay] = useState(pct);
  useEffect(() => {
    const id = anim.addListener(({ value }) => setDisplay(Math.round(value)));
    Animated.timing(anim, { toValue: pct, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    pop.setValue(0); // loot-roll: the number pops big + soft, then snaps crisp
    Animated.spring(pop, { toValue: 1, useNativeDriver: true, speed: 12, bounciness: 11 }).start();
    return () => anim.removeListener(id);
  }, [pct, anim, pop]);
  const off = anim.interpolate({ inputRange: [0, 100], outputRange: [c, 0], extrapolate: 'clamp' });
  const inner = (
    <>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={C.card2} strokeWidth={sw} fill="none" />
          <AnimatedCircle
            cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={sw} fill="none"
            strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </Svg>
        <Animated.View
          style={[
            styles.ringCenter,
            {
              opacity: pop.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }),
              transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [1.22, 1] }) }],
            },
          ]}
        >
          <Text style={{ fontSize: 18, fontWeight: '800', color: C.ink }}>{display}%</Text>
        </Animated.View>
      </View>
      <Text style={{ fontSize: 11.5, fontWeight: '700', color: C.muted, marginTop: 6 }}>{label}</Text>
      {sub ? <Text style={{ fontSize: 10, color: C.muted }}>{sub}</Text> : null}
    </>
  );
  return onPress ? (
    <Bounce onPress={onPress} scaleTo={0.92} style={{ alignItems: 'center', flex: 1 }}>{inner}</Bounce>
  ) : (
    <View style={{ alignItems: 'center', flex: 1 }}>{inner}</View>
  );
}

// LineChart — a simple filled line chart of recent percentages (0..100).
function LineChart({ data, color }: { data: number[]; color: string }) {
  const w = 320, h = 130, pad = 10;
  if (data.length < 2) {
    return (
      <View style={{ height: h, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: C.muted, fontWeight: '600' }}>Collecting history…</Text>
      </View>
    );
  }
  const pt = (v: number, i: number) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = pad + (1 - Math.max(0, Math.min(100, v)) / 100) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  };
  const line = data.map(pt).join(' ');
  const area = `${pad},${h - pad} ${line} ${w - pad},${h - pad}`;
  return (
    <Svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`}>
      <Polygon points={area} fill={tint(color, 0.12)} stroke="none" />
      <Polyline points={line} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
    </Svg>
  );
}

function MediaBtn({ icon: Icon, onPress, big }: { icon: any; onPress: () => void; big?: boolean }) {
  const s = big ? 70 : 56;
  return (
    <Bounce
      onPress={onPress}
      scaleTo={0.9}
      style={{ width: s, height: s, borderRadius: s / 2, backgroundColor: big ? C.dark : C.card2, alignItems: 'center', justifyContent: 'center' }}
    >
      <Icon size={big ? 28 : 23} color={big ? '#fff' : C.ink} weight="fill" />
    </Bounce>
  );
}

function Chip({ icon: Icon, color, text }: any) {
  return (
    <Row style={[styles.chip, { backgroundColor: tint(color, 0.12) }]}>
      <Icon size={15} color={color} weight="bold" />
      <Text style={{ fontSize: 12, fontWeight: '700', color: C.ink }}>{text}</Text>
    </Row>
  );
}

function StateChip({ icon: Icon, label, on }: { icon: any; label: string; on?: boolean }) {
  const col = on ? C.emerald : C.slate;
  return (
    <Row style={[styles.chip, { backgroundColor: tint(col, on ? 0.14 : 0.08) }]}>
      <Icon size={14} color={col} weight={on ? 'fill' : 'regular'} />
      <Text style={{ fontSize: 11.5, fontWeight: '700', color: on ? C.ink : C.muted }}>{label}</Text>
    </Row>
  );
}

export default function Home() {
  const { presence, status, onLan, send, subscribe } = useConn();
  const nav = useNavigation<any>();
  const [armed, setArmed] = useState(false);
  const armTouched = useRef(0); // when the user last tapped Arm/Disarm — statjson won't override for 2.5s
  const [stat, setStat] = useState<Stat | null>(null);
  const [powerSheet, setPowerSheet] = useState(false);
  const [mediaSheet, setMediaSheet] = useState(false);
  const [media, setMedia] = useState<{ title?: string; artist?: string; playing?: boolean }>({});
  const [metric, setMetric] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, number[]>>({});

  // single source of truth: statjson carries device + Sentivo state (armed/sensors).
  useEffect(
    () =>
      subscribe((m: Msg) => {
        if (m.Action === 'statjson' && m.Text) {
          try {
            const s = JSON.parse(m.Text) as Stat;
            setStat(s);
            if (Date.now() - armTouched.current > 2500) setArmed(s.armed); // don't fight a just-tapped toggle
            setHistory((h) => {
              const next: Record<string, number[]> = { ...h };
              const push = (k: string, v: number) => { next[k] = [...(next[k] || []), v].slice(-40); };
              push('cpu', s.cpu);
              push('ram', s.ramPct);
              if (s.gpu >= 0) push('gpu', s.gpu);
              (s.disks || []).forEach((d) => push('disk:' + d.drive, d.pct));
              return next;
            });
          } catch {}
        } else if (m.Action === 'mediastate' && m.Text) {
          try { setMedia(JSON.parse(m.Text)); } catch {}
        }
      }),
    [subscribe]
  );

  // poll now-playing while the Media sheet is open
  useEffect(() => {
    if (!mediaSheet || status !== 'connected') return;
    send('mediastate');
    const id = setInterval(() => send('mediastate'), 2500);
    return () => clearInterval(id);
  }, [mediaSheet, status, send]);

  // realtime status while Home is focused; stops on leave (resource discipline)
  useFocusEffect(
    useCallback(() => {
      if (status !== 'connected') return;
      send('statjson');
      const id = setInterval(() => send('statjson'), 3000);
      return () => clearInterval(id);
    }, [status, send])
  );

  const online = presence === 'online';
  const stateColor = armed ? C.emerald : C.slate;
  const connColor = status === 'connected' ? C.emerald : C.amber;

  // Paste: grab the phone clipboard and drop it straight into the laptop at the cursor.
  const pasteFromPhone = useCallback(async () => {
    const t = await ClipAPI.getStringAsync();
    if (t) send('paste', t);
  }, [send]);

  return (
    <Wrap title="Home" subtitle="Your laptop at a glance">
      <Rise>
      <Card style={{ marginBottom: 14 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Row style={{ gap: 12 }}>
            <View style={[styles.ring, { borderColor: stateColor }]}>
              <ShieldCheck size={26} color={stateColor} weight="fill" />
            </View>
            <View>
              <Text style={{ fontSize: 18, fontWeight: '800', color: C.ink }}>{armed ? 'Armed' : 'Disarmed'}</Text>
              <Row style={{ gap: 6, marginTop: 3 }}>
                <Dot color={online ? C.emerald : C.slate} size={8} />
                <Text style={T.muted}>{stat?.host || (online ? 'Device online' : 'Device offline')}</Text>
              </Row>
            </View>
          </Row>
          <View style={[styles.pill, { backgroundColor: tint(onLan && status === 'connected' ? C.emerald : connColor, 0.14) }]}>
            <Text style={{ fontSize: 11.5, fontWeight: '700', color: onLan && status === 'connected' ? C.emerald : connColor }}>
              {status === 'connected' ? (onLan ? '⚡ Same network' : 'Connected') : status === 'connecting' ? 'Linking…' : 'Offline'}
            </Text>
          </View>
        </Row>
        <Bounce
          onPress={() => {
            const n = !armed;
            armTouched.current = Date.now();
            setArmed(n);
            send(n ? 'arm' : 'disarm');
          }}
          style={[styles.arm, { backgroundColor: armed ? tint(C.slate, 0.1) : C.dark }]}
        >
          <Text style={{ fontSize: 15.5, fontWeight: '800', color: armed ? C.ink : '#fff' }}>{armed ? 'Disarm' : 'Arm'}</Text>
        </Bounce>
      </Card>
      </Rise>

      {/* resources */}
      <Rise delay={70}>
      <Card style={{ marginBottom: 14 }}>
        <Row style={{ justifyContent: 'space-around', marginBottom: 14 }}>
          <Ring pct={stat?.cpu ?? 0} color={heat(stat?.cpu ?? 0, C.blue)} label="CPU" sub={stat && stat.cpuTemp > 0 ? `${stat.cpuTemp}°C` : undefined} onPress={() => setMetric('cpu')} />
          <Ring pct={stat?.ramPct ?? 0} color={heat(stat?.ramPct ?? 0, C.violet)} label="RAM" sub={stat ? `${stat.ramUsed.toFixed(1)}/${stat.ramTotal.toFixed(0)}G` : undefined} onPress={() => setMetric('ram')} />
          {stat && stat.gpu >= 0 ? (
            <Ring pct={stat.gpu} color={heat(stat.gpu, GPU_C)} label="GPU" sub={stat.gpuTemp > 0 ? `${stat.gpuTemp}°C` : undefined} onPress={() => setMetric('gpu')} />
          ) : null}
        </Row>
        {stat && (stat.disks?.length || stat.diskTotal > 0) ? (
          <Row style={{ justifyContent: 'space-around', marginBottom: 14, flexWrap: 'wrap', rowGap: 12 }}>
            {(stat.disks?.length ? stat.disks : [{ drive: 'Disk', used: stat.diskUsed, total: stat.diskTotal, pct: stat.diskPct }]).map((d) => (
              <Ring key={d.drive} pct={d.pct} color={heat(d.pct, C.emerald)} label={d.drive} sub={`${d.used.toFixed(0)}/${d.total.toFixed(0)}G`} onPress={() => setMetric('disk:' + d.drive)} />
            ))}
          </Row>
        ) : null}
        <Row style={{ gap: 8, flexWrap: 'wrap' }}>
          <Chip icon={Clock} color={C.slate} text={stat ? `Up ${fmtUp(stat.uptime)}` : 'Up —'} />
          {stat && stat.battery >= 0 ? (
            <Chip icon={BatteryHigh} color={stat.charging ? C.emerald : stat.battery < 20 ? C.red : C.slate} text={`${stat.battery}%${stat.charging ? ' ⚡' : ''}`} />
          ) : null}
          <Chip icon={stat?.locked ? Lock : LockOpen} color={stat?.locked ? C.amber : C.emerald} text={stat?.locked ? 'Locked' : 'Unlocked'} />
          {stat?.wifi?.connected ? <Chip icon={WifiHigh} color={C.blue} text={`${stat.wifi.ssid || 'Wi-Fi'} · ${stat.wifi.signal}% signal`} /> : null}
        </Row>
      </Card>
      </Rise>

      <Rise delay={110}>
        <Card style={{ marginBottom: 14 }}>
          <Text style={styles.cardTitle}>Sentivo status</Text>
          <Row style={{ gap: 8, flexWrap: 'wrap' }}>
            <StateChip icon={ShieldCheck} label={stat?.armed ? 'Armed' : 'Disarmed'} on={stat?.armed} />
            <StateChip icon={Microphone} label="Mic" on={stat?.mic} />
            <StateChip icon={Camera} label="Camera" on={stat?.cam} />
            <StateChip icon={Clipboard} label="Clip sync" on={stat?.clip} />
            <StateChip icon={Bell} label="Notify" on={stat?.notify} />
          </Row>
        </Card>
      </Rise>

      <Text style={styles.section}>Quick actions</Text>
      <View style={styles.grid}>
        {ACTIONS.map((a) => (
          <Bounce
            key={a.key}
            onPress={() =>
              a.key === 'power'
                ? setPowerSheet(true)
                : a.key === 'media'
                ? setMediaSheet(true)
                : a.key === 'paste'
                ? pasteFromPhone()
                : a.key === 'photo'
                ? (nav.navigate('Screen'), send('photo')) // show the webcam shot in the Screen view
                : a.nav
                ? nav.navigate(a.nav)
                : send(a.key)
            }
            style={styles.tile}
          >
            <View style={[styles.tileIcon, { backgroundColor: tint(a.color, 0.13) }]}>
              <a.icon size={25} color={a.color} weight="duotone" />
            </View>
            <Text style={styles.tileLabel}>{a.label}</Text>
          </Bounce>
        ))}
      </View>

      <Sheet visible={!!metric} onClose={() => setMetric(null)}>
        {metric ? (
          <>
            <SheetHeader title={metricInfo(metric, stat).title} subtitle={metricInfo(metric, stat).sub} />
            <LineChart data={history[metric] || []} color={metricInfo(metric, stat).color} />
            <Text style={{ color: C.muted, fontSize: 12, textAlign: 'center', marginTop: 10 }}>
              Last {(history[metric] || []).length} samples · live
            </Text>
          </>
        ) : null}
      </Sheet>

      <Sheet visible={powerSheet} onClose={() => setPowerSheet(false)}>
        <SheetHeader title="Power" subtitle="Control your laptop" />
        <SheetRow icon={Lock} color={C.slate} label="Lock screen" onPress={() => { setPowerSheet(false); send('lock'); }} />
        <SheetRow icon={MoonStars} color={C.slate} label="Sleep" hint="Suspend the PC" onPress={() => { setPowerSheet(false); send('sleep'); }} />
        <SheetRow icon={ArrowClockwise} label="Restart" hint="Confirmed with your fingerprint" danger onPress={async () => { if (await ensureAuth('Restart the laptop')) send('restart'); setPowerSheet(false); }} />
        <SheetRow icon={Power} label="Shut down" hint="Confirmed with your fingerprint" danger onPress={async () => { if (await ensureAuth('Shut down the laptop')) send('shutdown'); setPowerSheet(false); }} />
        <SheetRow icon={SignOut} label="Log off" hint="Confirmed with your fingerprint" danger onPress={async () => { if (await ensureAuth('Log off')) send('logoff'); setPowerSheet(false); }} />
        <View style={{ height: 1, backgroundColor: C.line, marginVertical: 10 }} />
        <Text style={{ fontSize: 11, fontWeight: '800', color: C.muted, letterSpacing: 0.4, marginBottom: 10, marginLeft: 4 }}>PERFORMANCE MODE</Text>
        <Row style={{ gap: 8, flexWrap: 'wrap' }}>
          {[
            { v: 'saver', l: 'Saver' },
            { v: 'balanced', l: 'Balanced' },
            { v: 'high', l: 'Performance' },
            { v: 'gaming', l: '🎮 Gaming' },
          ].map((m) => (
            <Bounce key={m.v} onPress={() => { send('perf', m.v); setPowerSheet(false); }} style={styles.perfChip}>
              <Text style={styles.perfChipT}>{m.l}</Text>
            </Bounce>
          ))}
        </Row>
        <View style={{ height: 1, backgroundColor: C.line, marginVertical: 10 }} />
        <Text style={{ fontSize: 11, fontWeight: '800', color: C.muted, letterSpacing: 0.4, marginBottom: 10, marginLeft: 4 }}>BRIGHTNESS</Text>
        <Row style={{ gap: 8, flexWrap: 'wrap' }}>
          {[25, 50, 75, 100].map((b) => (
            <Bounce key={b} onPress={() => send('brightness', String(b))} style={styles.perfChip}>
              <Text style={styles.perfChipT}>{b}%</Text>
            </Bounce>
          ))}
        </Row>
      </Sheet>

      <Sheet visible={mediaSheet} onClose={() => setMediaSheet(false)}>
        <SheetHeader title="Media" subtitle="Control whatever's playing" />
        {media.title ? (
          <Row style={{ gap: 12, marginBottom: 14, alignItems: 'center' }}>
            <View style={[styles.nowIc, { backgroundColor: tint(C.violet, 0.14) }]}>
              <MusicNotes size={20} color={C.violet} weight="fill" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14.5, fontWeight: '800', color: C.ink }} numberOfLines={1}>{media.title}</Text>
              {media.artist ? <Text style={T.muted} numberOfLines={1}>{media.artist}</Text> : null}
            </View>
            <View style={[styles.nowDot, { backgroundColor: media.playing ? C.emerald : C.slate }]} />
          </Row>
        ) : (
          <Text style={[T.muted, { textAlign: 'center', marginBottom: 12 }]}>Nothing playing</Text>
        )}
        <Row style={{ justifyContent: 'center', gap: 22, marginTop: 4, marginBottom: 6 }}>
          <MediaBtn icon={SkipBack} onPress={() => { send('media', 'prev'); setTimeout(() => send('mediastate'), 500); }} />
          <MediaBtn icon={media.playing ? Pause : Play} big onPress={() => { send('media', 'playpause'); setMedia((x) => ({ ...x, playing: !x.playing })); setTimeout(() => send('mediastate'), 400); }} />
          <MediaBtn icon={SkipForward} onPress={() => { send('media', 'next'); setTimeout(() => send('mediastate'), 500); }} />
        </Row>
        <Row style={{ justifyContent: 'center', gap: 22, marginTop: 10 }}>
          <MediaBtn icon={SpeakerSimpleLow} onPress={() => send('media', 'voldown')} />
          <MediaBtn icon={SpeakerSimpleX} onPress={() => send('media', 'mute')} />
          <MediaBtn icon={SpeakerSimpleHigh} onPress={() => send('media', 'volup')} />
        </Row>
        <Row style={{ justifyContent: 'center', marginTop: 16 }}>
          <Bounce onPress={() => send('micmute')} style={styles.micBtn}>
            <MicrophoneSlash size={17} color={C.ink} weight="bold" />
            <Text style={{ fontWeight: '700', color: C.ink, fontSize: 13.5 }}>Mute / unmute mic</Text>
          </Bounce>
        </Row>
      </Sheet>
    </Wrap>
  );
}

const styles = StyleSheet.create({
  ring: { width: 48, height: 48, borderRadius: 24, borderWidth: 2.5, alignItems: 'center', justifyContent: 'center' },
  ringCenter: { position: 'absolute', width: 78, height: 78, alignItems: 'center', justifyContent: 'center' },
  perfChip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12, backgroundColor: C.card2, borderWidth: 1, borderColor: C.line },
  perfChipT: { fontSize: 13, fontWeight: '700', color: C.ink },
  nowIc: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  nowDot: { width: 9, height: 9, borderRadius: 9 },
  micBtn: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: C.card2, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderColor: C.line },
  pill: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999 },
  arm: { height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  chip: { gap: 6, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 999 },
  section: { fontSize: 13, fontWeight: '700', color: C.muted, marginBottom: 10, marginLeft: 2 },
  cardTitle: { fontSize: 13, fontWeight: '800', color: C.ink, marginBottom: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 11 },
  tile: { width: '22.5%', minWidth: 78, flexGrow: 1, backgroundColor: C.card, borderRadius: 18, paddingVertical: 16, alignItems: 'center', gap: 10, borderWidth: 1, borderColor: C.line },
  tileIcon: { width: 50, height: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { fontSize: 11, fontWeight: '700', color: C.ink },
});
