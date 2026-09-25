import { useLocalSearchParams } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Button, Notice, Page, styles } from '../src/auth/components';
import { InviteScanner } from '../src/rides/InviteScanner';
import { RideError } from '../src/rides/api';
import { checkStationary } from '../src/rides/motion-check';
import type { MotionContext } from '../src/rides/models';
import {
  acceptPair,
  currentPair,
  issuePairInvitation,
  pairQr,
  parsePairQr,
  previewPairInvitation,
  unpair,
  type PairInvitation,
  type PairPreview,
} from '../src/rides/pairing';
import { RideAccess, useRides } from '../src/rides/provider';

export default function PairScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return (
    <RideAccess>
      <PairFlow id={typeof id === 'string' ? id : ''} />
    </RideAccess>
  );
}

function PairFlow({ id }: { id: string }) {
  const { run } = useRides();
  const [invite, setInvite] = useState<PairInvitation | null>(null);
  const [scanned, setScanned] = useState<{ token: string; preview: PairPreview } | null>(null);
  const [current, setCurrent] = useState<{ id: string; name: string } | null>(null);
  const [statusKnown, setStatusKnown] = useState(false);
  const pairAttempt = useRef<{ token: string; motion: MotionContext; key: string } | null>(null);
  const unpairAttempt = useRef<{ pairId: string; motion: MotionContext; key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const refresh = useCallback(async () => {
    const pair = await run((options) => currentPair(options, id));
    setCurrent(pair ? { id: pair.id, name: pair.partnerName } : null);
    if (pair) {
      pairAttempt.current = null;
      setInvite(null);
      setScanned(null);
    } else unpairAttempt.current = null;
    setStatusKnown(true);
  }, [id, run]);
  useEffect(() => {
    void refresh().catch(() =>
      setMessage('Pair status is unavailable. Refresh before making a change.'),
    );
    const timer = setInterval(() => {
      setInvite((value) => (value && Date.parse(value.expiresAt) <= Date.now() ? null : value));
      if (!busy) void refresh().catch(() => undefined);
    }, 5000);
    return () => clearInterval(timer);
  }, [refresh, busy]);
  async function work(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Pairing could not be confirmed. Refresh and try again.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page>
      <Text style={styles.eyebrow}>MOTORCYCLE PAIRING</Text>
      <Text style={styles.title}>Rider and pillion</Text>
      <Notice>
        Pair only while stopped. One person shows a five-minute QR; the other scans and agrees.
        Either can unpair while stopped.
      </Notice>
      {!!message && <Notice>{message}</Notice>}
      <Button
        label="Refresh pair status"
        secondary
        busy={busy}
        onPress={() => void work(refresh)}
      />
      {!statusKnown ? (
        <Notice>Checking your current pair…</Notice>
      ) : current ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Paired with {current.name}</Text>
          <Button
            label="Check speed and unpair"
            secondary
            busy={busy}
            onPress={() =>
              void work(async () => {
                const attempt =
                  unpairAttempt.current?.pairId === current.id
                    ? unpairAttempt.current
                    : { pairId: current.id, motion: await checkStationary(), key: randomUUID() };
                unpairAttempt.current = attempt;
                try {
                  await run((options) =>
                    unpair(options, id, current.id, attempt.motion, attempt.key),
                  );
                } catch (error) {
                  if (!(error instanceof RideError && error.unconfirmed))
                    unpairAttempt.current = null;
                  throw error;
                }
                unpairAttempt.current = null;
                setInvite(null);
                setScanned(null);
                await refresh();
                setMessage('Pair ended. Both people now have separate map markers.');
              })
            }
          />
        </View>
      ) : (
        <>
          <Button
            label="Check speed and show pair QR"
            busy={busy}
            disabled={pairAttempt.current !== null}
            onPress={() =>
              void work(async () => {
                const motion = await checkStationary();
                const result = await run((options) => issuePairInvitation(options, id, motion));
                setInvite(result);
                setScanned(null);
              })
            }
          />
          {invite && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Show this QR to your partner</Text>
              <View
                accessible
                accessibilityLabel="Rider and pillion pairing QR code"
                style={{ alignSelf: 'center', padding: 12, backgroundColor: 'white' }}
              >
                <QRCode value={pairQr(id, invite.token)} size={200} />
              </View>
              <Text style={styles.detail}>
                Expires {new Date(invite.expiresAt).toLocaleTimeString()}. Showing this QR records
                your consent; scanning alone does not pair you.
              </Text>
            </View>
          )}
          <InviteScanner
            label="Scan partner's pair QR"
            fallbackText="Ask your partner to scan your QR"
            disabled={busy || pairAttempt.current !== null}
            onScan={(value) =>
              void work(async () => {
                const token = parsePairQr(value, id);
                const motion = await checkStationary();
                const result = await run((options) =>
                  previewPairInvitation(options, id, token, motion),
                );
                setScanned({ token, preview: result });
                setInvite(null);
              })
            }
          />
          {scanned && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>
                Pair with {scanned.preview.counterpart.displayName}?
              </Text>
              <Text style={styles.detail}>
                They are the {scanned.preview.counterpart.physicalRole}. Your locations remain
                separate in history; the group map will show a shared marker at the rider's
                position.
              </Text>
              <Button
                label="I agree — pair now"
                busy={busy}
                onPress={() =>
                  void work(async () => {
                    const attempt =
                      pairAttempt.current?.token === scanned.token
                        ? pairAttempt.current
                        : {
                            token: scanned.token,
                            motion: await checkStationary(),
                            key: randomUUID(),
                          };
                    pairAttempt.current = attempt;
                    try {
                      await run((options) =>
                        acceptPair(
                          options,
                          id,
                          scanned.preview,
                          scanned.token,
                          attempt.motion,
                          attempt.key,
                        ),
                      );
                    } catch (error) {
                      if (!(error instanceof RideError && error.unconfirmed))
                        pairAttempt.current = null;
                      throw error;
                    }
                    pairAttempt.current = null;
                    setScanned(null);
                    await refresh();
                    setMessage('Pairing confirmed.');
                  })
                }
              />
              <Button
                label="Cancel"
                secondary
                disabled={busy || pairAttempt.current !== null}
                onPress={() => setScanned(null)}
              />
            </View>
          )}
        </>
      )}
    </Page>
  );
}
