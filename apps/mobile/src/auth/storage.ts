export interface StringStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

type Manifest = { generation: string; count: number };
const maxChunks = 64;

function manifest(value: string | null): Manifest | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Manifest;
    return /^[a-zA-Z0-9-]+$/.test(parsed.generation) &&
      Number.isInteger(parsed.count) &&
      parsed.count > 0 &&
      parsed.count <= maxChunks
      ? parsed
      : null;
  } catch {
    return null;
  }
}

// Keep each encrypted item below older platform keychain value limits, including UTF-8 names.
function split(value: string): string[] {
  const chunks: string[] = [];
  let chunk = '';
  let bytes = 0;
  for (const point of value) {
    const code = point.codePointAt(0)!;
    const size = code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
    if (bytes + size > 1500) {
      chunks.push(chunk);
      chunk = '';
      bytes = 0;
    }
    chunk += point;
    bytes += size;
  }
  chunks.push(chunk);
  if (chunks.length > maxChunks) throw new Error('Session exceeds secure storage capacity.');
  return chunks;
}

export function createChunkedStorage(
  store: StringStorage,
  generation: () => string,
): StringStorage {
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation, operation);
    queue = result.catch(() => undefined);
    return result;
  }
  function chunkKey(key: string, item: Manifest, index: number) {
    return `${key}.${item.generation}.${index}`;
  }
  async function clearChunks(key: string, item: Manifest | null) {
    if (item)
      await Promise.all(
        Array.from({ length: item.count }, (_, i) => store.removeItem(chunkKey(key, item, i))),
      );
  }
  return {
    getItem: (key) =>
      serial(async () => {
        const item = manifest(await store.getItem(key));
        if (!item) return null;
        const chunks = await Promise.all(
          Array.from({ length: item.count }, (_, i) => store.getItem(chunkKey(key, item, i))),
        );
        if (chunks.some((chunk) => chunk === null)) {
          await store.removeItem(key);
          await clearChunks(key, item);
          return null;
        }
        return chunks.join('');
      }),
    setItem: (key, value) =>
      serial(async () => {
        const previous = manifest(await store.getItem(key));
        let next: Manifest | null = null;
        try {
          const chunks = split(value);
          next = { generation: generation(), count: chunks.length };
          for (const [index, chunk] of chunks.entries())
            await store.setItem(chunkKey(key, next, index), chunk);
          await store.setItem(key, JSON.stringify(next));
        } catch {
          // A partial write never restores an older credential after the caller was told saving failed.
          await store.removeItem(key);
          await clearChunks(key, next);
          await clearChunks(key, previous);
          throw new Error('Your session could not be saved securely.');
        }
        await clearChunks(key, previous);
      }),
    removeItem: (key) =>
      serial(async () => {
        const item = manifest(await store.getItem(key));
        // Invalidate the pointer before deleting parts so an interrupted logout cannot restore it.
        await store.removeItem(key);
        await clearChunks(key, item);
      }),
  };
}

export function createMemoryStorage(): StringStorage {
  const values = new Map<string, string>();
  return {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
    removeItem: async (key) => {
      values.delete(key);
    },
  };
}
