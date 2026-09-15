import { Pressable, Text, View } from 'react-native';
import { styles } from '../auth/components';
import { colors } from '../theme';
import type { PhysicalRole, Transport } from './models';

export const transportNames: Record<Transport, string> = {
  motorcycle: 'Motorcycle',
  cycling: 'Cycling',
  car: 'Car',
};
export const roleNames: Record<PhysicalRole, string> = { rider: 'Rider', pillion: 'Pillion' };
export function Choices<T extends string>({
  label,
  options,
  selected,
  onChange,
  disabled = false,
}: {
  label: string;
  options: { value: T; label: string }[];
  selected: T | null;
  onChange(value: T): void;
  disabled?: boolean;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.label}>{label}</Text>
      <View
        accessibilityRole="radiogroup"
        style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}
      >
        {options.map((option) => (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected === option.value, disabled }}
            disabled={disabled}
            onPress={() => onChange(option.value)}
            style={[
              styles.button,
              {
                flexGrow: 1,
                backgroundColor: selected === option.value ? colors.primary : colors.paper,
                borderColor: selected === option.value ? colors.primary : colors.border,
                opacity: disabled ? 0.65 : 1,
              },
            ]}
          >
            <Text
              style={[
                styles.buttonText,
                { color: selected === option.value ? colors.paper : colors.primary },
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
