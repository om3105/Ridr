import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { AppState, Linking, Platform, Pressable, Text, View } from 'react-native';
import { useAuth } from '../auth/provider';
import { apiUrl } from '../connection';
import { useRides } from '../rides/provider';
import { canRequestSponsored, fetchSponsoredCard,
  type SponsoredCardData, type SponsoredPlacement } from './eligibility';

export default function SponsoredCard({ placement, rideId, summaryLoaded = false }: {
  placement: SponsoredPlacement; rideId?: string; summaryLoaded?: boolean;
}) {
  const auth = useAuth();
  const { recentRides } = useRides();
  const [loaded, setLoaded] = useState<{ scope: string; card: SponsoredCardData } | null>(null);
  const eligible = canRequestSponsored({ placement, authState: auth.state, profile: auth.profile,
    hasActiveRide: Object.keys(recentRides).length > 0, summaryLoaded,
    isNative: Platform.OS !== 'web' });
  const token = auth.session?.access_token;
  const scope = `${auth.profile?.id ?? ''}|${token ?? ''}|${placement}|${rideId ?? ''}`;
  useFocusEffect(useCallback(() => {
    let focused = true;
    let sequence = 0;
    let controller: AbortController | null = null;
    const clear = () => {
      sequence++;
      controller?.abort();
      controller = null;
      setLoaded(null);
    };
    const load = async (reset: boolean) => {
      if (reset) clear();
      else { sequence++; controller?.abort(); }
      if (!eligible || !token || AppState.currentState !== 'active') return;
      const request = sequence;
      controller = new AbortController();
      try {
        const result = await fetchSponsoredCard({ apiUrl, accessToken: token, placement, rideId,
          signal: controller.signal });
        if (focused && sequence === request) setLoaded(result ? { scope, card: result } : null);
      } catch { if (focused && sequence === request) setLoaded(null); }
    };
    void load(true);
    const timer = setInterval(() => { void load(false); }, 10000);
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active') void load(true);
      else clear();
    });
    return () => { focused = false; clear(); clearInterval(timer); app.remove(); };
  }, [eligible, token, placement, rideId, scope]));
  const card = loaded?.scope === scope ? loaded.card : null;
  if (!eligible || !card) return null;
  const foreground = '#24352b';
  const subdued = '#475a4e';
  return (
    <View accessibilityLabel="Sponsored content" style={{ backgroundColor: '#fffdf6',
      borderColor: '#364e3d', borderWidth: 2, borderRadius: 16,
      padding: 20, gap: 10 }}>
      <Text style={{ color: subdued, fontSize: 12, fontWeight: '800', letterSpacing: 1.3 }}>
        Sponsored
      </Text>
      <Text style={{ color: foreground, fontSize: 20, lineHeight: 27, fontWeight: '700' }}>
        {card.title}
      </Text>
      <Text style={{ color: subdued, fontSize: 15, lineHeight: 23 }}>{card.description}</Text>
      <Pressable accessibilityRole="link" accessibilityLabel={`Visit sponsor: ${card.title}`}
        onPress={() => { void Linking.openURL(card.url).catch(() => setLoaded(null)); }}
        style={{ alignSelf: 'flex-start', minHeight: 48, justifyContent: 'center',
          paddingVertical: 10, paddingHorizontal: 12,
          borderColor: foreground, borderWidth: 2, borderRadius: 8 }}>
        <Text style={{ color: foreground, fontSize: 15, fontWeight: '700' }}>Visit sponsor →</Text>
      </Pressable>
    </View>
  );
}
