import { Link } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

export default function NativeOnly({ title }: { title: string }) {
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.eyebrow}>ON YOUR PHONE</Text>
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      <View style={styles.card}>
        <Text style={styles.copy}>
          Open the Ridr development app on iOS or Android to use the native map and location checks.
          The browser preview does not test phone permissions, background location or encrypted
          device storage.
        </Text>
        <Text style={styles.copy}>Signing in does not enable location access or sharing.</Text>
      </View>
      <Link href="/" style={styles.link}>
        Back to home →
      </Link>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  page: { padding: 24, gap: 20, maxWidth: 520, width: '100%', alignSelf: 'center' },
  eyebrow: { color: colors.muted, fontSize: 10, fontWeight: '700', letterSpacing: 1.4 },
  title: { fontSize: 32, lineHeight: 38, fontWeight: '800', color: colors.ink },
  card: { borderRadius: 16, padding: 20, gap: 12, backgroundColor: colors.soft },
  copy: { color: colors.muted, fontSize: 15, lineHeight: 24 },
  link: { paddingVertical: 14, color: colors.primary, fontSize: 14, fontWeight: '700' },
});
