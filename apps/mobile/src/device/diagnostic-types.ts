export type DiagnosticStatus = {
  state: 'idle' | 'starting' | 'running' | 'stopped' | 'error';
  count: number;
  backgroundCount: number;
  expiresAt: number | null;
  lastSampleAt: number | null;
  encryption: 'not-checked' | 'verified';
  message: string;
};

export const idleDiagnostic: DiagnosticStatus = {
  state: 'idle',
  count: 0,
  backgroundCount: 0,
  expiresAt: null,
  lastSampleAt: null,
  encryption: 'not-checked',
  message: 'No location check is running.',
};
