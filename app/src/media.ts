import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

const ALBUM = 'Sentivo';

// saveToGallery writes base64 jpeg to a temp file and files it under the Sentivo album.
// Returns true on success. expo-media-library is native-only (its ExpoMediaLibraryNext
// module doesn't exist on web), so we guard for web and lazy-require it — importing it at
// module top level would crash the whole app anywhere the native module is absent.
export async function saveToGallery(b64: string): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    // SDK 57: use the Album/Asset classes (saveToLibraryAsync throws now).
    const { Album, Asset, requestPermissionsAsync } = require('expo-media-library');
    const perm = await requestPermissionsAsync(true); // writeOnly
    if (!perm.granted) return false;
    const file = new File(Paths.cache, `sentivo-${Date.now()}.jpg`);
    try {
      if (file.exists) file.delete();
    } catch {}
    file.create();
    file.write(b64, { encoding: 'base64' });
    const existing = await Album.get(ALBUM);
    if (existing) {
      await Asset.create(file.uri, existing);
    } else {
      const asset = await Asset.create(file.uri);
      await Album.create(ALBUM, [asset]);
    }
    return true;
  } catch {
    return false;
  }
}
