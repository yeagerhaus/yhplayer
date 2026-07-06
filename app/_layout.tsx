// Crypto polyfills removed - using expo-crypto instead
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useRouter } from 'expo-router';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useRef } from 'react';
import { AppState, StyleSheet, useColorScheme } from 'react-native';

// LogBox.ignoreAllLogs();

import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { initialWindowMetrics, SafeAreaProvider } from 'react-native-safe-area-context';
import { AddToPlaylistModal, Div, MiniPlayer } from '@/components';
import { Colors } from '@/constants';
import { RootScaleProvider, useRootScale } from '@/ctx/RootScaleContext';
import { useAddToPlaylist } from '@/hooks/useAddToPlaylist';
import { useAppearanceStore } from '@/hooks/useAppearanceStore';
import { useAudioStore, useTrackPlayerSync } from '@/hooks/useAudioStore';
import { useColors } from '@/hooks/useColors';
import { useDevSettingsStore } from '@/hooks/useDevSettingsStore';
import { useLibraryStore } from '@/hooks/useLibraryStore';
import { useMusicDownloadsStore } from '@/hooks/useMusicDownloadsStore';
import { useOfflineModeStore } from '@/hooks/useOfflineModeStore';
import { usePlaybackSettingsStore } from '@/hooks/usePlaybackSettingsStore';
import { usePodcastDownloadsStore } from '@/hooks/usePodcastDownloadsStore';
import { usePodcastProgressStore } from '@/hooks/usePodcastProgressStore';
import { usePodcastStore } from '@/hooks/usePodcastStore';
import { setupCarPlay, teardownCarPlay } from '@/lib/carplay';
import { initNetworkPlaybackRoute, refreshNetworkPlaybackRoute } from '@/lib/networkPlaybackRoute';
import { rehydrateLibraryStore } from '@/utils';
import '@/utils/background-fetch-task';
import { hasSeenNotificationPrompt } from '@/app/notification-prompt';
import { SplashOverlay } from '@/components/Splash';
import { registerBackgroundFetch } from '@/utils/background-fetch-task';
import { refreshLibrary } from '@/utils/library-refresh';
import { addNotificationResponseListener, setupNotificationHandler } from '@/utils/notifications';
import { plexClient, testPlexServer } from '@/utils/plex';
import { plexAuthService } from '@/utils/plex-auth';
import { initScrobbleQueue } from '@/utils/scrobble-queue';

setupNotificationHandler();

function AudioSync() {
	useTrackPlayerSync();
	return null;
}

const CustomDarkTheme = {
	...DarkTheme,
	colors: {
		...DarkTheme.colors,
		background: Colors.dark.background,
		card: Colors.dark.background,
	},
};

const CustomLightTheme = {
	...DefaultTheme,
	colors: {
		...DefaultTheme.colors,
		background: Colors.light.background,
		card: Colors.light.background,
	},
};

function AnimatedStack() {
	const colors = useColors();
	const { scale } = useRootScale();
	const currentSong = useAudioStore((state) => state.currentSong);
	const screenBackground = colors.background;

	const animatedStyle = useAnimatedStyle(() => {
		return {
			transform: [
				{ scale: scale.value },
				{
					translateY: (1 - scale.value) * -150,
				},
			],
		};
	});

	return (
		<Div style={{ flex: 1, backgroundColor: screenBackground }}>
			<Animated.View style={[styles.stackContainer, animatedStyle]}>
				<Stack screenOptions={{ contentStyle: { backgroundColor: screenBackground } }}>
					<Stack.Screen name='(tabs)' options={{ headerShown: false, contentStyle: { backgroundColor: screenBackground } }} />
					<Stack.Screen
						name='music/[id]'
						options={{
							presentation: 'transparentModal',
							headerShown: false,
							contentStyle: {
								backgroundColor: 'transparent',
							},
						}}
					/>
					<Stack.Screen
						name='notification-prompt'
						options={{
							presentation: 'transparentModal',
							headerShown: false,
							animation: 'fade',
							contentStyle: { backgroundColor: 'transparent' },
						}}
					/>
					<Stack.Screen name='_not-found' />
				</Stack>

				{currentSong && <MiniPlayer />}
			</Animated.View>
		</Div>
	);
}

const LIBRARY_REFRESH_INTERVAL = 10 * 60 * 1000; // 10 minutes

export default function RootLayout() {
	const colorScheme = useColorScheme();
	const router = useRouter();
	const setHasInitialized = useLibraryStore((s) => s.setHasInitialized);
	const initializePlayer = useAudioStore((state) => state.initializePlayer);
	const hydrateAppearance = useAppearanceStore((state) => state.hydrate);
	const hydrateDevSettings = useDevSettingsStore((state) => state.hydrate);
	const hydrateOfflineMode = useOfflineModeStore((state) => state.hydrate);
	const hydratePlaybackSettings = usePlaybackSettingsStore((state) => state.hydrate);
	const addToPlaylistVisible = useAddToPlaylist((s) => s.visible);
	const plexAuthReady = useRef(false);

	useEffect(() => {
		registerBackgroundFetch().catch((err) => console.warn('Background fetch registration failed:', err));
		if (!hasSeenNotificationPrompt()) {
			const handle = requestAnimationFrame(() => router.push('/notification-prompt'));
			const sub = addNotificationResponseListener(router);
			return () => {
				cancelAnimationFrame(handle);
				sub.remove();
			};
		}
		const sub = addNotificationResponseListener(router);
		return () => sub.remove();
	}, [router]);

	useEffect(() => {
		const bg = Colors[colorScheme === 'light' ? 'light' : 'dark'].background;
		SystemUI.setBackgroundColorAsync(bg);
	}, [colorScheme]);

	useEffect(() => {
		hydrateAppearance();
		hydrateDevSettings();
		hydrateOfflineMode();
		hydratePlaybackSettings();
	}, [hydrateAppearance, hydrateDevSettings, hydrateOfflineMode, hydratePlaybackSettings]);

	useEffect(() => initNetworkPlaybackRoute(), []);

	const hydratePodcast = usePodcastStore((s) => s.hydrate);
	const hydratePodcastProgress = usePodcastProgressStore((s) => s.hydrate);
	const hydratePodcastDownloads = usePodcastDownloadsStore((s) => s.hydrate);
	const hydrateMusicDownloads = useMusicDownloadsStore((s) => s.hydrate);
	useEffect(() => {
		hydratePodcastProgress();
		hydratePodcastDownloads();
		hydrateMusicDownloads();
		hydratePodcast();
		const { feeds, fetchAllFeeds } = usePodcastStore.getState();
		if (feeds.length > 0) fetchAllFeeds();
	}, [hydratePodcast, hydratePodcastProgress, hydratePodcastDownloads, hydrateMusicDownloads]);

	useEffect(() => {
		const init = async () => {
			try {
				const authLoaded = await plexAuthService.loadAuthState();

				let hydrated = false;
				if (authLoaded && plexAuthService.isAuthenticated()) {
					const selectedServer = plexAuthService.getSelectedServer();
					if (selectedServer) {
						console.log(`📡 Connected to: ${selectedServer.name}`);
					}

					hydrated = rehydrateLibraryStore();
					if (hydrated) {
						setHasInitialized(true);
					}
				}

				await initializePlayer();

				setupCarPlay();

				if (authLoaded && plexAuthService.isAuthenticated()) {
					plexAuthReady.current = true;
					initScrobbleQueue().catch(() => {});

					if (!hydrated) {
						refreshLibrary({ force: true })
							.then(() => {
								setHasInitialized(true);
								if (!useAudioStore.getState().currentSong) {
									useAudioStore
										.getState()
										.restorePlaybackState()
										.catch(() => {});
								}
							})
							.catch((error) => {
								console.error('Failed to fetch library:', error);
								setHasInitialized(true);
								testPlexServer().catch(() => {});
							});
					}
				} else {
					setHasInitialized(true);
				}
			} catch (error) {
				console.error('Failed to initialize app:', error);
				setHasInitialized(true);
			}
		};

		init();
		const appStateSub = AppState.addEventListener('change', (state) => {
			if (state === 'active') {
				refreshNetworkPlaybackRoute().catch(() => {});
				if (plexAuthReady.current) {
					plexClient.refreshConnectionIfNeeded().catch(() => {});
				}
			}
		});

		return () => {
			appStateSub.remove();
			teardownCarPlay();
		};
	}, []);

	useEffect(() => {
		const interval = setInterval(() => {
			if (!plexAuthReady.current) return;
			refreshLibrary().catch((err) => console.warn('Periodic refresh failed:', err));
		}, LIBRARY_REFRESH_INTERVAL);

		return () => clearInterval(interval);
	}, []);

	return (
		<GestureHandlerRootView style={styles.container}>
			<SafeAreaProvider initialMetrics={initialWindowMetrics}>
				<ThemeProvider value={colorScheme === 'dark' ? CustomDarkTheme : CustomLightTheme}>
					<RootScaleProvider>
						<AudioSync />
						<AnimatedStack />
						{addToPlaylistVisible && <AddToPlaylistModal />}
					</RootScaleProvider>
				</ThemeProvider>
			</SafeAreaProvider>
			<SplashOverlay />
		</GestureHandlerRootView>
	);
}
const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: '#0F1217',
	},
	stackContainer: {
		flex: 1,
		overflow: 'hidden',
		borderRadius: 50,
	},
});
