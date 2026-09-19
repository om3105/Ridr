import { Text, View } from 'react-native';
import Svg, { Polyline, Circle } from 'react-native-svg';
import type { RouteMapProps } from './RouteMap';
export default function RouteMap({ points }: RouteMapProps) {
  if (!points.length)
    return <Text>Use the Android/iOS app to import a GPX or draw on the street map.</Text>;
  const west = Math.min(...points.map((p) => p.lon)),
    east = Math.max(...points.map((p) => p.lon));
  const south = Math.min(...points.map((p) => p.lat)),
    north = Math.max(...points.map((p) => p.lat));
  const coordinates = points.map((p) => [
    20 + ((p.lon - west) / (east - west || 1)) * 300,
    220 - ((p.lat - south) / (north - south || 1)) * 200,
  ]);
  return (
    <View>
      <Svg
        viewBox="0 0 340 240"
        height={240}
        accessibilityLabel="Saved route overview, green start and orange finish"
      >
        <Polyline
          points={coordinates.map((p) => p.join(',')).join(' ')}
          fill="none"
          stroke="#16715b"
          strokeWidth={3}
        />
        <Circle cx={coordinates[0]![0]} cy={coordinates[0]![1]} r={6} fill="green" />
        <Circle cx={coordinates.at(-1)![0]} cy={coordinates.at(-1)![1]} r={6} fill="orange" />
      </Svg>
      <Text>
        Route overview, without road tiles. Direction: green start → orange finish. Draw on the
        native app.
      </Text>
    </View>
  );
}
