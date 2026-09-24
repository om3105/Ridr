import type { TrailGeometry } from './trails';
import { Camera, GeoJSONSource, Layer, Map } from '@maplibre/maplibre-react-native';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Button } from '../auth/components';
import { mapTilerStyle } from '../device/policy';
import type { GroupProjection } from './model';
export default function GroupMap({
  data,
  trail,
  pins = [],
  onPinSelect,
  focus,
}: {
  data: GroupProjection['data'];
  trail?: TrailGeometry;
  pins?: { id: string; lat: number; lon: number }[];
  onPinSelect?: (coordinate: { lat: number; lon: number }) => void;
  focus?: { lat: number; lon: number } | null;
}) {
  const [fit, setFit] = useState(0);
  const [retry, setRetry] = useState(0);
  const [failed, setFailed] = useState(false);
  const style = mapTilerStyle(process.env.EXPO_PUBLIC_MAPTILER_KEY);
  const points = data.features.map((feature) => feature.geometry.coordinates);
  for (const feature of trail?.features ?? []) {
    if (feature.geometry.type === 'LineString') points.push(...feature.geometry.coordinates);
    else points.push(feature.geometry.coordinates);
  }
  for (const pin of pins) points.push([pin.lon, pin.lat]);
  if (!style)
    return <Text>Road map unavailable: configure the map key. Member details remain below.</Text>;
  return (
    <View style={{ gap: 8 }}>
      <View style={{ height: 380, borderRadius: 16, overflow: 'hidden' }}>
        <Map
          key={retry}
          style={{ flex: 1 }}
          mapStyle={style}
          attribution
          compass
          onDidFailLoadingMap={() => setFailed(true)}
          onPress={(event) => {
            const [lon, lat] = event.nativeEvent.lngLat;
            if (onPinSelect && Number.isFinite(lat) && Number.isFinite(lon))
              onPinSelect({ lat, lon });
          }}
        >
          <Camera
            key={`${fit}-${focus?.lat ?? ''}-${focus?.lon ?? ''}-${points.length ? 'located' : 'empty'}`}
            initialViewState={
              focus
                ? { center: [focus.lon, focus.lat], zoom: 15 }
                : points.length > 1
                  ? {
                      bounds: [
                        Math.min(...points.map((p) => p[0]!)) - 0.0005,
                        Math.max(-90, Math.min(...points.map((p) => p[1]!)) - 0.0005),
                        Math.max(...points.map((p) => p[0]!)) + 0.0005,
                        Math.min(90, Math.max(...points.map((p) => p[1]!)) + 0.0005),
                      ],
                      padding: { top: 60, bottom: 60, left: 60, right: 60 },
                    }
                  : { center: (points[0] as [number, number]) ?? [73.849, 18.526], zoom: 12 }
            }
          />
          {trail && (
            <GeoJSONSource id="member-trail" data={trail}>
              <Layer
                id="trail-line"
                type="line"
                filter={['==', ['get', 'kind'], 'recorded']}
                paint={{ 'line-color': '#3b56b7', 'line-width': 4 }}
              />
              <Layer
                id="trail-observations"
                type="circle"
                filter={['==', ['get', 'kind'], 'observation']}
                paint={{ 'circle-color': '#3b56b7', 'circle-radius': 5 }}
              />
              <Layer
                id="trail-gaps"
                type="circle"
                filter={['==', ['get', 'kind'], 'gap']}
                paint={{
                  'circle-color': '#ad6500',
                  'circle-radius': 6,
                  'circle-stroke-color': '#fff',
                  'circle-stroke-width': 2,
                }}
              />
            </GeoJSONSource>
          )}
          {!!pins.length && (
            <GeoJSONSource
              id="message-pins"
              data={{
                type: 'FeatureCollection',
                features: pins.map((pin) => ({
                  type: 'Feature',
                  properties: { id: pin.id },
                  geometry: { type: 'Point', coordinates: [pin.lon, pin.lat] },
                })),
              }}
            >
              <Layer
                id="message-pin-dots"
                type="circle"
                paint={{
                  'circle-radius': 8,
                  'circle-color': '#7546b4',
                  'circle-stroke-color': '#ffffff',
                  'circle-stroke-width': 2,
                }}
              />
            </GeoJSONSource>
          )}
          <GeoJSONSource id="group-members" data={data}>
            <Layer
              id="member-dots"
              type="circle"
              paint={{
                'circle-radius': 9,
                'circle-color': ['get', 'color'],
                'circle-stroke-color': '#fff',
                'circle-stroke-width': 2,
              }}
            />
            <Layer
              id="member-names"
              type="symbol"
              layout={{
                'text-field': ['get', 'label'],
                'text-size': 13,
                'text-offset': [0, 1.6],
                'text-allow-overlap': false,
              }}
              paint={{ 'text-color': '#102f27', 'text-halo-color': '#fff', 'text-halo-width': 2 }}
            />
            <Layer
              id="member-heading"
              type="symbol"
              filter={['!=', ['get', 'heading'], null]}
              layout={{
                'text-field': '↑',
                'text-size': 24,
                'text-rotate': ['coalesce', ['get', 'heading'], 0],
                'text-rotation-alignment': 'map',
                'text-allow-overlap': true,
              }}
              paint={{ 'text-color': '#fff' }}
            />
          </GeoJSONSource>
        </Map>
      </View>
      {failed && (
        <>
          <Text accessibilityRole="alert">
            Road tiles could not load. Check your connection; member details remain available.
          </Text>
          <Button
            label="Retry map"
            secondary
            onPress={() => {
              setFailed(false);
              setRetry((value) => value + 1);
            }}
          />
        </>
      )}
      <Button
        label="Fit group"
        secondary
        disabled={!points.length}
        onPress={() => setFit((value) => value + 1)}
      />
    </View>
  );
}
