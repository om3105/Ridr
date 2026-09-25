import { Text } from 'react-native';
import type { useMotionCheck } from '../rides/use-motion-check';
export function VoiceComposer(_props: {
  id: string;
  motion: ReturnType<typeof useMotionCheck>;
  onSent(): void;
}) {
  return <Text>Record voice notes in the Android or iOS app.</Text>;
}
