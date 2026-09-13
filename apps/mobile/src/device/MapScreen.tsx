import { Camera, Map } from '@maplibre/maplibre-react-native';
import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { mapTilerStyle } from './policy';
import { sampleMapStyle } from './sample-map';

const configuredStyle = mapTilerStyle(process.env.EXPO_PUBLIC_MAPTILER_KEY);

export default function MapScreen() {
  const [sample, setSample] = useState(!configuredStyle);
  const [attempt, setAttempt] = useState(0);
  const [mapState, setMapState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [linkError, setLinkError] = useState(false);
  useEffect(() => {
    const timer = setTimeout(
      () => setMapState((state) => (state === 'loading' ? 'failed' : state)),
      15_000,
    );
    return () => clearTimeout(timer);
  }, [attempt, sample]);

  function reload(useSample: boolean) {
    setSample(useSample);
    setMapState('loading');
    setAttempt((previous) => previous + 1);
  }

  return (
    <SafeAreaView edges={['bottom']} style={styles.page}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>EXPLORE AT YOUR PACE</Text>
        <Text accessibilityRole="header" style={styles.title}>
          A little room to roam.
        </Text>
        <Text style={styles.copy}>
          {sample
            ? 'A fictional sample park, made for this preview. These paths are not real roads.'
            : 'Explore the map. Your location stays off until you choose a location check.'}
        </Text>
        <View style={styles.mapFrame}>
          <Map
            key={`${sample}-${attempt}`}
            testID="ridr-native-map"
            mapStyle={sample ? sampleMapStyle : configuredStyle!}
            style={styles.map}
            attribution
            compass
            onDidFinishRenderingMapFully={() =>
              setMapState((state) => (state === 'failed' ? 'failed' : 'ready'))
            }
            onDidFailLoadingMap={() => setMapState('failed')}
          >
            <Camera initialViewState={{ center: [73.849, 18.526], zoom: 14 }} />
          </Map>
          <View pointerEvents="none" style={styles.badge}>
            <Text style={styles.badgeText}>
              {sample ? 'FICTIONAL SAMPLE AREA' : 'LOCATION IS OFF'}
            </Text>
          </View>
        </View>
        <Text accessibilityLiveRegion="polite" style={styles.state}>
          {mapState === 'loading'
            ? 'Loading the map…'
            : mapState === 'ready'
              ? sample
                ? 'Sample map rendered on this device.'
                : 'Map rendered on this device.'
              : 'The map could not finish loading. Check your connection or try the sample area.'}
        </Text>
        {mapState === 'failed' && (
          <Pressable
            accessibilityRole="button"
            onPress={() => reload(sample)}
            style={styles.button}
          >
            <Text style={styles.buttonText}>Try loading again</Text>
          </Pressable>
        )}
        {configuredStyle && (
          <Pressable
            accessibilityRole="button"
            onPress={() => reload(!sample)}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryText}>
              {sample ? 'Open street map' : 'Use sample area'}
            </Text>
          </Pressable>
        )}
        {!sample && (
          <View style={styles.attribution}>
            <Pressable
              accessibilityRole="link"
              onPress={() => {
                void Linking.openURL('https://www.maptiler.com/copyright/').catch(() =>
                  setLinkError(true),
                );
              }}
            >
              <Text style={styles.secondaryText}>© MapTiler</Text>
            </Pressable>
            <Pressable
              accessibilityRole="link"
              onPress={() => {
                void Linking.openURL('https://www.openstreetmap.org/copyright').catch(() =>
                  setLinkError(true),
                );
              }}
            >
              <Text style={styles.secondaryText}>© OpenStreetMap contributors</Text>
            </Pressable>
          </View>
        )}
        {linkError && (
          <Text accessibilityRole="alert" style={styles.copy}>
            The attribution page could not open. Try again when connected.
          </Text>
        )}
        <View style={styles.note}>
          <Text style={styles.noteTitle}>Your location, your choice</Text>
          <Text style={styles.copy}>
            {sample
              ? 'This sample is stored inside Ridr and works without a map account. The dot marks a sample point, not you.'
              : 'MapTiler receives the map areas you request as you browse. Ridr does not send your identity, ride trail or contacts to the map provider.'}
          </Text>
          <Link href="../permissions" style={styles.link}>
            Manage location access →
          </Link>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.paper },
  content: { padding: 24, gap: 14, width: '100%', maxWidth: 600, alignSelf: 'center' },
  eyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 1.4, color: colors.muted },
  title: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '800',
    color: colors.ink,
    letterSpacing: -0.7,
  },
  copy: { fontSize: 14, lineHeight: 22, color: colors.muted },
  mapFrame: { height: 330, borderRadius: 18, overflow: 'hidden', backgroundColor: colors.soft },
  map: { flex: 1 },
  badge: {
    position: 'absolute',
    top: 14,
    left: 14,
    backgroundColor: colors.paper,
    borderRadius: 6,
    padding: 8,
  },
  badgeText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5, color: colors.primary },
  state: { fontSize: 12, lineHeight: 19, color: colors.muted },
  button: {
    minHeight: 48,
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  buttonText: { color: colors.paper, fontWeight: '700', fontSize: 14 },
  secondaryButton: {
    minHeight: 48,
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.soft,
  },
  secondaryText: { color: colors.primary, fontWeight: '600', fontSize: 12, lineHeight: 20 },
  attribution: { flexDirection: 'row', gap: 14, flexWrap: 'wrap' },
  note: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 20, gap: 8 },
  noteTitle: { fontSize: 16, color: colors.ink, fontWeight: '700' },
  link: { color: colors.primary, fontWeight: '700', fontSize: 14, paddingVertical: 12 },
});
