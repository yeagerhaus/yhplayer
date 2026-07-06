import * as Notifications from 'expo-notifications';
import type { ImperativeRouter } from 'expo-router';

export function setupNotificationHandler() {
	Notifications.setNotificationHandler({
		handleNotification: async () => ({
			shouldShowAlert: true,
			shouldPlaySound: false,
			shouldSetBadge: false,
			shouldShowBanner: true,
			shouldShowList: true,
		}),
	});
}

export async function requestNotificationPermissions() {
	const { status: existing } = await Notifications.getPermissionsAsync();
	if (existing === 'granted') return true;

	const { status } = await Notifications.requestPermissionsAsync();
	return status === 'granted';
}

export function addNotificationResponseListener(router: ImperativeRouter) {
	return Notifications.addNotificationResponseReceivedListener((response) => {
		const data = response.notification.request.content.data as
			| {
					feedId?: string;
					episodeId?: string;
			  }
			| undefined;

		if (data?.episodeId && data?.feedId) {
			router.push({
				pathname: '/(tabs)/(podcasts)/episode/[episodeId]',
				params: { episodeId: data.episodeId, feedId: data.feedId },
			});
		}
	});
}
