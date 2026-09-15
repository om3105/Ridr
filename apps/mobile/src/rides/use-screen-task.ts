import { useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';
import { rideSessionGeneration } from './private-session';

export function useScreenTask() {
  const scope = useRef({ focused: true, version: 0 });
  useFocusEffect(
    useCallback(() => {
      scope.current.focused = true;
      return () => {
        scope.current.focused = false;
        scope.current.version++;
      };
    }, []),
  );
  return useCallback(() => {
    const version = scope.current.version;
    const generation = rideSessionGeneration();
    return () =>
      scope.current.focused &&
      scope.current.version === version &&
      rideSessionGeneration() === generation;
  }, []);
}
