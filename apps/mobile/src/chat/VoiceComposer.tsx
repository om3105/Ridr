import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { randomUUID } from 'expo-crypto';
import { File } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import { Button, Notice, styles } from '../auth/components';
import { useRides } from '../rides/provider';
import type { useMotionCheck } from '../rides/use-motion-check';
import { uploadVoice } from './api';

type Proof = ReturnType<typeof useMotionCheck>;
type Preview = {
  uri: string;
  mediaId: string;
  capturedAt: string;
  motion: { state: 'stopped'; source: 'speed' | 'activity'; observedAt: string };
  durationSeconds: number;
};
const discard = (uri: string) => {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    /* Temporary file may already be gone. */
  }
};
export function VoiceComposer({
  id,
  motion,
  onSent,
}: {
  id: string;
  motion: Proof;
  onSent(): void;
}) {
  const { run } = useRides();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const status = useAudioRecorderState(recorder);
  const player = useAudioPlayer(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [recording, setRecording] = useState(false);
  const [message, setMessage] = useState('Record only while stopped. Maximum 30 seconds.');
  const [sending, setSending] = useState(false);
  const started = useRef<{ capturedAt: string; motion: Preview['motion']; at: number } | null>(
    null,
  );
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewRef = useRef<Preview | null>(null);
  previewRef.current = preview;

  const stop = useCallback(
    async (keep: boolean) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      const start = started.current;
      started.current = null;
      setRecording(false);
      try {
        await recorder.stop();
      } catch {
        /* Interrupted recording is discarded. */
      }
      const uri = recorder.uri;
      if (!keep || !start || !uri) {
        if (uri) discard(uri);
        setMessage(
          keep
            ? 'Recording was interrupted. Check that you are stopped and try again.'
            : 'Recording canceled.',
        );
        return;
      }
      const durationSeconds = Math.min(30, (Date.now() - start.at) / 1000);
      if (durationSeconds <= 0 || new File(uri).size > 5 * 1024 * 1024) {
        discard(uri);
        setMessage('Recording is empty or larger than 5 MB. Try again.');
        return;
      }
      setPreview({
        uri,
        mediaId: randomUUID(),
        capturedAt: start.capturedAt,
        motion: start.motion,
        durationSeconds,
      });
      setMessage('Preview, send, or cancel this voice note.');
    },
    [recorder],
  );
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && started.current) void stop(false);
    });
    return () => {
      listener.remove();
      if (timer.current) clearTimeout(timer.current);
      if (started.current)
        void recorder
          .stop()
          .then(() => {
            if (recorder.uri) discard(recorder.uri);
          })
          .catch(() => undefined);
      if (previewRef.current) discard(previewRef.current.uri);
    };
  }, [recorder, stop]);
  useEffect(() => {
    if (status.mediaServicesDidReset && started.current) void stop(false);
  }, [status.mediaServicesDidReset, stop]);
  async function start() {
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setMessage(
          'Microphone permission denied. Enable it in device settings, then try again. Text and presets still work.',
        );
        return;
      }
      const proof = motion.latest();
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      started.current = {
        capturedAt: proof.capturedAt,
        motion: {
          state: 'stopped',
          source: proof.motion.source as 'speed' | 'activity',
          observedAt: proof.motion.observedAt,
        },
        at: Date.now(),
      };
      setRecording(true);
      timer.current = setTimeout(() => {
        void stop(true);
      }, 30000);
      setMessage('Recording… stop before 30 seconds.');
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Microphone could not start. Check permission and try again.',
      );
    }
  }
  async function send() {
    if (!preview || sending) return;
    setSending(true);
    try {
      await run((options) => uploadVoice(options, { ...preview, rideId: id }));
      discard(preview.uri);
      player.pause();
      setPreview(null);
      setMessage('Voice note accepted by the ride.');
      onSent();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `${error.message} The recording is still here; retry with the same ID.`
          : 'Upload failed. Retry the same voice note.',
      );
    } finally {
      setSending(false);
    }
  }
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Voice note</Text>
      <Notice>{message}</Notice>
      {recording ? (
        <Button
          label="Stop recording"
          onPress={() => {
            void stop(true);
          }}
        />
      ) : (
        !preview && (
          <Button
            label="Start voice recording"
            secondary
            disabled={!motion.ready}
            onPress={() => {
              void start();
            }}
          />
        )
      )}
      {preview && (
        <>
          <Text style={styles.detail}>
            {Math.ceil(preview.durationSeconds)} seconds · private to current ride members
          </Text>
          <Button
            label="Preview voice note"
            secondary
            onPress={() => {
              try {
                player.replace(preview.uri);
                player.play();
              } catch {
                setMessage('Audio preview unavailable. Try again or cancel.');
              }
            }}
          />
          <Button
            label="Send voice note"
            busy={sending}
            onPress={() => {
              void send();
            }}
          />
          <Button
            label="Cancel voice note"
            secondary
            disabled={sending}
            onPress={() => {
              player.pause();
              discard(preview.uri);
              setPreview(null);
              setMessage('Recording canceled.');
            }}
          />
        </>
      )}
      {recording && (
        <Button
          label="Cancel recording"
          secondary
          onPress={() => {
            void stop(false);
          }}
        />
      )}
    </View>
  );
}
