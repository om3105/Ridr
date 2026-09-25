export const riderPresets = [
  { code: 'stopping', label: 'Stopping', icon: '🛑' },
  { code: 'flat_tire', label: 'Flat tire', icon: '🛞' },
  { code: 'regrouping', label: 'Regrouping', icon: '👥' },
  { code: 'turn_missed', label: 'Turn missed', icon: '↩️' },
  { code: 'car_back', label: 'Car back', icon: '🚗' },
] as const;
export const pillionPresets = [
  { code: 'need_stop', label: 'Need a stop', icon: '🛑' },
  { code: 'uncomfortable_pace', label: 'Uncomfortable pace', icon: '⚠️' },
  { code: 'cold_tired', label: 'Cold/Tired', icon: '🥶' },
] as const;
export type PresetCode =
  | (typeof riderPresets)[number]['code']
  | (typeof pillionPresets)[number]['code'];
export function presetLabel(code: PresetCode): string {
  return [...riderPresets, ...pillionPresets].find((item) => item.code === code)!.label;
}
export function isPreset(value: unknown): value is PresetCode {
  return (
    typeof value === 'string' &&
    [...riderPresets, ...pillionPresets].some((item) => item.code === value)
  );
}
