import type { TrailGeometry } from './trails';
import { Text, View } from 'react-native';
import type { GroupProjection } from './model';
export default function GroupMap({
  data,
  pins = [],
}: {
  data: GroupProjection['data'];
  trail?: TrailGeometry;
  pins?: { id: string; lat: number; lon: number }[];
  onPinSelect?: (coordinate: { lat: number; lon: number }) => void;
  focus?: { lat: number; lon: number } | null;
}) {
  return (
    <View>
      <Text>Open the Android or iOS app for the interactive road map.</Text>
      <Text>
        {data.features.length} reporting markers · member positions and status are listed below.
      </Text>
      <Text>{pins.length} message pins · select a point in the Android or iOS map.</Text>
    </View>
  );
}
