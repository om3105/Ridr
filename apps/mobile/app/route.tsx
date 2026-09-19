import { randomUUID } from 'expo-crypto';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Text } from 'react-native';
import { Button, Notice, Page, styles } from '../src/auth/components';
import { getRideManagement, RideError } from '../src/rides/api';
import type { RideManagement } from '../src/rides/models';
import { RideAccess, useRides } from '../src/rides/provider';
import { useScreenTask } from '../src/rides/use-screen-task';
import { useMotionCheck } from '../src/rides/use-motion-check';
import {
  getRoute,
  saveRoute,
  type RouteDraft,
  type SavedRoute,
  type SaveCommand,
} from '../src/routes/api';
import RouteMap from '../src/routes/RouteMap';
import { discardGpx, pickGpx } from '../src/routes/pick-gpx';
const empty: RouteDraft = { points: [], file: null };
export default function RouteScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return (
    <RideAccess>
      <Planner key={id} id={typeof id === 'string' ? id : ''} />
    </RideAccess>
  );
}
function Planner({ id }: { id: string }) {
  const { run } = useRides();
  const capture = useScreenTask();
  const motion = useMotionCheck();
  const [status, setStatus] = useState<RideManagement | null>(null);
  const [saved, setSaved] = useState<SavedRoute | null>(null);
  const [draft, setDraft] = useState<RouteDraft>(empty);
  const [draftRevision, setDraftRevision] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState<SaveCommand | null>(null);
  const fileRef = useRef<RouteDraft['file']>(null);
  const occupied = useRef(false);
  const cleanup = useCallback(() => {
    try {
      discardGpx(fileRef.current);
    } catch {
      /* Cache cleanup can be retried by the OS. */
    }
    fileRef.current = null;
  }, []);
  useEffect(() => () => cleanup(), [cleanup]);
  const load = useCallback(async () => {
    if (occupied.current || AppState.currentState !== 'active') return;
    occupied.current = true;
    const current = capture();
    try {
      const next = await run((options) => getRideManagement(options, id));
      if (!current()) return;
      setStatus(next);
      if (next.ride.state === 'ended' || next.membership.leftAt) {
        setSaved(null);
        setDraft(empty);
        setPending(null);
        setDraftRevision(null);
        cleanup();
        setMessage('This ride has ended or you have left. Its live route is no longer available.');
        return;
      }
      const route = await run((options) => getRoute(options, id));
      if (current()) setSaved(route);
    } catch (error) {
      if (current()) {
        setStatus(null);
        setSaved(null);
        setMessage(error instanceof Error ? error.message : 'Route could not load.');
      }
    } finally {
      occupied.current = false;
    }
  }, [capture, run, id, cleanup]);
  useFocusEffect(
    useCallback(() => {
      setBusy(false);
      void load();
      const timer = setInterval(() => void load(), 5000);
      return () => clearInterval(timer);
    }, [load]),
  );
  const editable =
    status?.ride.state === 'lobby' &&
    status.membership.role === 'leader' &&
    !status.membership.leftAt;
  async function chooseFile() {
    if (busy || pending || !editable) return;
    const current = capture();
    setBusy(true);
    try {
      motion.latest();
      const file = await pickGpx();
      if (!current()) {
        discardGpx(file);
        return;
      }
      if (file) {
        cleanup();
        fileRef.current = file;
        setDraftRevision(saved?.revision ?? 0);
        setDraft({ points: [], file });
        setMessage(
          'GPX selected. Check that you are stopped again, then import. The server validates the file before replacing your saved route.',
        );
      }
    } catch (error) {
      if (current())
        setMessage(error instanceof Error ? error.message : 'Could not select the GPX.');
    } finally {
      if (current()) setBusy(false);
    }
  }
  async function save() {
    if (occupied.current || busy || !editable) return;
    const current = capture();
    occupied.current = true;
    setBusy(true);
    try {
      const command = pending ?? {
        draft,
        revision: draftRevision ?? saved?.revision ?? 0,
        idempotencyKey: randomUUID(),
        motion: motion.latest(),
      };
      setPending(command);
      const result = await run((options) => saveRoute(options, id, command));
      if (current()) {
        setSaved(result);
        setPending(null);
        setDraft(empty);
        setDraftRevision(null);
        cleanup();
        setMessage('Route saved for the group. Arrows show travel direction.');
      }
    } catch (error) {
      if (current()) {
        if (!(error instanceof RideError) || !error.unconfirmed) setPending(null);
        setMessage(
          error instanceof RideError && error.code === 'conflict'
            ? 'The route or ride changed. Discard this draft, refresh and review the saved route before trying again.'
            : error instanceof Error
              ? error.message
              : 'Route could not be saved.',
        );
      }
    } finally {
      occupied.current = false;
      if (current()) setBusy(false);
    }
  }
  const visible = status && status.ride.state !== 'ended' && !status.membership.leftAt;
  return (
    <Page>
      <Text style={styles.title}>Plan the way ahead</Text>
      <Text style={styles.detail}>
        Save a route before starting. Cycling rides use cycling roads; cars and motorcycles use
        driving roads. Imported GPX points keep their original order.
      </Text>
      {message !== '' && <Notice>{message}</Notice>}
      <Button label="Refresh saved route" secondary disabled={busy} onPress={() => void load()} />
      {visible && (
        <>
          <Text style={styles.label}>
            {saved
              ? `Saved ${saved.source === 'gpx' ? 'GPX' : 'road route'} · revision ${saved.revision} · ${saved.points.length} points`
              : 'No saved route yet'}
          </Text>
          <RouteMap
            points={saved?.points ?? []}
            waypoints={draft.points}
            onPoint={
              editable && !busy && !pending && motion.ready && !draft.file
                ? (point) => {
                    try {
                      motion.latest();
                      if (draft.points.length === 0) setDraftRevision(saved?.revision ?? 0);
                      setDraft((previous) => ({
                        ...previous,
                        points:
                          previous.points.length < 25
                            ? [...previous.points, point]
                            : previous.points,
                      }));
                    } catch (error) {
                      setMessage((error as Error).message);
                    }
                  }
                : undefined
            }
          />
          {saved && (
            <Text style={styles.detail}>
              Start: {saved.points[0]!.lat.toFixed(5)}, {saved.points[0]!.lon.toFixed(5)} → Finish:{' '}
              {saved.points.at(-1)!.lat.toFixed(5)}, {saved.points.at(-1)!.lon.toFixed(5)}. This is
              a planned route, not turn-by-turn navigation.
            </Text>
          )}
          {editable ? (
            <>
              <Text style={styles.detail}>
                Stay stopped. Tap 2–25 waypoints in travel order; the saved route stays visible
                until a replacement succeeds. GPX: one continuous track or route, at most 5 MB and
                10,000 points.
              </Text>
              <Button
                label="Check that I'm stopped"
                secondary
                busy={motion.checking}
                disabled={busy || !!pending}
                onPress={() => void motion.check()}
              />
              {motion.message !== '' && <Notice>{motion.message}</Notice>}
              <Button
                label="Choose GPX file"
                secondary
                disabled={busy || !!pending || !motion.ready}
                onPress={() => void chooseFile()}
              />
              <Text style={styles.detail}>
                {draft.file
                  ? `Selected: ${draft.file.name}`
                  : `${draft.points.length} draft waypoints`}
              </Text>
              <Button
                label="Undo last waypoint"
                secondary
                disabled={busy || !!pending || !motion.ready || !draft.points.length}
                onPress={() =>
                  setDraft((previous) => ({ ...previous, points: previous.points.slice(0, -1) }))
                }
              />
              <Button
                label={
                  pending
                    ? 'Retry unconfirmed save'
                    : draft.file
                      ? 'Import GPX'
                      : 'Calculate and save road route'
                }
                busy={busy}
                disabled={!pending && (!motion.ready || (!draft.file && draft.points.length < 2))}
                onPress={() => void save()}
              />
              <Button
                label={pending ? 'Cancel retry and refresh' : 'Discard draft'}
                secondary
                disabled={busy}
                onPress={() => {
                  cleanup();
                  setDraft(empty);
                  setDraftRevision(null);
                  setPending(null);
                  void load();
                  setMessage(
                    'Draft cleared. An already submitted save may still finish; refresh to confirm the server state.',
                  );
                }}
              />
            </>
          ) : (
            <Notice>
              Only the leader can edit before the ride starts. Everyone in the ride can view its
              saved route.
            </Notice>
          )}
        </>
      )}
    </Page>
  );
}
