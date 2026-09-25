import { randomUUID } from 'expo-crypto';
import { useEffect, useRef, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Button, Notice, styles } from '../auth/components';
import { InviteScanner } from './InviteScanner';
import { RideError } from './api';
import { checkStationary } from './motion-check';
import type { MotionContext } from './models';
import { useRides } from './provider';
import {
  acceptScan,
  attestReadiness,
  issueScan,
  parseReadinessQr,
  readinessQr,
  type PairReadiness,
  type ScanChallenge,
  type ScanReceipt,
} from './readiness';

type Retry = { value: string; motion: MotionContext; key: string };

export function ReadinessPanel({
  rideId,
  pair,
  ownMemberId,
  initialReceipt,
  onUpdated,
}: {
  rideId: string;
  pair: PairReadiness;
  ownMemberId: string;
  initialReceipt: ScanReceipt | null;
  onUpdated(): Promise<void>;
}) {
  const { run } = useRides();
  const isPillion = ownMemberId === pair.pillion.memberId;
  const [challenge, setChallenge] = useState<ScanChallenge | null>(null);
  const [receipt, setReceipt] = useState<ScanReceipt | null>(initialReceipt);
  const [helmet, setHelmet] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const scanRetry = useRef<Retry | null>(null);
  const attestRetry = useRef<Retry | null>(null);

  useEffect(() => {
    if (initialReceipt?.pairId === pair.id) setReceipt(initialReceipt);
  }, [initialReceipt, pair.id]);
  useEffect(() => {
    if (pair.ready) {
      setChallenge(null);
      setReceipt(null);
      scanRetry.current = null;
      attestRetry.current = null;
    }
  }, [pair.ready]);

  async function work(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Readiness check failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (pair.ready) {
    return (
      <Notice>
        {pair.pillion.displayName} confirmed their helmet and readiness at{' '}
        {new Date(pair.confirmedAt!).toLocaleTimeString()}.
      </Notice>
    );
  }

  const validChallenge = challenge && Date.parse(challenge.expiresAt) > Date.now();
  const validReceipt =
    receipt && receipt.pairId === pair.id && Date.parse(receipt.expiresAt) > Date.now();

  return (
    <View style={{ gap: 12 }}>
      <Notice>
        Pending: {pair.pillion.displayName} must scan the rider’s QR, then confirm their own helmet
        and readiness while stopped. This is a personal confirmation, not a helmet sensor check.
      </Notice>
      {!!message && <Notice>{message}</Notice>}
      {ownMemberId === pair.rider.memberId && (
        <>
          <Button
            label={challenge ? 'Issue a new readiness QR' : 'Check speed and show readiness QR'}
            secondary
            busy={busy}
            onPress={() =>
              void work(async () => {
                const motion = await checkStationary();
                const issued = await run((options) => issueScan(options, rideId, pair.id, motion));
                setChallenge(issued);
                setMessage('Ask your pillion to scan this QR with their phone.');
              })
            }
          />
          {validChallenge && (
            <View
              accessible
              accessibilityLabel="Pillion readiness QR code"
              style={{ alignSelf: 'center', padding: 12, backgroundColor: 'white' }}
            >
              <QRCode value={readinessQr(rideId, pair.id, challenge)} size={200} />
            </View>
          )}
          {validChallenge && (
            <Text style={styles.detail}>
              Expires {new Date(challenge.expiresAt).toLocaleTimeString()}. Reissuing makes this QR
              invalid.
            </Text>
          )}
        </>
      )}
      {isPillion && (
        <>
          <InviteScanner
            label="Scan rider’s readiness QR"
            fallbackText="Ask the rider to show a new readiness QR"
            disabled={busy || scanRetry.current !== null}
            onScan={(value) =>
              void work(async () => {
                const parsed = parseReadinessQr(value, rideId, pair.id);
                const attempt =
                  scanRetry.current?.value === value
                    ? scanRetry.current
                    : { value, motion: await checkStationary(), key: randomUUID() };
                scanRetry.current = attempt;
                try {
                  const scanned = await run((options) =>
                    acceptScan(
                      options,
                      rideId,
                      pair.id,
                      parsed.challengeId,
                      parsed.scannedToken,
                      attempt.motion,
                      attempt.key,
                    ),
                  );
                  setReceipt(scanned);
                  scanRetry.current = null;
                  setMessage('QR scanned. Confirm your helmet and readiness below.');
                } catch (error) {
                  if (!(error instanceof RideError && error.unconfirmed)) scanRetry.current = null;
                  throw error;
                }
              })
            }
          />
          {scanRetry.current && (
            <Button
              label="Retry last scan"
              secondary
              busy={busy}
              onPress={() =>
                void work(async () => {
                  const attempt = scanRetry.current!;
                  const parsed = parseReadinessQr(attempt.value, rideId, pair.id);
                  const scanned = await run((options) =>
                    acceptScan(
                      options,
                      rideId,
                      pair.id,
                      parsed.challengeId,
                      parsed.scannedToken,
                      attempt.motion,
                      attempt.key,
                    ),
                  );
                  setReceipt(scanned);
                  scanRetry.current = null;
                })
              }
            />
          )}
          {validReceipt ? (
            <>
              <Text style={styles.detail}>
                Scan accepted until {new Date(receipt.expiresAt).toLocaleTimeString()}.
              </Text>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <Text style={styles.detail}>I am wearing my helmet</Text>
                <Switch
                  accessibilityLabel="I am wearing my helmet"
                  value={helmet}
                  onValueChange={setHelmet}
                />
              </View>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <Text style={styles.detail}>I am ready to ride</Text>
                <Switch
                  accessibilityLabel="I am ready to ride"
                  value={ready}
                  onValueChange={setReady}
                />
              </View>
              <Button
                label={
                  attestRetry.current ? 'Retry readiness confirmation' : 'Confirm my readiness'
                }
                busy={busy}
                disabled={!helmet || !ready}
                onPress={() =>
                  void work(async () => {
                    const attempt =
                      attestRetry.current?.value === receipt.scanReceiptId
                        ? attestRetry.current
                        : {
                            value: receipt.scanReceiptId,
                            motion: await checkStationary(),
                            key: randomUUID(),
                          };
                    attestRetry.current = attempt;
                    try {
                      await run((options) =>
                        attestReadiness(
                          options,
                          rideId,
                          pair.id,
                          pair.revision,
                          receipt.scanReceiptId,
                          attempt.motion,
                          attempt.key,
                        ),
                      );
                      attestRetry.current = null;
                      await onUpdated();
                    } catch (error) {
                      if (!(error instanceof RideError && error.unconfirmed))
                        attestRetry.current = null;
                      throw error;
                    }
                  })
                }
              />
            </>
          ) : (
            <Text style={styles.detail}>
              Scan a fresh QR to confirm. An expired scan cannot be used.
            </Text>
          )}
        </>
      )}
    </View>
  );
}
