import { useEffect, useState } from 'react';
import { Image, Text } from 'react-native';
import { useAuth } from '../auth/provider';
import { apiUrl } from '../connection';
import { photoContentUrl, type RidePhoto } from './api';

export default function PhotoImage({ photo }: { photo: RidePhoto }) {
  const auth = useAuth();
  const token = auth.session?.access_token;
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    let temporary: string | null = null;
    void fetch(photoContentUrl(apiUrl, photo.rideId, photo.id), {
      headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
      cache: 'no-store',
    }).then(async (response) => {
      if (!response.ok || response.headers.get('content-type') !== 'image/jpeg')
        throw new Error('Photo unavailable.');
      const blob = await response.blob();
      if (blob.size === 0 || blob.size > 2 * 1024 * 1024) throw new Error('Photo unavailable.');
      return blob;
    }).then((blob) => {
      if (controller.signal.aborted) return;
      temporary = URL.createObjectURL(blob);
      setUrl(temporary);
    }).catch(() => { if (!controller.signal.aborted) setUrl(null); });
    return () => {
      controller.abort();
      if (temporary) URL.revokeObjectURL(temporary);
      setUrl(null);
    };
  }, [photo.id, photo.rideId, token]);
  if (!url) return <Text>Photo unavailable or loading.</Text>;
  return <Image source={{ uri: url }} style={{ width: '100%', height: 220, borderRadius: 12 }}
    resizeMode="cover" accessibilityLabel={`Ride photo by ${photo.authorName}`} />;
}
