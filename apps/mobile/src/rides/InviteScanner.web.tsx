import { Notice } from '../auth/components';

export function InviteScanner(_props: { onScan(value: string): void; disabled?: boolean }) {
  return (
    <Notice>
      Camera invite scanning is available in the native app. Paste a Ridr invite link or enter its
      code in this browser preview.
    </Notice>
  );
}
