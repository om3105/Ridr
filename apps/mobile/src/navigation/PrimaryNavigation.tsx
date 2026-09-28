import { Link } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { colors } from '../theme';

type Destination = 'home' | 'map' | 'rides' | 'history' | 'profile';

const destinations = [
  { key: 'home', label: 'Home', href: '/' },
  { key: 'map', label: 'Map', href: '/map' },
  { key: 'rides', label: 'Rides', href: '/rides' },
  { key: 'history', label: 'History', href: '/history' },
  { key: 'profile', label: 'Profile', href: '/profile' },
] as const;

export function PrimaryNavigation({ active }: { active: Destination }) {
  return (
    <View accessibilityRole="tablist" style={styles.bar}>
      {destinations.map((destination) => (
        <Link
          key={destination.key}
          href={destination.href}
          replace
          accessibilityRole="tab"
          accessibilityState={{ selected: active === destination.key }}
          style={[styles.tab, active === destination.key && styles.selected]}
        >
          {destination.label}
        </Link>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: colors.paper,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  tab: {
    flex: 1,
    minHeight: 58,
    paddingTop: 18,
    textAlign: 'center',
    color: colors.muted,
    fontSize: 13,
    fontWeight: '600',
  },
  selected: {
    color: colors.primary,
    fontWeight: '800',
    borderTopWidth: 3,
    borderTopColor: colors.primary,
    paddingTop: 15,
  },
});
