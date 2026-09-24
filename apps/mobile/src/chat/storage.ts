import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import { proveEncryptedDatabase } from '../device/encryption-proof';
import type { Draft } from './api';

export type PendingState = 'pending' | 'failed' | 'unsent';
export interface PendingMessage {
  draft: Draft;
  state: PendingState;
}
const DB = 'ridr-chat-queue.db',
  KEY = 'ridr.chat.queue.key';
const keyOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
let database: SQLite.SQLiteDatabase | null = null;
let opening: Promise<SQLite.SQLiteDatabase> | null = null;
async function open() {
  if (database) return database;
  if (!opening) {
    opening = (async () => {
      let key = await SecureStore.getItemAsync(KEY, keyOptions);
      if (!key) {
        key = Array.from(await Crypto.getRandomBytesAsync(32), (n) =>
          n.toString(16).padStart(2, '0'),
        ).join('');
        await SecureStore.setItemAsync(KEY, key, keyOptions);
      }
      await proveEncryptedDatabase(
        () => SQLite.openDatabaseAsync(DB, { useNewConnection: true }),
        key,
      );
      const db = await SQLite.openDatabaseAsync(DB, { useNewConnection: true });
      await db.execAsync(`PRAGMA key = "x'${key}'"`);
      await db.execAsync(
        "CREATE TABLE IF NOT EXISTS pending_messages (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, ride_id TEXT NOT NULL, body TEXT NOT NULL, state TEXT NOT NULL CHECK (state IN ('pending','failed','unsent')))",
      );
      database = db;
      return db;
    })().finally(() => {
      opening = null;
    });
  }
  return opening;
}
export async function listPending(userId: string, rideId: string): Promise<PendingMessage[]> {
  const db = await open();
  const rows = await db.getAllAsync<{ body: string; state: PendingState }>(
    'SELECT body,state FROM pending_messages WHERE user_id=? AND ride_id=? ORDER BY rowid',
    [userId, rideId],
  );
  return rows.map((row) => ({ draft: JSON.parse(row.body) as Draft, state: row.state }));
}
export async function enqueue(userId: string, draft: Draft) {
  const db = await open();
  const count = await db.getFirstAsync<{ total: number }>(
    'SELECT count(*) AS total FROM pending_messages WHERE user_id=?',
    [userId],
  );
  if ((count?.total ?? 0) >= 50)
    throw new Error('The encrypted message queue is full. Reconnect before sending more.');
  await db.runAsync(
    'INSERT INTO pending_messages(id,user_id,ride_id,body,state) VALUES (?,?,?,?,?)',
    [draft.id, userId, draft.rideId, JSON.stringify(draft), 'pending'],
  );
}
export async function setPendingState(id: string, state: PendingState) {
  await (await open()).runAsync('UPDATE pending_messages SET state=? WHERE id=?', [state, id]);
}
export async function removePending(id: string) {
  await (await open()).runAsync('DELETE FROM pending_messages WHERE id=?', [id]);
}
export async function clearChatQueue() {
  await opening?.catch(() => undefined);
  if (database) {
    await database.closeAsync();
    database = null;
  }
  await SecureStore.deleteItemAsync(KEY, keyOptions);
  const db = await SQLite.openDatabaseAsync(DB, { useNewConnection: true });
  await db.closeAsync();
  await SQLite.deleteDatabaseAsync(DB);
}
