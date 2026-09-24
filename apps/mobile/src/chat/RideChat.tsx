import { randomUUID } from 'expo-crypto';
import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import { io } from 'socket.io-client';
import { useAuth } from '../auth/provider';
import { Button, Field, Notice, Page, styles } from '../auth/components';
import { getRideManagement, RideError } from '../rides/api';
import { useMotionCheck } from '../rides/use-motion-check';
import { useRides } from '../rides/provider';
import { getMessages, sendMessage, type ChatMessage, type Draft } from './api';
import { draftRecovery } from './recovery';
import {
  enqueue,
  listPending,
  removePending,
  setPendingState,
  type PendingMessage,
} from './storage';

export function RideChat({ id, pin }: { id: string; pin: { lat: number; lon: number } | null }) {
  const auth = useAuth();
  const { run } = useRides();
  const motion = useMotionCheck();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [text, setText] = useState('');
  const [notice, setNotice] = useState('Loading ride chat…');
  const [canSend, setCanSend] = useState(false);
  const [pillion, setPillion] = useState(false);
  const [composer, setComposer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState<number | null>(null);
  const reading = useRef(false);
  const sending = useRef(false);
  const lastSequence = useRef(0);
  const owner = auth.profile?.id ?? '';

  const refresh = useCallback(
    async (loadOlder = false) => {
      if (reading.current || !owner || AppState.currentState !== 'active') return;
      reading.current = true;
      try {
        const state = await run((options) => getRideManagement(options, id));
        const active = state.ride.state === 'active' && !state.membership.leftAt;
        setCanSend(active);
        setPillion(state.membership.physicalRole === 'pillion');
        if (!active) {
          setMessages([]);
          setMore(null);
          lastSequence.current = 0;
          const drafts = await listPending(owner, id);
          for (const item of drafts)
            if (item.state !== 'unsent') await setPendingState(item.draft.id, 'unsent');
          setPending(await listPending(owner, id));
          setNotice(
            'This ride is no longer active. Drafts were not sent. Copy any text you want to keep.',
          );
          return;
        }
        const pages = await run(async (options) => {
          let after = lastSequence.current,
            items: ChatMessage[] = [],
            next: number | null = null;
          for (let pageNumber = 0; pageNumber < (loadOlder ? 20 : 5); pageNumber++) {
            const page = await getMessages(options, id, after);
            items = [...items, ...page.items];
            next = page.nextSequence;
            if (next === null) break;
            after = next;
          }
          return { items, next };
        });
        if (pages.items.length) {
          lastSequence.current = pages.items.at(-1)!.sequence;
          setMessages((previous) => [...previous, ...pages.items]);
        }
        setMore(pages.next);
        const drafts = await listPending(owner, id);
        const accepted = new Set(pages.items.map((item) => item.id));
        for (const item of drafts)
          if (accepted.has(item.draft.id)) await removePending(item.draft.id);
        setPending(await listPending(owner, id));
        setNotice(
          'Messages are ordered by the ride server. Original capture times are shown separately.',
        );
        if (!sending.current) {
          sending.current = true;
          try {
            for (const item of await listPending(owner, id)) {
              if (item.state !== 'pending') continue;
              if (draftRecovery(item.draft, true, Date.now()) === 'unsent') {
                await setPendingState(item.draft.id, 'unsent');
                continue;
              }
              try {
                await run((options) => sendMessage(options, item.draft));
                await removePending(item.draft.id);
              } catch (error) {
                if (
                  error instanceof RideError &&
                  !error.unconfirmed &&
                  !['unavailable', 'rate_limited'].includes(error.code)
                )
                  await setPendingState(
                    item.draft.id,
                    error.code === 'blocked' ? 'unsent' : 'failed',
                  );
                break;
              }
            }
          } finally {
            sending.current = false;
            setPending(await listPending(owner, id));
          }
        }
      } catch (error) {
        if (
          error instanceof RideError &&
          ['unauthorized', 'blocked', 'not_found', 'conflict'].includes(error.code)
        ) {
          setCanSend(false);
          setMessages([]);
          lastSequence.current = 0;
        }
        setNotice(
          error instanceof Error
            ? error.message
            : 'Ride chat is unavailable. Pending drafts stay on this device.',
        );
      } finally {
        reading.current = false;
      }
    },
    [id, owner, run],
  );

  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (owner)
        void listPending(owner, id)
          .then((items) => {
            if (active) setPending(items);
          })
          .catch(() => undefined);
      void refresh();
      const timer = setInterval(() => {
        if (active) void refresh();
      }, 5000);
      let socket: ReturnType<typeof io> | null = null;
      void run(async (options) => {
        if (!active) return;
        socket = io(`${options.apiUrl.replace(/\/$/, '')}/v1/rides`, {
          transports: ['websocket'],
          auth: { token: options.accessToken },
          reconnection: true,
        });
        socket.on('connect', () => socket?.emit('subscribe', { rideId: id, afterSequence: 0 }));
        socket.on('ride.sequence', () => {
          void refresh();
        });
        socket.on('access.revoked', () => {
          void refresh();
        });
      }).catch(() => undefined);
      const listener = AppState.addEventListener('change', (state) => {
        if (state === 'active') void refresh();
        else {
          setMessages([]);
        }
      });
      return () => {
        active = false;
        clearInterval(timer);
        listener.remove();
        socket?.disconnect();
        setMessages([]);
        lastSequence.current = 0;
      };
    }, [id, owner, run, refresh]),
  );

  async function compose() {
    if (busy || !canSend || !owner) return;
    let proof;
    try {
      proof = motion.latest();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Check that you are stopped first.');
      return;
    }
    if (!text.trim() || [...text].length > 1000) {
      setNotice('Write 1–1,000 characters.');
      return;
    }
    const draft: Draft = {
      v: 1,
      type: pin ? 'message.pin' : 'message.text',
      id: randomUUID(),
      rideId: id,
      capturedAt: proof.capturedAt,
      payload: {
        text,
        motion: {
          state: 'stopped',
          source: proof.motion.source as 'speed' | 'activity',
          observedAt: proof.motion.observedAt,
        },
        ...(pin ? { coordinate: pin } : {}),
      },
    };
    setBusy(true);
    try {
      await enqueue(owner, draft);
      setText('');
      setPending(await listPending(owner, id));
      setNotice('Saved on this device. Sending or retrying with the same message ID.');
      void refresh();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : 'Encrypted draft storage failed; nothing was sent.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function retry(idToRetry: string) {
    await setPendingState(idToRetry, 'pending');
    setPending(await listPending(owner, id));
    void refresh();
  }
  return (
    <Page>
      <Text style={styles.eyebrow}>RIDE CHAT</Text>
      <Text style={styles.title}>Ride messages</Text>
      <Notice>{notice}</Notice>
      <Text style={styles.detail}>
        Text and pins are for coordination. Do not type while moving. Quick presets arrive on Day
        14.
      </Text>
      {messages.map((item) => (
        <View key={item.id} style={styles.card}>
          <Text style={styles.label}>
            {item.kind === 'pin' ? 'Message pin · ' : ''}
            {item.authorName}
          </Text>
          <Text style={styles.detail}>{item.text}</Text>
          {item.coordinate && (
            <>
              <Text selectable style={styles.detail}>
                Pinned at {item.coordinate.lat.toFixed(5)}, {item.coordinate.lon.toFixed(5)}
              </Text>
              <Link
                href={{
                  pathname: '/ride',
                  params: {
                    id,
                    focusLat: String(item.coordinate.lat),
                    focusLon: String(item.coordinate.lon),
                  },
                }}
                style={styles.link}
              >
                View pin on group map →
              </Link>
            </>
          )}
          <Text style={styles.detail}>
            Written {new Date(item.capturedAt).toLocaleString()} · accepted{' '}
            {new Date(item.acceptedAt).toLocaleTimeString()}
          </Text>
        </View>
      ))}
      {!messages.length && <Notice>No accepted messages in this page yet.</Notice>}
      {more !== null && (
        <Button
          label="Load next messages"
          secondary
          onPress={() => {
            void refresh(true);
          }}
        />
      )}
      {pending.map((item) => (
        <View key={item.draft.id} style={styles.card}>
          <Text style={styles.label}>
            {item.state === 'pending'
              ? 'Pending · retrying while this chat is open'
              : item.state === 'failed'
                ? 'Failed · review and retry'
                : 'Unsent · ride ended or draft expired'}
          </Text>
          <Text selectable style={styles.detail}>
            {item.draft.payload.text}
          </Text>
          {item.state === 'failed' && canSend && (
            <Button
              label="Retry this message"
              secondary
              onPress={() => {
                void retry(item.draft.id);
              }}
            />
          )}
        </View>
      ))}
      {canSend && pillion && !composer && (
        <Button label="Write a message" secondary onPress={() => setComposer(true)} />
      )}
      {canSend && (!pillion || composer) && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{pin ? 'Write at chosen pin' : 'Write a message'}</Text>
          {pin && (
            <Text selectable style={styles.detail}>
              Chosen on the group map: {pin.lat.toFixed(5)}, {pin.lon.toFixed(5)}
            </Text>
          )}
          <Button
            label="Check that I am stopped"
            busy={motion.checking}
            onPress={() => {
              void motion.check();
            }}
          />
          <Notice>{motion.message}</Notice>
          <Field label="Message" value={text} onChangeText={setText} multiline maxLength={1000} />
          <Button
            label={pin ? 'Send pinned message' : 'Send message'}
            busy={busy}
            disabled={!motion.ready || !text.trim()}
            onPress={() => {
              void compose();
            }}
          />
        </View>
      )}
      <Link href={{ pathname: '/ride', params: { id } }} style={styles.link}>
        Back to group map →
      </Link>
    </Page>
  );
}
