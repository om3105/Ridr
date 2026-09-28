import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';

export function Page({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>
      <KeyboardAvoidingView
        style={styles.safe}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.scroller}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.scroll}
        >
          <View style={styles.page}>{children}</View>
        </ScrollView>
        {footer}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Button({
  label,
  onPress,
  busy = false,
  secondary = false,
  danger = false,
  disabled = false,
}: {
  label: string;
  onPress(): void;
  busy?: boolean;
  secondary?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy, disabled: disabled || busy }}
      disabled={disabled || busy}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.secondary,
        danger && { backgroundColor: colors.alert, borderColor: colors.alert },
        (pressed || disabled || busy) && { opacity: 0.7 },
        focused && { borderColor: '#3283d5' },
      ]}
    >
      {busy && <ActivityIndicator color={secondary ? colors.primary : colors.paper} />}
      <Text style={[styles.buttonText, secondary && { color: colors.primary }]}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        {...props}
        style={[styles.input, props.style]}
      />
    </View>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <View accessibilityLiveRegion="polite" style={styles.notice}>
      <Text style={styles.detail}>{children}</Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  scroller: { flex: 1 },
  scroll: { flexGrow: 1, alignItems: 'center' },
  page: {
    width: '100%',
    maxWidth: 520,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 32,
    gap: 14,
  },
  eyebrow: { color: colors.primary, fontSize: 11, fontWeight: '700', letterSpacing: 1.3 },
  title: {
    color: colors.ink,
    fontWeight: '800',
    fontSize: 28,
    letterSpacing: -0.7,
    lineHeight: 34,
  },
  detail: { color: colors.muted, fontSize: 15, lineHeight: 23 },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 16,
    gap: 10,
    backgroundColor: colors.paper,
  },
  cardTitle: { fontSize: 21, color: colors.ink, fontWeight: '700', lineHeight: 27 },
  notice: { backgroundColor: colors.soft, padding: 14, borderRadius: 12 },
  field: { gap: 8 },
  label: { fontSize: 14, fontWeight: '600', color: colors.ink },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.paper,
  },
  button: {
    minHeight: 54,
    padding: 14,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
  },
  secondary: { backgroundColor: colors.paper, borderColor: colors.border },
  buttonText: { color: colors.paper, fontSize: 15, fontWeight: '700', lineHeight: 22 },
  link: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '600',
    paddingVertical: 12,
    lineHeight: 23,
  },
});
