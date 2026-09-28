const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function photoDataUri(bytes: Uint8Array): string {
  let encoded = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]!;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    encoded += alphabet[first >> 2]!;
    encoded += alphabet[((first & 3) << 4) | ((second ?? 0) >> 4)]!;
    encoded += second === undefined ? '=' : alphabet[((second & 15) << 2) | ((third ?? 0) >> 6)]!;
    encoded += third === undefined ? '=' : alphabet[third & 63]!;
  }
  return `data:image/jpeg;base64,${encoded}`;
}
