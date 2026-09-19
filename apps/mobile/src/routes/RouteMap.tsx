import { Camera, GeoJSONSource, Layer, Map } from '@maplibre/maplibre-react-native';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { mapTilerStyle } from '../device/policy';
import type { Point } from './api';
export interface RouteMapProps {
  points: Point[];
  waypoints: Point[];
  onPoint?: (point: Point) => void;
}
export default function RouteMap({ points, waypoints, onPoint }: RouteMapProps) {
  const style = mapTilerStyle(process.env.EXPO_PUBLIC_MAPTILER_KEY);
  const [failed, setFailed] = useState(false);
  const center = points[0] ?? waypoints[0] ?? { lon: 73.849, lat: 18.526 };
  if (!style)
    return <Text>Configure the map key to view roads. GPX import remains available.</Text>;
  return (
    <View style={{ gap: 8 }}>
      <View style={{ height: 340, borderRadius: 16, overflow: 'hidden' }}>
        <Map
          style={{ flex: 1 }}
          mapStyle={style}
          attribution
          compass
          onDidFailLoadingMap={() => setFailed(true)}
          onPress={(event) => {
            const [lon, lat] = event.nativeEvent.lngLat;
            if (!failed) onPoint?.({ lat, lon });
          }}
        >
          <Camera
            key={`${points[0]?.lon}-${points.length}`}
            initialViewState={
              points.length > 1
                ? {
                    bounds: [
                      Math.min(...points.map((p) => p.lon)),
                      Math.min(...points.map((p) => p.lat)),
                      Math.max(...points.map((p) => p.lon)),
                      Math.max(...points.map((p) => p.lat)),
                    ],
                    padding: { top: 40, bottom: 40, left: 40, right: 40 },
                  }
                : { center: [center.lon, center.lat], zoom: 12 }
            }
          />
          {points.length > 1 && (
            <GeoJSONSource
              id="saved-route"
              data={{
                type: 'Feature',
                properties: {},
                geometry: { type: 'LineString', coordinates: points.map((p) => [p.lon, p.lat]) },
              }}
            >
              <Layer
                id="route-line"
                type="line"
                paint={{ 'line-color': '#16715b', 'line-width': 5 }}
              />
              <Layer
                id="route-direction"
                type="symbol"
                layout={{
                  'symbol-placement': 'line',
                  'symbol-spacing': 70,
                  'text-field': '➤',
                  'text-size': 18,
                  'text-keep-upright': false,
                }}
                paint={{
                  'text-color': '#102f27',
                  'text-halo-color': '#ffffff',
                  'text-halo-width': 1,
                }}
              />
            </GeoJSONSource>
          )}
          {(waypoints.length > 0 || points.length > 0) && (
            <GeoJSONSource
              id="route-points"
              data={{
                type: 'FeatureCollection',
                features: (waypoints.length
                  ? waypoints
                  : [points[0]!, points[points.length - 1]!]
                ).map((p, i) => ({
                  type: 'Feature',
                  properties: {
                    label: waypoints.length ? String(i + 1) : i === 0 ? 'Start' : 'Finish',
                  },
                  geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
                })),
              }}
            >
              <Layer
                id="waypoint-dots"
                type="circle"
                paint={{
                  'circle-radius': 7,
                  'circle-color': '#16715b',
                  'circle-stroke-color': '#ffffff',
                  'circle-stroke-width': 2,
                }}
              />
              <Layer
                id="waypoint-labels"
                type="symbol"
                layout={{
                  'text-field': ['get', 'label'],
                  'text-size': 13,
                  'text-offset': [0, 1.5],
                }}
                paint={{
                  'text-color': '#102f27',
                  'text-halo-color': '#ffffff',
                  'text-halo-width': 2,
                }}
              />
            </GeoJSONSource>
          )}
        </Map>
      </View>
      {failed && (
        <Text accessibilityRole="alert">
          Map tiles could not load. Reopen this screen to retry. The saved route is unchanged.
        </Text>
      )}
    </View>
  );
}
