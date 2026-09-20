import { Link } from 'expo-router';
import { Text, View } from 'react-native';
import { Button, Notice, Page, styles } from '../auth/components';
import GroupMap from './GroupMap';
import { projectGroup } from './model';
import { useGroupLocations } from './use-group-locations';
export function GroupRideMap({ id, name }: { id: string; name: string }) {
  const live = useGroupLocations(id);
  const group = live.snapshot ? projectGroup(live.snapshot, live.now) : null;
  return (
    <Page>
      <Text style={styles.eyebrow}>GROUP MAP</Text>
      <Text style={styles.title}>{name}</Text>
      <Notice>{live.message}</Notice>
      <Text style={styles.detail}>
        Opening this map does not start location sharing. Green: live · amber: low accuracy · grey:
        stale. Paired markers use the rider’s position.
      </Text>
      <GroupMap data={group?.data ?? { type: 'FeatureCollection', features: [] }} />
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
          {live.snapshot?.pairs.some((pair) => pair.pillionMemberId === member.id) && (
            <Text style={styles.detail}>
              Pillion: combined marker follows the rider. This person’s own position is listed
              separately below.
            </Text>
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
