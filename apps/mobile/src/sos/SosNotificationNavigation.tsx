import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';

export function SosNotificationNavigation() {
  const router = useRouter();
  useEffect(() => {
    const opened = new Set<string>();
    const open = (response: Notifications.NotificationResponse) => {
      const notificationId = response.notification.request.identifier;
      if (opened.has(notificationId)) return;
      const data = response.notification.request.content.data;
      if (
        data?.kind === 'sos' &&
        typeof data.rideId === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          data.rideId,
        )
      ) {
        opened.add(notificationId);
        router.push({ pathname: '/ride', params: { id: data.rideId, view: 'sos' } });
        void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
      }
    };
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) open(response);
      })
      .catch(() => undefined);
    return () => subscription.remove();
  }, [router]);
  return null;
}
