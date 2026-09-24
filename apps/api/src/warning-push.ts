import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import type { VerifiedAccount } from './auth.js';
import type { LiveLocations } from './location.js';

export interface PushRegistration {
  token: string;
  account: VerifiedAccount;
}
export function sealPush(value: PushRegistration, key: Buffer, deviceId: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(deviceId));
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}
export function openPush(value: Buffer, key: Buffer, deviceId: string): PushRegistration {
  const cipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
  cipher.setAAD(Buffer.from(deviceId));
  cipher.setAuthTag(value.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString('utf8'),
  ) as PushRegistration;
}
export function validPushToken(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{16,200}\]$/.test(value)
  );
}
export function pushMessage(token: string, rideId: string, warningId: string) {
  return {
    to: token,
    title: 'Ridr ride update',
    body: 'Open Ridr to check current ride warnings.',
    data: { rideId, warningId },
    ttl: 30,
    priority: 'high',
    channelId: 'ride-warnings',
  };
}
interface Ticket {
  status?: string;
  id?: string;
  details?: { error?: string };
}
export class WarningPush {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> | null = null;
  constructor(
    private pool: Pool,
    readonly key: Buffer,
    private locations: (account: VerifiedAccount, rideId: string) => Promise<LiveLocations>,
    private fetcher: typeof fetch = fetch,
  ) {}
  start() {
    this.timer = setInterval(() => {
      void this.tick().catch(() => undefined);
    }, 5000);
    this.timer.unref();
  }
  tick(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.work().finally(() => {
      this.running = null;
    });
    return this.running;
  }
  private async work() {
    // Crash/timeout after submission is ambiguous: never blindly resend a possibly delivered alert.
    await this.pool.query(
      "UPDATE ridr.warning_push_deliveries SET state='unknown',updated_at=now() WHERE state='pending' AND updated_at < now()-interval '1 minute'",
    );
    await this.pool.query(
      "UPDATE ridr.warning_push_deliveries SET state='unknown',updated_at=now() WHERE state='accepted' AND updated_at < now()-interval '24 hours'",
    );
    await this.receipts().catch(() => undefined);
    const devices = await this.pool.query<{
      id: string;
      user_id: string;
      ride_id: string;
      push_token_ciphertext: Buffer;
    }>(
      `SELECT d.id,d.user_id,m.ride_id,d.push_token_ciphertext FROM ridr.devices d JOIN ridr.memberships m ON m.user_id=d.user_id AND m.left_at IS NULL JOIN ridr.rides r ON r.id=m.ride_id AND r.state='active' WHERE d.revoked_at IS NULL AND d.push_token_ciphertext IS NOT NULL`,
    );
    for (const device of devices.rows) {
      let registration: PushRegistration;
      try {
        registration = openPush(device.push_token_ciphertext, this.key, device.id);
      } catch {
        continue;
      }
      if (
        registration.account.id !== device.user_id ||
        registration.account.expiresAt * 1000 <= Date.now()
      )
        continue;
      let snapshot: LiveLocations;
      try {
        snapshot = await this.locations(registration.account, device.ride_id);
      } catch {
        continue;
      }
      for (const warning of snapshot.alerts ?? []) {
        const claim = await this.pool.query(
          `INSERT INTO ridr.warning_push_deliveries(ride_id,device_id,warning_id,state)
          SELECT $1::uuid,$2::uuid,$3::uuid,'pending' WHERE NOT EXISTS (SELECT 1 FROM ridr.ride_alert_state WHERE ride_id=$1 AND body->'acknowledgements'->(($2::uuid)::text) ? (($3::uuid)::text))
          ON CONFLICT DO NOTHING RETURNING warning_id`,
          [device.ride_id, device.id, warning.id],
        );
        if (!claim.rowCount) continue;
        const values = [device.ride_id, device.id, warning.id];
        const update = (state: string, ticket: string | null = null) =>
          this.pool.query(
            'UPDATE ridr.warning_push_deliveries SET state=$4,ticket_id=$5,updated_at=now() WHERE ride_id=$1 AND device_id=$2 AND warning_id=$3',
            [...values, state, ticket],
          );
        try {
          const fresh = await this.locations(registration.account, device.ride_id);
          const allowed = await this.pool.query(
            `SELECT 1 FROM ridr.devices d WHERE d.id=$1 AND d.revoked_at IS NULL AND d.push_token_ciphertext=$2 AND NOT EXISTS (SELECT 1 FROM ridr.ride_alert_state WHERE ride_id=$3 AND body->'acknowledgements'->(($1::uuid)::text) ? ($4::text))`,
            [device.id, device.push_token_ciphertext, device.ride_id, warning.id],
          );
          if (!allowed.rowCount || !fresh.alerts?.some((item) => item.id === warning.id)) {
            await update('suppressed');
            continue;
          }
          const response = await this.fetcher('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(pushMessage(registration.token, device.ride_id, warning.id)),
            signal: AbortSignal.timeout(5000),
          });
          if (!response.ok) {
            await update('failed');
            continue;
          }
          const body = (await response.json()) as { data?: Ticket };
          if (body.data?.status === 'ok' && typeof body.data.id === 'string')
            await update('accepted', body.data.id);
          else {
            await update('failed');
            if (body.data?.details?.error === 'DeviceNotRegistered')
              await this.pool.query(
                'UPDATE ridr.devices SET push_token_ciphertext=NULL WHERE id=$1 AND push_token_ciphertext=$2',
                [device.id, device.push_token_ciphertext],
              );
          }
        } catch {
          await update('unknown');
        }
      }
    }
  }
  private async receipts() {
    const pending = await this.pool.query<{
      ride_id: string;
      device_id: string;
      warning_id: string;
      ticket_id: string;
    }>(
      "SELECT ride_id,device_id,warning_id,ticket_id FROM ridr.warning_push_deliveries WHERE state='accepted' AND updated_at < now()-interval '15 minutes' ORDER BY updated_at LIMIT 100",
    );
    if (!pending.rowCount) return;
    const response = await this.fetcher('https://exp.host/--/api/v2/push/getReceipts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: pending.rows.map((row) => row.ticket_id) }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return;
    const body = (await response.json()) as { data?: Record<string, Ticket> };
    for (const row of pending.rows) {
      const receipt = body.data?.[row.ticket_id];
      if (!receipt) continue;
      if (receipt.details?.error === 'DeviceNotRegistered')
        await this.pool.query('UPDATE ridr.devices SET push_token_ciphertext=NULL WHERE id=$1', [
          row.device_id,
        ]);
      await this.pool.query(
        "UPDATE ridr.warning_push_deliveries SET state=$4,updated_at=now() WHERE ride_id=$1 AND device_id=$2 AND warning_id=$3 AND state='accepted'",
        [
          row.ride_id,
          row.device_id,
          row.warning_id,
          receipt.status === 'ok' ? 'delivered' : 'failed',
        ],
      );
    }
    await this.pool.query(
      "UPDATE ridr.warning_push_deliveries SET state='unknown',updated_at=now() WHERE state='accepted' AND updated_at < now()-interval '24 hours'",
    );
  }
  async close() {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }
}
