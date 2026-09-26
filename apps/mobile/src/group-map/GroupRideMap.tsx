import { RideWarnings } from './RideWarnings';
import { SosAlerts } from '../sos/SosAlerts';
import { stageSosPosition } from '../sos/capture';
import { PresetControls } from '../chat/PresetControls';
import { getMessages, type ChatMessage } from '../chat/api';
import { Link, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Notice, Page, styles } from '../auth/components';
import { useRides } from '../rides/provider';
import GroupMap from './GroupMap';
import { projectGroup } from './model';
import { useGroupLocations } from './use-group-locations';
export function GroupRideMap({
  id,
  name,
  startedAt,
  focus,
  physicalRole,
  transport,
  offline = false,
}: {
  id: string;
  name: string;
  startedAt: string | null;
  focus: { lat: number; lon: number } | null;
  physicalRole: 'rider' | 'pillion';
  transport: 'motorcycle' | 'cycling' | 'car';
  offline?: boolean;
}) {
  const live = useGroupLocations(id, startedAt);
  const group = live.snapshot ? projectGroup(live.snapshot, live.now) : null;
  const ownPosition = live.snapshot?.members.find(
    (member) => member.id === live.snapshot?.ownMemberId,
  )?.sharingEnabled
    ? live.snapshot.items.find((item) => item.memberId === live.snapshot?.ownMemberId)?.position
    : null;
  const passengerByRider = new Map(
    live.snapshot?.pairs.map((pair) => [
      pair.riderMemberId,
      live.snapshot!.members.find((person) => person.id === pair.pillionMemberId)?.displayName ??
        'pillion',
    ]) ?? [],
  );
  const { run } = useRides();
  const router = useRouter();
  const [pins, setPins] = useState<ChatMessage[]>([]);
  const [recentPresets, setRecentPresets] = useState<ChatMessage[]>([]);
  const lastPinSequence = useRef(0);
  const [chosen, setChosen] = useState<{ lat: number; lon: number } | null>(null);
  const available = live.snapshot !== null;
  useEffect(() => {
    if (!available) {
      setPins([]);
      setRecentPresets([]);
      lastPinSequence.current = 0;
      setChosen(null);
      return;
    }
    let active = true;
    let reading = false;
    const update = async () => {
      if (reading) return;
      reading = true;
      try {
        const page = await run((options) => getMessages(options, id, lastPinSequence.current));
        if (active) {
          if (page.items.length) lastPinSequence.current = page.items.at(-1)!.sequence;
          setPins((previous) => [...previous, ...page.items.filter((item) => item.kind === 'pin')]);
          setRecentPresets((previous) =>
            [...previous, ...page.items.filter((item) => item.kind === 'preset')].slice(-5),
          );
        }
      } catch {
        // Keep previously accepted pins through a temporary connection failure.
      } finally {
        reading = false;
      }
    };
    void update();
    const timer = setInterval(() => {
      void update();
    }, 5000);
    return () => {
      active = false;
      clearInterval(timer);
      lastPinSequence.current = 0;
    };
  }, [id, run, available]);
  return (
    <Page>
      <Text style={styles.eyebrow}>GROUP MAP</Text>
      <Text style={styles.title}>{name}</Text>
      <Button
        label="SOS — alert ride members"
        onPress={() => {
          const position =
            ownPosition && Date.now() - Date.parse(ownPosition.recordedAt) <= 600000
              ? ownPosition
              : null;
          stageSosPosition(id, position);
          router.push({
            pathname: '/ride',
            params: { id, view: 'sos', sos: 'start' },
          });
        }}
      />
      <Link href={{ pathname: '/ride', params: { id, view: 'sos' } }} style={styles.link}>
        View ride SOS alerts →
      </Link>
      <SosAlerts rideId={id} />
      {offline && (
        <Notice>
          Ride status is unconfirmed. Saved quick messages will be checked before sending when the
          connection returns.
        </Notice>
      )}
      <Notice>{live.message}</Notice>
      <RideWarnings snapshot={live.snapshot} now={live.now} />
      {physicalRole === 'pillion' && (
        <>
          <Link href={{ pathname: '/ride', params: { id, view: 'chat' } }} style={styles.link}>
            Read ride messages →
          </Link>
          <PresetControls id={id} role="pillion" />
        </>
      )}
      <Text style={styles.detail}>
        Opening this map does not start location sharing. Green: live · amber: low accuracy · grey:
        stale. Paired markers use the rider’s position.
      </Text>
      <Notice>
        {live.gaps
          ? `${live.gaps.freshUnits}/${live.gaps.totalUnits} fresh reporting units · ${live.gaps.excludedUnits} excluded · ${live.gaps.matchedUnits} matched to route. Pairs count once. Route gaps are relative to the matched group median.`
          : 'Gap indicators unavailable until positions are received.'}
      </Notice>
      <Text style={styles.detail}>
        Route order needs a saved route and accurate, recent positions. Unknown loop laps or
        interrupted tracking show unavailable order. Pillion gaps use the paired rider.
      </Text>
      <Text style={styles.detail}>
        Purple markers are message pins; rider positions use their status colours. Tap the map to
        choose a coordinate for a new pinned message.
      </Text>
      {physicalRole !== 'pillion' && <PresetControls id={id} role="rider" />}
      {recentPresets.map((preset) => (
        <View key={preset.id} style={styles.card}>
          <Text style={styles.label}>Ride preset · {preset.authorName}</Text>
          <Text style={styles.cardTitle}>{preset.text}</Text>
          <Text style={styles.detail}>
            Accepted {new Date(preset.acceptedAt).toLocaleTimeString()}
          </Text>
        </View>
      ))}
      <GroupMap
        data={group?.data ?? { type: 'FeatureCollection', features: [] }}
        focus={focus}
        pins={pins.flatMap((item) =>
          item.coordinate ? [{ id: item.id, ...item.coordinate }] : [],
        )}
        onPinSelect={setChosen}
      />
      {chosen && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Chosen message pin</Text>
          <Text selectable style={styles.detail}>
            {chosen.lat.toFixed(5)}, {chosen.lon.toFixed(5)}
          </Text>
          <Link
            href={{
              pathname: '/ride',
              params: { id, view: 'chat', lat: String(chosen.lat), lon: String(chosen.lon) },
            }}
            style={styles.link}
          >
            Write at this pin →
          </Link>
        </View>
      )}
      {pins.map((pin) => (
        <View key={pin.id} style={styles.card}>
          <Text style={styles.label}>Message pin · {pin.authorName}</Text>
          <Text style={styles.detail}>{pin.text}</Text>
          <Text selectable style={styles.detail}>
            {pin.coordinate?.lat.toFixed(5)}, {pin.coordinate?.lon.toFixed(5)}
          </Text>
        </View>
      ))}
      <Link href={{ pathname: '/ride', params: { id, view: 'chat' } }} style={styles.link}>
        Open ride chat →
      </Link>
      {group && !group.data.features.length && (
        <Notice>No shared rider positions yet. See each person’s status below.</Notice>
      )}
      <Link href={{ pathname: '/sharing', params: { id } }} style={styles.link}>
        Manage your location sharing →
      </Link>
      <Link href={{ pathname: '/ride', params: { id, view: 'controls' } }} style={styles.link}>
        Ride controls & invitations →
      </Link>
      <Link href={{ pathname: '/route', params: { id } }} style={styles.link}>
        View the saved route →
      </Link>
      {transport === 'motorcycle' && (
        <Link href={{ pathname: '/pair', params: { id } }} style={styles.link}>
          Rider and pillion pairing →
        </Link>
      )}
      {transport === 'motorcycle' && (
        <Link href={{ pathname: '/headcount', params: { id } }} style={styles.link}>
          Rest-stop pair headcount →
        </Link>
      )}
      <Button label="Refresh group" secondary onPress={live.refresh} />
      {group?.members.map((member) => (
        <View key={member.id} style={styles.card}>
          <Text style={styles.cardTitle}>
            {member.displayName}
            {member.id === live.snapshot?.ownMemberId ? ' (you)' : ''}
          </Text>
          <Text style={styles.detail}>
            {member.role} · {member.state}
          </Text>
          {passengerByRider.has(member.id) && (
            <Text style={styles.detail}>
              Riding with {passengerByRider.get(member.id)} · marker uses this rider's position.
            </Text>
          )}
          {live.snapshot?.pairs.some((pair) => pair.pillionMemberId === member.id) && (
            <Text style={styles.detail}>
              Pillion: combined marker follows the rider. This person’s own position is listed
              separately below.
            </Text>
          )}
          <Text style={styles.detail}>
            {(() => {
              const gap = live.gaps?.details.find((detail) => detail.memberId === member.id);
              return `${gap?.routeGapM == null ? 'Order unavailable' : `${Math.round(Math.abs(gap.routeGapM))} m ${gap.routeGapM < 0 ? 'behind' : 'ahead of'} group median along route`} · ${gap?.centreDistanceM == null ? 'Group-centre distance unavailable' : `${Math.round(gap.centreDistanceM)} m to group centre (straight line)`}`;
            })()}
          </Text>
          {(member.sharingEnabled || member.id === live.snapshot?.ownMemberId) && (
            <Link
              href={{ pathname: '/ride', params: { id, view: 'trail', member: member.id } }}
              style={styles.link}
            >
              View this person’s recorded trail →
            </Link>
          )}
          {member.sample && (
            <>
              <Text style={styles.detail}>
                Last reported: {new Date(member.sample.position.recordedAt).toLocaleTimeString()} ·
                ±{Math.round(member.sample.position.accuracyM)} m
              </Text>
              <Text selectable style={styles.detail}>
                {member.sample.position.lat.toFixed(5)}, {member.sample.position.lon.toFixed(5)}
              </Text>
              <Text style={styles.detail}>
                {member.speed === null ? 'Speed unavailable' : `${Math.round(member.speed)} km/h`} ·{' '}
                {member.heading === null ? 'Heading unavailable' : `${Math.round(member.heading)}°`}
              </Text>
            </>
          )}
        </View>
      ))}
      <Link href="/rides" style={styles.link}>
        Back to your rides →
      </Link>
    </Page>
  );
}
