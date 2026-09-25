import { ApiError } from './api-errors.js';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';

const ffprobe = (createRequire(import.meta.url)('ffprobe-static') as { path: string }).path;
const execute = promisify(execFile);

const invalid = () =>
  new ApiError(422, 'INVALID_VOICE', 'Record an AAC voice note of 30 seconds or less.');

// Expo's native HIGH_QUALITY recorder writes AAC in an MPEG-4 container. Read the
// movie header rather than trusting a client-supplied duration or file extension.
export function inspectVoice(bytes: Buffer): { durationSeconds: number } {
  if (bytes.length < 64 || bytes.length > 5 * 1024 * 1024) throw invalid();
  let offset = 0;
  let foundBrand = false;
  let duration: number | null = null;
  let hasAac = false;
  while (offset + 8 <= bytes.length) {
    const size = bytes.readUInt32BE(offset);
    const kind = bytes.toString('ascii', offset + 4, offset + 8);
    if (size < 8 || offset + size > bytes.length) throw invalid();
    if (kind === 'ftyp') {
      const brand = bytes.toString('ascii', offset + 8, offset + 12);
      foundBrand = ['M4A ', 'mp42', 'isom', 'iso2'].includes(brand);
    }
    if (kind === 'moov') {
      const movie = bytes.subarray(offset + 8, offset + size);
      hasAac = movie.includes(Buffer.from('mp4a'));
      for (let inner = 0; inner + 8 <= movie.length; ) {
        const atomSize = movie.readUInt32BE(inner);
        if (atomSize < 8 || inner + atomSize > movie.length) throw invalid();
        if (movie.toString('ascii', inner + 4, inner + 8) === 'mvhd') {
          const version = movie[inner + 8];
          const scaleAt = inner + (version === 1 ? 28 : 20);
          const ticksAt = inner + (version === 1 ? 32 : 24);
          if (
            (version !== 0 && version !== 1) ||
            ticksAt + (version === 1 ? 8 : 4) > inner + atomSize
          )
            throw invalid();
          const scale = movie.readUInt32BE(scaleAt);
          const ticks =
            version === 1 ? Number(movie.readBigUInt64BE(ticksAt)) : movie.readUInt32BE(ticksAt);
          duration = scale ? ticks / scale : null;
        }
        inner += atomSize;
      }
    }
    offset += size;
  }
  if (
    !foundBrand ||
    !hasAac ||
    duration === null ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > 30
  )
    throw invalid();
  return { durationSeconds: duration };
}

export async function probeVoice(path: string): Promise<number> {
  try {
    const { stdout } = await execute(
      ffprobe,
      [
        '-v',
        'error',
        '-count_frames',
        '-show_entries',
        'format=duration:stream=codec_name,codec_type,nb_read_frames',
        '-of',
        'json',
        path,
      ],
      { timeout: 45000, maxBuffer: 16384 },
    );
    const parsed = JSON.parse(stdout) as {
      format?: { duration?: string };
      streams?: { codec_name?: string; codec_type?: string; nb_read_frames?: string }[];
    };
    const duration = Number(parsed.format?.duration);
    if (
      !Number.isFinite(duration) ||
      duration <= 0 ||
      duration > 30 ||
      parsed.streams?.length !== 1 ||
      parsed.streams[0]?.codec_type !== 'audio' ||
      parsed.streams[0]?.codec_name !== 'aac' ||
      Number(parsed.streams[0]?.nb_read_frames) < 1
    )
      throw invalid();
    return duration;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw invalid();
  }
}
