import { getDocumentAsync } from 'expo-document-picker';
import { File } from 'expo-file-system';
import type { RouteDraft } from './api';
export async function pickGpx(): Promise<RouteDraft['file']> {
  const result = await getDocumentAsync({
    type: '*/*',
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled) return null;
  const asset = result.assets[0]!;
  const cached = new File(asset.uri);
  if (!/\.gpx$/i.test(asset.name) || cached.size > 5 * 1024 * 1024 || cached.size === 0) {
    if (cached.exists) cached.delete();
    throw new Error('Choose a nonempty .gpx file no larger than 5 MB.');
  }
  return { name: asset.name, uri: asset.uri };
}
export function discardGpx(file: RouteDraft['file']) {
  if (file) {
    const cached = new File(file.uri);
    if (cached.exists) cached.delete();
  }
}
