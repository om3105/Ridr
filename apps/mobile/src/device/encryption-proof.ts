export interface ProofDatabase {
  execAsync(sql: string): Promise<void>;
  getFirstAsync<T>(sql: string): Promise<T | null>;
  closeAsync(): Promise<void>;
}

// A version string alone is insufficient: a separate connection must fail to read
// the persisted page using the wrong key, and the real key must reopen that page.
export async function proveEncryptedDatabase(
  open: () => Promise<ProofDatabase>,
  key: string,
): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid storage key.');
  let database = await open();
  try {
    await database.execAsync(`PRAGMA key = "x'${key}'"`);
    const version = await database.getFirstAsync<{ cipher_version: string }>(
      'PRAGMA cipher_version',
    );
    if (!version?.cipher_version)
      throw new Error('Encrypted storage is unavailable in this build.');
    await database.execAsync(
      'CREATE TABLE IF NOT EXISTS encryption_probe (value INTEGER NOT NULL)',
    );
    await database.execAsync(
      'DELETE FROM encryption_probe; INSERT INTO encryption_probe VALUES (5)',
    );
  } finally {
    await database.closeAsync();
  }

  const incorrectKey = `${key[0] === '0' ? '1' : '0'}${key.slice(1)}`;
  database = await open();
  let rejected = false;
  try {
    await database.execAsync(`PRAGMA key = "x'${incorrectKey}'"`);
    try {
      await database.getFirstAsync('SELECT value FROM encryption_probe');
    } catch {
      rejected = true;
    }
  } finally {
    await database.closeAsync();
  }
  if (!rejected) throw new Error('Storage did not reject an incorrect encryption key.');

  database = await open();
  try {
    await database.execAsync(`PRAGMA key = "x'${key}'"`);
    const value = await database.getFirstAsync<{ value: number }>(
      'SELECT value FROM encryption_probe',
    );
    if (value?.value !== 5) throw new Error('Encrypted storage could not be reopened.');
  } finally {
    await database.closeAsync();
  }
}
