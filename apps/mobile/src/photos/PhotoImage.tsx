import { useEffect, useState } from 'react';
import { Image, Text } from 'react-native';
import { useAuth } from '../auth/provider';
import { apiUrl } from '../connection';
import { photoContentUrl, type RidePhoto } from './api';
import { photoDataUri } from './base64';

export default function PhotoImage({ photo }: { photo: RidePhoto }) {
  const auth = useAuth();
  const token = auth.session?.access_token;
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    void fetch(photoContentUrl(apiUrl, photo.rideId, photo.id), {
      headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: 'no-store',
    }).then(async (response) => {
      if (!response.ok || response.headers.get('content-type') !== 'image/jpeg')
        throw new Error('Photo unavailable.');
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length === 0 || bytes.length > 2 * 1024 * 1024) throw new Error('Photo unavailable.');
      if (!controller.signal.aborted) setUri(photoDataUri(bytes));
    }).catch(() => { if (!controller.signal.aborted) setUri(null); });
    return () => { controller.abort(); setUri(null); };
  }, [photo.id, photo.rideId, token]);
  if (!uri) return <Text>Photo unavailable or loading.</Text>;
  return <Image
    source={{ uri }}
    style={{ width: '100%', height: 220, borderRadius: 12 }}
    resizeMode="cover"
    accessibilityLabel={`Ride photo by ${photo.authorName}`}
  />;
}
