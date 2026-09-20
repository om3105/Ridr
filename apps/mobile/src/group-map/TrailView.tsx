import { useGroupLocations } from './use-group-locations';
import type { LocationSnapshot } from '../location/types';
import { useCallback, useRef, useState } from 'react';
import { Link, useFocusEffect } from 'expo-router';
import { AppState, Text } from 'react-native';
import { Button, Notice, Page, styles } from '../auth/components';
import { useRides } from '../rides/provider';
import { getTrail, trailGeometry, type TrailPage } from './trails';
import GroupMap from './GroupMap';
export function TrailView({
  id,
  memberId,
  ownMemberId,
  active,
  name,
}: {
  id: string;
  memberId: string;
  ownMemberId: string;
  active: boolean;
  name: string;
}) {
  const { run } = useRides();
  const [page, setPage] = useState<TrailPage | null>(null);
  const [message, setMessage] = useState('Loading recorded trail…');
  const [busy, setBusy] = useState(false);
  const life = useRef({ version: 0, active: false });
  const pending = useRef(false);
  const loadedIds = useRef(new Set<string>());
  const load = useCallback(
    async (cursor?: string) => {
      if (pending.current || !life.current.active || AppState.currentState !== 'active') return;
      const version = life.current.version;
      pending.current = true;
      setBusy(true);
      try {
        const result = await run((options) => getTrail(options, id, memberId, cursor));
        if (!life.current.active || life.current.version !== version) return;
        loadedIds.current = new Set([
          ...(cursor ? loadedIds.current : []),
          ...result.points.map((point) => point.id),
        ]);
        setPage((previous) =>
          cursor && previous
            ? { ...result, points: [...previous.points, ...result.points] }
            : result,
        );
        setMessage(
          result.points.length
            ? 'Blue lines join recorded observations. Amber points mark interrupted or uncertain data.'
            : 'No retained samples available for this person.',
        );
      } catch (error) {
        if (life.current.active && life.current.version === version) {
          setPage(null);
          setMessage(error instanceof Error ? error.message : 'Trail unavailable.');
        }
      } finally {
        pending.current = false;
        if (life.current.version === version) setBusy(false);
      }
    },
    [id, memberId, run],
  );
  useFocusEffect(
    useCallback(() => {
      life.current.active = true;
      void load();
      const clear = () => {
        life.current.version++;
        setPage(null);
        setBusy(false);
      };
      const app = AppState.addEventListener('change', (state) => {
        clear();
        if (state === 'active') void load();
      });
      // Replace rather than merge refreshes so deleted or newly private samples disappear.
      const timer = setInterval(() => {
        void load();
      }, 15000);
      return () => {
        life.current.active = false;
        clear();
        clearInterval(timer);
        app.remove();
      };
    }, [load]),
  );
  const observe = useCallback(
    (snapshot: LocationSnapshot | null) => {
      const member = snapshot?.members.find((item) => item.id === memberId);
      if (!snapshot || !member || (memberId !== ownMemberId && !member.sharingEnabled)) {
        life.current.version++;
        loadedIds.current.clear();
        setPage(null);
        setBusy(false);
        return;
      }
      const latest = snapshot.items.find((item) => item.memberId === memberId);
      if (latest && !loadedIds.current.has(latest.sampleId)) void load();
    },
    [memberId, ownMemberId, load],
  );
  useGroupLocations(id, null, active, observe);
  const trail = trailGeometry(page?.points ?? []);
  return (
    <Page>
      <Text style={styles.eyebrow}>RECORDED TRAIL</Text>
      <Text style={styles.title}>
        {memberId === ownMemberId ? 'Your trail' : `${name}’s trail`}
      </Text>
      <Notice>{message}</Notice>
      <Text style={styles.detail}>
        {trail.count} samples loaded · {trail.breaks} interruptions. No line is drawn across poor
        GPS, sharing changes, a gap over 30 seconds or implausible movement. Each pillion has a
        separate personal trail.
      </Text>
      <GroupMap data={{ type: 'FeatureCollection', features: [] }} trail={trail.data} />
      <Button
        label="Refresh latest trail"
        secondary
        busy={busy}
        onPress={() => {
          void load();
        }}
      />
      <Button
        label="Load older samples"
        secondary
        busy={busy}
        disabled={!page?.nextCursor || (page?.points.length ?? 0) >= 2000}
        onPress={() => {
          if (page?.nextCursor) void load(page.nextCursor);
        }}
      />
      {(page?.points.length ?? 0) >= 2000 && (
        <Notice>
          Showing up to 2,000 samples to keep this view responsive. Refresh returns to the latest
          page.
        </Notice>
      )}
      <Text style={styles.detail}>
        New live positions trigger a refresh. The latest page also refreshes every 15 seconds while
        open. Older pages are a temporary view; refresh replaces them. Ended and left-ride access is
        limited to your own retained trail, for up to 90 days after end.
      </Text>
      <Link href={{ pathname: '/ride', params: { id, view: 'controls' } }} style={styles.link}>
        Back to ride controls →
      </Link>
    </Page>
  );
}
