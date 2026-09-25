import { randomUUID } from 'expo-crypto';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useAuth } from '../auth/provider';
import { Button, Notice, styles } from '../auth/components';
import { getRideManagement, RideError } from '../rides/api';
import { useRides } from '../rides/provider';
import { getMessageReceipts, sendMessage, type Draft } from './api';
import { draftRecovery } from './recovery';
import { pillionPresets, riderPresets, type PresetCode } from './presets';
import {
  enqueue,
  listPending,
  removePending,
  setPendingState,
  type PendingMessage,
} from './storage';

export function PresetControls({ id, role }: { id: string; role: 'rider' | 'pillion' }) {
  const { run } = useRides();
  const owner = useAuth().profile?.id ?? '';
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [accepted, setAccepted] = useState<PresetCode | null>(null);
  const [notice, setNotice] = useState('Tap a preset to tell the group. No speed check is needed.');
  const busy = useRef(false);
  const presets = role === 'pillion' ? pillionPresets : riderPresets;
  const refresh = useCallback(async () => {
    if (!owner || busy.current) return;
    busy.current = true;
    try {
      const state = await run((options) => getRideManagement(options, id));
      const active = state.ride.state === 'active' && !state.membership.leftAt;
      const queued = (await listPending(owner, id)).filter(
        (item) => item.draft.type === 'message.preset',
      );
      if (queued.length) {
        const acceptedIds = await run((options) =>
          getMessageReceipts(
            options,
            id,
            queued.map((item) => item.draft.id),
          ),
        );
        for (const acceptedId of acceptedIds) await removePending(acceptedId);
      }
      for (const item of await listPending(owner, id)) {
        if (item.draft.type !== 'message.preset' || item.state !== 'pending') continue;
        if (draftRecovery(item.draft, active, Date.now()) === 'unsent') {
          await setPendingState(item.draft.id, 'unsent');
          continue;
        }
        try {
          await run((options) => sendMessage(options, item.draft));
          await removePending(item.draft.id);
          setAccepted(item.draft.payload.preset);
          setNotice('Preset accepted by the ride.');
        } catch (error) {
          if (error instanceof RideError && !error.unconfirmed && !error.retryable) {
            await setPendingState(item.draft.id, error.code === 'blocked' ? 'unsent' : 'failed');
            setNotice(error.message);
          } else setNotice('Preset is saved offline and will retry when connected.');
          break;
        }
      }
      setPending(
        (await listPending(owner, id)).filter((item) => item.draft.type === 'message.preset'),
      );
    } catch {
      setPending(
        (await listPending(owner, id)).filter((item) => item.draft.type === 'message.preset'),
      );
      setNotice('Preset is saved offline. Ridr will check the ride before retrying.');
    } finally {
      busy.current = false;
    }
  }, [id, owner, run]);
  useFocusEffect(
    useCallback(() => {
      void refresh();
      const timer = setInterval(() => {
        void refresh();
      }, 5000);
      return () => clearInterval(timer);
    }, [refresh]),
  );
  async function send(preset: PresetCode) {
    if (!owner) return;
    const draft: Draft = {
      v: 1,
      type: 'message.preset',
      id: randomUUID(),
      rideId: id,
      capturedAt: new Date().toISOString(),
      payload: { preset },
    };
    try {
      await enqueue(owner, draft);
      setAccepted(null);
      setPending(
        (await listPending(owner, id)).filter((item) => item.draft.type === 'message.preset'),
      );
      setNotice('Preset saved on this device. Sending now…');
      void refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Preset could not be saved.');
    }
  }
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>
        {role === 'pillion' ? 'Pillion quick messages' : 'Quick ride messages'}
      </Text>
      <Notice>{notice}</Notice>
      {presets.map((preset) => (
        <Button
          key={preset.code}
          label={`${preset.icon} ${preset.label}`}
          secondary
          onPress={() => {
            void send(preset.code);
          }}
        />
      ))}
      {pending.map((item) => (
        <View key={item.draft.id}>
          <Text style={styles.detail}>
            {item.draft.type === 'message.preset'
              ? `${item.draft.payload.preset}: ${item.state === 'pending' ? 'Pending / offline' : item.state}`
              : ''}
          </Text>
          {item.state === 'failed' && (
            <Button
              label="Retry preset"
              secondary
              onPress={() => {
                void setPendingState(item.draft.id, 'pending').then(refresh);
              }}
            />
          )}
        </View>
      ))}
      {accepted && <Text style={styles.detail}>Accepted: {accepted}</Text>}
    </View>
  );
}
