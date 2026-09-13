import { idleDiagnostic, type DiagnosticStatus } from './diagnostic-types';

export function getDiagnosticStatus(): DiagnosticStatus {
  return {
    ...idleDiagnostic,
    message: 'Device checks require the iOS or Android development app.',
  };
}
export async function stopAndClearDiagnostics(): Promise<void> {}
export async function initializeDiagnostics(): Promise<void> {}
export async function startDiagnostics(_options: {
  background: boolean;
  consentGiven: boolean;
}): Promise<void> {
  throw new Error('Device checks require the iOS or Android development app.');
}
export function subscribeDiagnostics(listener: (value: DiagnosticStatus) => void) {
  listener(getDiagnosticStatus());
  return () => {};
}
