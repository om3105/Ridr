import { getDocumentAsync } from 'expo-document-picker';
import type { RouteDraft } from './api';
export async function pickGpx(): Promise<RouteDraft['file']> {
  const result = await getDocumentAsync({ type: '*/*', multiple: false });
  if (result.canceled) return null;
  const asset = result.assets[0]!;
  if (
    !/\.gpx$/i.test(asset.name) ||
    !asset.file ||
    asset.file.size > 5 * 1024 * 1024 ||
    asset.file.size === 0
  )
    throw new Error('Choose a nonempty .gpx file no larger than 5 MB.');
  return { name: asset.name, uri: asset.uri, file: asset.file };
}
export function discardGpx(_file: RouteDraft['file']) {
  /* Browser owns the selected File. */
}
