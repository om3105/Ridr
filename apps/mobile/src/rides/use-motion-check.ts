import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { MotionContext } from './models';
import { checkStationary, stopMotionCheck } from './motion-check';
import { useScreenTask } from './use-screen-task';

export function useMotionCheck() {
  const capture = useScreenTask();
  const [context, setContext] = useState<MotionContext | null>(null);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reset = useCallback(() => {
    stopMotionCheck();
    if (timer.current) clearTimeout(timer.current);
    setContext(null);
    setChecking(false);
  }, []);
  useFocusEffect(useCallback(() => () => reset(), [reset]));
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      if (state !== 'active') reset();
    });
    return () => listener.remove();
  }, [reset]);
  const check = async () => {
    if (checking) return;
    const current = capture();
    reset();
    setChecking(true);
    setMessage('Checking speed for about 10 seconds. Stay stopped in a safe place.');
    try {
      const result = await checkStationary();
      if (!current()) return;
      setContext(result);
      setMessage('Your phone reports that you are stopped. This check expires shortly.');
      timer.current = setTimeout(() => {
        setContext(null);
        setMessage('Check again before using a stationary control.');
      }, 20000);
    } catch (error) {
      if (current())
        setMessage(error instanceof Error ? error.message : 'Motion could not be checked.');
    } finally {
      if (current()) setChecking(false);
    }
  };
  const latest = (): MotionContext => {
    if (!context || Date.now() - Date.parse(context.motion.observedAt) > 25000)
      throw new Error('Check that you are stopped before using this control.');
    return { motion: context.motion, capturedAt: new Date().toISOString() };
  };
  return { ready: context !== null, checking, message, check, latest, reset };
}
