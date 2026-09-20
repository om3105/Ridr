import { Text, View } from 'react-native';
import type { GroupProjection } from './model';
export default function GroupMap({ data }: { data: GroupProjection['data'] }) {
  return (
    <View>
      <Text>Open the Android or iOS app for the interactive road map.</Text>
      <Text>
        {data.features.length} reporting markers · member positions and status are listed below.
      </Text>
    </View>
  );
}
