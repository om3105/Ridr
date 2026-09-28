import { randomUUID } from 'expo-crypto';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { Button, Notice, styles } from '../auth/components';
import GroupMap from '../group-map/GroupMap';
import { RideError } from '../rides/api';
import { useRides } from '../rides/provider';
import { useMotionCheck } from '../rides/use-motion-check';
import { useScreenTask } from '../rides/use-screen-task';
import RouteMap from '../routes/RouteMap';
import { summaryTraceGeometry, type RideSummary } from '../summary/api';
import { deletePhoto, listPhotos, uploadPhoto, type PhotoFile, type RidePhoto } from './api';
import PhotoImage from './PhotoImage';
import { discardPhoto, pickPhoto } from './pick-photo';

type Point = { lat: number; lon: number };

export default function PhotoSection({ summary }: { summary: RideSummary }) {
  const { run } = useRides();
  const capture = useScreenTask();
  const motion = useMotionCheck();
  const [photos, setPhotos] = useState<RidePhoto[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [point, setPoint] = useState<Point | null>(null);
  const [draft, setDraft] = useState<{ id: string; file: PhotoFile } | null>(null);
  const [pending, setPending] = useState<{ id: string; file: PhotoFile; point: Point } | null>(null);
  const fileRef = useRef<PhotoFile | null>(null);
  const sequence = useRef(0);
  const candidates = summary.routePoints.length ? summary.routePoints : summary.trace.segments.flat();
  const cleanup = useCallback(() => {
    try { discardPhoto(fileRef.current); } catch { /* Device cache cleanup can retry later. */ }
    fileRef.current = null;
  }, []);
  useEffect(() => () => cleanup(), [cleanup]);
  const refresh = useCallback(async (next?: string) => {
    const current = capture();
    const request = ++sequence.current;
    try {
      const result = await run((options) => listPhotos(options, summary.rideId, next));
      if (!current() || request !== sequence.current) return;
      setPhotos((previous) => next
        ? [...new Map([...previous, ...result.items].map((item) => [item.id, item])).values()]
        : result.items);
      setCursor(result.nextCursor);
      setLoaded(true);
    } catch (error) {
      if (!current() || request !== sequence.current) return;
      setPhotos([]);
      setCursor(null);
      setLoaded(false);
      setMessage(error instanceof Error ? error.message : 'Photos are unavailable.');
    }
  }, [capture, run, summary.rideId]);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  const choose = async () => {
    if (busy || pending) return;
    setBusy(true);
    try {
      const file = await pickPhoto();
      if (!file) return;
      cleanup();
      fileRef.current = file;
      setDraft({ id: randomUUID(), file });
      setMessage('Photo selected. Choose a route point, check you are stopped, then upload.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not open the photo.');
    } finally { setBusy(false); }
  };
  const cancel = () => {
    const uncertain = !!pending;
    cleanup();
    setDraft(null);
    setPending(null);
    setMessage(uncertain
      ? 'Photo selection discarded. Refresh photos to check whether the earlier upload completed.'
      : 'Photo selection canceled. Nothing was shared.');
  };
  const send = async () => {
    if (!draft || !point || busy) return;
    setBusy(true);
    try {
      const proof = motion.latest();
      const command = pending ?? { id: draft.id, file: draft.file, point };
      setPending(command);
      await run((options) => uploadPhoto(options, summary.rideId, {
        photoId: command.id, file: command.file, routePoint: command.point, motion: proof,
      }));
      cleanup();
      setDraft(null);
      setPending(null);
      setMessage('Photo added to the completed ride.');
      await refresh();
    } catch (error) {
      setMessage(error instanceof RideError && error.unconfirmed
        ? 'Upload status is unconfirmed. Check you are stopped again and retry this same photo.'
        : error instanceof Error ? `${error.message} Your photo selection is still here.`
          : 'Upload failed. Your photo selection is still here.');
    } finally { setBusy(false); }
  };
  const remove = async (photoId: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await run((options) => deletePhoto(options, summary.rideId, photoId));
      setPhotos((previous) => previous.filter((photo) => photo.id !== photoId));
      setMessage('Your photo was removed.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Photo removal is unconfirmed. Refresh to check.');
    } finally { setBusy(false); }
  };
  return (
    <View style={{ gap: 12 }}>
      <Text style={styles.cardTitle}>Ride photos</Text>
      <Text style={styles.detail}>Photos are shared only with this completed ride’s participants.</Text>
      {!!message && <Notice>{message}</Notice>}
      {Platform.OS !== 'web' && candidates.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Add a photo</Text>
          <Text style={styles.detail}>Tap a point on the completed route, or choose a route marker below.</Text>
          {summary.routePoints.length ? (
            <RouteMap points={summary.routePoints} waypoints={point ? [point] : []}
              onPoint={pending ? undefined : setPoint} />
          ) : (
            <GroupMap data={{ type: 'FeatureCollection', features: [] }}
              trail={summaryTraceGeometry(summary)}
              pins={point ? [{ id: 'selected', ...point }] : []}
              onPinSelect={pending ? undefined : setPoint} />
          )}
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {(['Start', 'Middle', 'Finish'] as const).map((label, index) => (
              <Button key={label} label={label} secondary busy={busy || !!pending}
                onPress={() => setPoint(candidates[[0, Math.floor((candidates.length - 1) / 2), candidates.length - 1][index]!]!)} />
            ))}
          </View>
          {point && <Text style={styles.detail}>Selected route point: {point.lat.toFixed(5)}, {point.lon.toFixed(5)}</Text>}
          <Button label="Choose photo" secondary busy={busy || !!pending} onPress={() => void choose()} />
          {draft && <Text style={styles.detail}>Selected: {draft.file.name}</Text>}
          {draft && !motion.ready && <Button label="Check that you are stopped" secondary
            busy={motion.checking} onPress={() => void motion.check()} />}
          {!!motion.message && <Notice>{motion.message}</Notice>}
          {draft && point && <Button label={pending ? 'Retry photo upload' : 'Upload photo'}
            busy={busy || !motion.ready} onPress={() => void send()} />}
          {draft && <Button label="Cancel selected photo" secondary busy={busy} onPress={cancel} />}
        </View>
      )}
      {Platform.OS !== 'web' && candidates.length === 0 &&
        <Notice>No completed route points are available for attaching a photo.</Notice>}
      {Platform.OS === 'web' && <Notice>Open the Android or iOS app to add a photo.</Notice>}
      {loaded && photos.length === 0 && <Notice>No photos have been shared for this ride.</Notice>}
      {photos.map((photo) => (
        <View key={photo.id} style={styles.card}>
          <PhotoImage photo={photo} />
          <Text style={styles.detail}>{photo.authorName} · {new Date(photo.createdAt).toLocaleString()}</Text>
          <Text style={styles.detail}>Pinned at {photo.routePoint.lat.toFixed(5)}, {photo.routePoint.lon.toFixed(5)}</Text>
          {photo.own && <Button label="Remove my photo" secondary busy={busy}
            onPress={() => void remove(photo.id)} />}
        </View>
      ))}
      {cursor && <Button label="Load more photos" secondary busy={busy}
        onPress={() => void refresh(cursor)} />}
      <Button label="Refresh photos" secondary busy={busy} onPress={() => void refresh()} />
    </View>
  );
}
