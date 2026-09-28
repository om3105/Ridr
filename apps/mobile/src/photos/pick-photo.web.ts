import { getDocumentAsync } from 'expo-document-picker';
import type { PhotoFile } from './api';

export async function pickPhoto(): Promise<PhotoFile | null> {
  const result = await getDocumentAsync({ type: 'image/*', multiple: false });
  if (result.canceled) return null;
  const asset = result.assets[0]!;
  if (!asset.file || !['image/jpeg', 'image/png', 'image/webp'].includes(asset.file.type) ||
      asset.file.size === 0 || asset.file.size > 10 * 1024 * 1024)
    throw new Error('Choose a JPEG, PNG or WebP photo no larger than 10 MB.');
  return { uri: asset.uri, name: asset.name, type: asset.file.type as PhotoFile['type'], file: asset.file };
}
export function discardPhoto(_file: PhotoFile | null) {
  /* The browser owns the selected File. */
}
