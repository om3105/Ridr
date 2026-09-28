import { getDocumentAsync } from 'expo-document-picker';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Image } from 'react-native';
import type { PhotoFile } from './api';

export async function pickPhoto(): Promise<PhotoFile | null> {
  const result = await getDocumentAsync({ type: 'image/*', copyToCacheDirectory: true, multiple: false });
  if (result.canceled) return null;
  const asset = result.assets[0]!;
  const cached = new File(asset.uri);
  const type = asset.mimeType;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(type ?? '') ||
      cached.size === 0 || cached.size > 10 * 1024 * 1024) {
    if (cached.exists) cached.delete();
    throw new Error('Choose a JPEG, PNG or WebP photo no larger than 10 MB.');
  }
  try {
    const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) =>
      Image.getSize(asset.uri, (width, height) => resolve({ width, height }), reject));
    const manipulator = ImageManipulator.manipulate(asset.uri);
    if (Math.max(dimensions.width, dimensions.height) > 2048)
      manipulator.resize(dimensions.width >= dimensions.height
        ? { width: 2048, height: null } : { width: null, height: 2048 });
    const rendered = await manipulator.renderAsync();
    for (const compress of [0.82, 0.68, 0.52]) {
      const result = await rendered.saveAsync({ format: SaveFormat.JPEG, compress });
      const output = new File(result.uri);
      if (output.size > 0 && output.size <= 2 * 1024 * 1024) {
        if (cached.exists) cached.delete();
        return { uri: result.uri, name: 'ride-photo.jpg', type: 'image/jpeg' };
      }
      if (output.exists) output.delete();
    }
  } catch {
    if (cached.exists) cached.delete();
    throw new Error('This photo could not be prepared. Choose another JPEG, PNG or WebP image.');
  }
  if (cached.exists) cached.delete();
  throw new Error('The compressed photo is still too large. Choose a smaller image.');
}
export function discardPhoto(file: PhotoFile | null) {
  if (!file) return;
  const cached = new File(file.uri);
  if (cached.exists) cached.delete();
}
