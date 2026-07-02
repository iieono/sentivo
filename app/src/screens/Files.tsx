import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { ArrowLeft, ArrowUUpLeft, CaretRight, DownloadSimple, File as FileIcon, Folder, Rocket, UploadSimple } from 'phosphor-react-native';
import { Row, T } from '../ui';
import { Bounce } from '../anim';
import { ensureAuth } from '../auth';
import { saveToGallery } from '../media';
import { useBackHandler } from '../useBack';
import { C, tint } from '../theme';
import { Msg, useConn } from '../conn';

type Entry = { name: string; dir: boolean; size: number };

const fmtSize = (b: number) => {
  if (b <= 0) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0, n = b;
  while (n >= 1024 && i < 3) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
};

export default function Files() {
  const { send, sendFile, subscribe, status } = useConn();
  const nav = useNavigation<any>();
  const [path, setPath] = useState('');
  const [up, setUp] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ name: string; data: string } | null>(null);

  useEffect(
    () =>
      subscribe((m: Msg) => {
        if (m.Action === 'ls' && m.Text) {
          try {
            const r = JSON.parse(m.Text);
            setPath(r.path || '');
            setUp(r.up || '');
            setEntries(r.entries || []);
          } catch {}
          setLoading(false);
        } else if (m.Kind === 'file' && m.Data) {
          // images open in a temporary in-app preview (view without saving); everything else shares/saves
          if (isImage(m.Text || '')) { setPreview({ name: m.Text || 'image', data: m.Data }); setDownloading(null); }
          else save(m.Text || 'file', m.Data);
        }
      }),
    [subscribe]
  );

  const open = useCallback((p: string) => { setLoading(true); send('ls', p); }, [send]);
  useFocusEffect(useCallback(() => { if (status === 'connected') open(''); }, [status, open]));

  // hardware back: close a preview, else climb one folder, else leave the screen (at This PC).
  useBackHandler(useCallback(() => {
    if (preview) { setPreview(null); return true; }
    if (path) { open(up); return true; }
    return false;
  }, [preview, path, up, open]));

  const save = async (name: string, b64: string) => {
    try {
      const safe = name.replace(/[\\/:*?"<>|]/g, '_') || 'file';
      const file = new File(Paths.cache, safe);
      try { if (file.exists) file.delete(); } catch {}
      file.create();
      file.write(b64, { encoding: 'base64' });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri);
    } catch {}
    setDownloading(null);
  };

  const join = (name: string) => (path ? (path.endsWith('\\') ? path + name : `${path}\\${name}`) : name);
  const download = (name: string) => { setDownloading(name); send('get', join(name)); };
  const isExe = (name: string) => /\.(exe|lnk|bat|cmd|url)$/i.test(name);
  const isImage = (name: string) => /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(name);
  const launch = async (name: string) => { if (await ensureAuth('Launch ' + name)) send('launch', join(name)); };

  const upload = async () => {
    const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.length) return;
    const a = res.assets[0];
    if (a.size && a.size > 20 * 1024 * 1024) {
      Alert.alert('Too big', 'Files up to 20 MB can be uploaded.');
      return;
    }
    try {
      const b64 = await new File(a.uri).base64();
      sendFile(a.name, b64);
      Alert.alert('Uploading', `${a.name} → laptop's Downloads\\Sentivo`);
      setTimeout(() => open(path), 900); // refresh so it shows up if we're in that folder
    } catch {
      Alert.alert('Upload failed', 'Could not read that file.');
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.canvas }} edges={['top']}>
      <View style={{ padding: 18, paddingBottom: 6 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Row style={{ gap: 12, flex: 1 }}>
            <Bounce onPress={() => nav.goBack()} style={{ padding: 2 }}><ArrowLeft size={22} color={C.ink} weight="bold" /></Bounce>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 22, fontWeight: '800', color: C.ink, letterSpacing: -0.4 }}>Files</Text>
              <Text style={T.muted} numberOfLines={1}>{path || 'This PC · all drives'}</Text>
            </View>
          </Row>
          <Row style={{ gap: 8 }}>
            <Bounce onPress={upload} style={styles.upBtn}>
              <UploadSimple size={18} color={C.blue} weight="bold" />
            </Bounce>
            <Bounce onPress={() => up && up !== path && open(up)} style={styles.upBtn}>
              <ArrowUUpLeft size={18} color={C.ink} weight="bold" />
            </Bounce>
          </Row>
        </Row>
      </View>

      {downloading ? (
        <View style={styles.dlBanner}>
          <ActivityIndicator size="small" color={C.blue} />
          <Text style={{ color: C.ink, fontWeight: '700', fontSize: 13, flex: 1 }} numberOfLines={1}>Downloading {downloading}…</Text>
        </View>
      ) : null}

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={C.slate} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 18, paddingTop: 4, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          {entries.map((e) => (
            <Bounce
              key={e.name}
              scaleTo={0.98}
              onPress={() => (e.dir ? open(join(e.name)) : isExe(e.name) ? launch(e.name) : download(e.name))}
              style={styles.row}
            >
              <View style={[styles.ic, { backgroundColor: tint(e.dir ? C.amber : isExe(e.name) ? C.violet : C.blue, 0.13) }]}>
                {e.dir ? <Folder size={20} color={C.amber} weight="fill" /> : isExe(e.name) ? <Rocket size={19} color={C.violet} weight="fill" /> : <FileIcon size={19} color={C.blue} weight="duotone" />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: C.ink }} numberOfLines={1}>{e.name}</Text>
                {!e.dir && e.size > 0 ? <Text style={T.muted}>{isExe(e.name) ? 'tap to launch' : fmtSize(e.size)}</Text> : null}
              </View>
              {e.dir ? (
                <CaretRight size={17} color={C.muted} weight="bold" />
              ) : isExe(e.name) ? (
                <Rocket size={17} color={C.violet} weight="bold" />
              ) : downloading === e.name ? (
                <ActivityIndicator size="small" color={C.blue} />
              ) : (
                <DownloadSimple size={18} color={C.muted} weight="bold" />
              )}
            </Bounce>
          ))}
          {entries.length === 0 ? <Text style={[T.muted, { textAlign: 'center', marginTop: 30 }]}>Empty folder</Text> : null}
        </ScrollView>
      )}

      <Modal visible={!!preview} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setPreview(null)}>
        <View style={styles.pv}>
          {preview ? <Image source={{ uri: 'data:image;base64,' + preview.data }} style={StyleSheet.absoluteFill} resizeMode="contain" fadeDuration={0} /> : null}
          <SafeAreaView style={styles.pvBar} edges={['top']}>
            <Pressable onPress={() => setPreview(null)} style={styles.pvBtn}><ArrowLeft size={20} color="#fff" weight="bold" /></Pressable>
            <Text style={styles.pvName} numberOfLines={1}>{preview?.name}</Text>
            <Pressable
              onPress={() => preview && saveToGallery(preview.data).then((ok) => Alert.alert(ok ? 'Saved' : 'Not saved', ok ? 'Added to your gallery.' : 'Gallery access is needed.'))}
              style={styles.pvBtn}
            >
              <DownloadSimple size={20} color="#fff" weight="bold" />
            </Pressable>
          </SafeAreaView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  upBtn: { width: 38, height: 38, borderRadius: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  dlBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 18, marginBottom: 6, backgroundColor: tint(C.blue, 0.1), borderRadius: 12, paddingVertical: 11, paddingHorizontal: 14 },
  pv: { flex: 1, backgroundColor: '#000' },
  pvBar: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingTop: 6 },
  pvBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(14,20,27,0.74)', alignItems: 'center', justifyContent: 'center' },
  pvName: { flex: 1, color: '#fff', fontWeight: '700', fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.line, paddingVertical: 11, paddingHorizontal: 12, marginBottom: 8 },
  ic: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
