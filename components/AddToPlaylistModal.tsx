import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect } from 'react';
import { Alert, FlatList, Pressable, StyleSheet } from 'react-native';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { DefaultStyles } from '@/constants/styles';
import { useAddToPlaylist } from '@/hooks/useAddToPlaylist';
import { useColors, useThemedStyles } from '@/hooks/useColors';
import { useLibraryStore } from '@/hooks/useLibraryStore';
import { addToPlaylist, createPlaylist } from '@/utils/plex';
import { Div } from './Div';
import { Text } from './Text';

const ANIM_DURATION = 250;

export function AddToPlaylistModal() {
	const colors = useColors();
	const themed = useThemedStyles();
	const { visible, label, ratingKeys, close } = useAddToPlaylist();
	const playlists = useLibraryStore((s) => s.playlists);
	const setPlaylists = useLibraryStore((s) => s.setPlaylists);

	const audioPlaylists = playlists.filter((p) => p.playlistType === 'audio' && !p.smart);

	// Animation: backdrop opacity + sheet translate
	const opacity = useSharedValue(0);
	const translateY = useSharedValue(400);
	const mounted = useSharedValue(false);

	useEffect(() => {
		if (visible) {
			mounted.value = true;
			opacity.value = withTiming(1, { duration: ANIM_DURATION });
			translateY.value = withTiming(0, { duration: ANIM_DURATION });
		} else {
			opacity.value = withTiming(0, { duration: ANIM_DURATION });
			translateY.value = withTiming(400, { duration: ANIM_DURATION }, () => {
				mounted.value = false;
			});
		}
	}, [visible, opacity, translateY, mounted]);

	const backdropStyle = useAnimatedStyle(() => ({
		opacity: opacity.value,
		// Only intercept touches when visible
		pointerEvents: mounted.value ? ('auto' as const) : ('none' as const),
	}));

	const sheetStyle = useAnimatedStyle(() => ({
		transform: [{ translateY: translateY.value }],
	}));

	const animatedClose = useCallback(() => {
		// Animate out, then reset store
		opacity.value = withTiming(0, { duration: ANIM_DURATION });
		translateY.value = withTiming(400, { duration: ANIM_DURATION }, () => {
			mounted.value = false;
			runOnJS(close)();
		});
	}, [close, opacity, translateY, mounted]);

	const handleSelect = useCallback(
		async (playlistRatingKey: string) => {
			if (!ratingKeys.length) return;
			animatedClose();
			try {
				await addToPlaylist(playlistRatingKey, ratingKeys);
			} catch (err) {
				console.error('Failed to add to playlist:', err);
			}
		},
		[ratingKeys, animatedClose],
	);

	const handleNewPlaylist = useCallback(() => {
		if (!ratingKeys.length) return;
		const keys = [...ratingKeys];
		Alert.prompt('New Playlist', 'Enter a name for your playlist', async (name) => {
			if (!name?.trim()) return;
			animatedClose();
			try {
				const newPlaylist = await createPlaylist(name.trim(), keys);
				if (newPlaylist) {
					setPlaylists([...playlists, newPlaylist]);
				}
			} catch (err) {
				console.error('Failed to create playlist:', err);
			}
		});
	}, [ratingKeys, animatedClose, playlists, setPlaylists]);

	return (
		<Animated.View style={[themed.overlay, styles.backdropExtras, backdropStyle]}>
			<Pressable style={styles.backdropTouch} onPress={animatedClose} />
			<Animated.View style={[themed.sheet, sheetStyle]}>
				<Div style={[styles.handle, { backgroundColor: colors.textSecondary }]} />
				<Text type='h3' colorVariant='primary' style={styles.title}>
					Add to Playlist
				</Text>
				{label ? (
					<Text type='body' colorVariant='secondary' style={styles.songName} numberOfLines={1}>
						{label}
					</Text>
				) : null}

				<Pressable style={styles.newPlaylistRow} onPress={handleNewPlaylist}>
					<SymbolView name='plus.circle' size={28} tintColor={colors.brand} />
					<Text type='body' colorVariant='brand' style={styles.newPlaylistText}>
						New Playlist...
					</Text>
				</Pressable>

				<FlatList
					data={audioPlaylists}
					keyExtractor={(item) => item.id}
					renderItem={({ item }) => (
						<Pressable
							style={[DefaultStyles.row, DefaultStyles.listRowBorder, styles.rowBorder]}
							onPress={() => handleSelect(item.ratingKey)}
						>
							<Text type='body' colorVariant='primary' style={styles.playlistName} numberOfLines={1}>
								{item.title}
							</Text>
							<Text type='bodySM' colorVariant='secondary' style={styles.trackCount}>
								{item.leafCount ?? 0}
							</Text>
						</Pressable>
					)}
					contentContainerStyle={styles.list}
					style={styles.listContainer}
				/>
			</Animated.View>
		</Animated.View>
	);
}

const styles = StyleSheet.create({
	backdropExtras: {
		...StyleSheet.absoluteFill,
		zIndex: 9999,
		justifyContent: 'flex-end',
	},
	backdropTouch: {
		flex: 1,
	},
	handle: {
		width: 36,
		height: 5,
		borderRadius: 3,
		alignSelf: 'center',
		marginTop: 8,
		marginBottom: 12,
	},
	title: {
		textAlign: 'center',
		marginBottom: 4,
	},
	songName: {
		fontSize: 13,
		textAlign: 'center',
		marginBottom: 16,
		paddingHorizontal: 24,
	},
	newPlaylistRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 12,
		paddingHorizontal: 20,
		paddingVertical: 12,
		borderBottomWidth: StyleSheet.hairlineWidth,
		borderBottomColor: 'rgba(255,255,255,0.1)',
	},
	newPlaylistText: {
		fontSize: 16,
		fontWeight: '600',
	},
	listContainer: {
		maxHeight: 320,
	},
	list: {
		paddingHorizontal: 20,
	},
	rowBorder: {
		borderBottomColor: 'rgba(255,255,255,0.06)',
	},
	playlistName: {
		flex: 1,
	},
	trackCount: {
		fontSize: 14,
	},
});
