import { Image } from 'expo-image';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import React from 'react';
import { Dimensions, StyleSheet } from 'react-native';
import { ContextMenu, type ContextMenuItem } from '@/components/ContextMenu';
import { Div } from '@/components/Div';
import { Text } from '@/components/Text';
import { useAddToPlaylist } from '@/hooks/useAddToPlaylist';
import { useAlbums } from '@/hooks/useAlbums';
import { useArtists } from '@/hooks/useArtists';
import { useAudioStore } from '@/hooks/useAudioStore';
import { usePodcastProgressStore } from '@/hooks/usePodcastProgressStore';

const { width } = Dimensions.get('window');

export const SongInfo = React.memo(() => {
	const currentSong = useAudioStore((state) => state.currentSong);
	const { artists } = useArtists();
	const { albums } = useAlbums();
	const openAddToPlaylist = useAddToPlaylist((s) => s.open);
	const markAsPlayed = usePodcastProgressStore((state) => state.markAsPlayed);

	if (!currentSong) return null;

	const artwork = currentSong.artworkUrl || currentSong.artwork;
	const title = currentSong.title;
	const artist = currentSong.artist;
	const isPodcast = currentSong.source === 'podcast';

	// Find matching artist/album by name to get their ratingKey for navigation
	const matchedArtist = artists.find((a) => a.name === currentSong.artist);
	const matchedAlbum = albums.find((a) => a.title === currentSong.album && a.artist === currentSong.artist);

	const menuItems: ContextMenuItem[] = isPodcast
		? [
				{
					label: 'Mark as played',
					systemImage: 'checkmark.circle',
					onPress: () => {
						if (currentSong) markAsPlayed(currentSong.id);
					},
				},
				{
					label: 'View Episode',
					systemImage: 'doc.text',
					onPress: () => {
						if (!currentSong) return;
						router.back();
						setTimeout(
							() =>
								router.push({
									pathname: '/(tabs)/(podcasts)/episode/[episodeId]',
									params: { episodeId: currentSong.id, feedId: currentSong.artistKey || '' },
								}),
							100,
						);
					},
				},
				{
					label: 'Go to Show',
					systemImage: 'mic.fill',
					onPress: () => {
						if (!currentSong) return;
						router.back();
						setTimeout(
							() =>
								router.push({
									pathname: '/(tabs)/(podcasts)/[feedId]',
									params: { feedId: currentSong.artistKey || '' },
								}),
							100,
						);
					},
				},
				{
					label: 'Share',
					systemImage: 'square.and.arrow.up',
					onPress: () => console.log('Share'),
				},
			]
		: [
				{
					label: 'Add to Playlist',
					systemImage: 'plus.circle',
					onPress: () => {
						if (!currentSong) return;
						openAddToPlaylist(`${currentSong.title} — ${currentSong.artist}`, [currentSong.id]);
					},
				},
				{
					label: 'Go to Album',
					systemImage: 'square.stack',
					onPress: () => {
						if (matchedAlbum) {
							router.back();
							setTimeout(() => {
								router.push(`/(tabs)/(library)/(albums)/${matchedAlbum.id}`);
							}, 100);
						}
					},
				},
				{
					label: 'Go to Artist',
					systemImage: 'person.circle',
					onPress: () => {
						if (matchedArtist) {
							router.back();
							setTimeout(() => {
								router.push(`/(tabs)/(library)/(artists)/${matchedArtist.key}`);
							}, 100);
						}
					},
				},
				{
					label: 'Share',
					systemImage: 'square.and.arrow.up',
					onPress: () => console.log('Share'),
				},
			];

	return (
		<>
			<Div transparent style={styles.artworkContainer}>
				<Image source={{ uri: artwork }} style={styles.artwork} />
			</Div>

			<Div transparent style={styles.titleContainer}>
				<Div transparent style={styles.titleRow}>
					<Div transparent style={styles.titleMain}>
						<Text type='h2' style={styles.title} numberOfLines={1} ellipsizeMode='tail'>
							{title}
						</Text>
						<Text style={styles.artist}>{artist}</Text>
					</Div>
					<Div transparent style={styles.titleIcons}>
						{/* <Pressable style={styles.iconButton}>
						<Ionicons name='star-outline' size={18} color='#fff' />
					</Pressable> */}
						<ContextMenu items={menuItems} style={styles.iconButton}>
							<SymbolView name='ellipsis' size={20} tintColor='#999' />
						</ContextMenu>
					</Div>
				</Div>
			</Div>
		</>
	);
});

const styles = StyleSheet.create({
	artworkContainer: {
		shadowColor: '#000',
		shadowOffset: { width: 0, height: 8 },
		shadowOpacity: 0.4,
		shadowRadius: 12,
		elevation: 12,
		backgroundColor: 'transparent',
		marginBottom: 34,
	},
	artwork: {
		width: width - 52,
		height: width - 52,
		borderRadius: 8,
	},
	titleContainer: {
		backgroundColor: 'transparent',
		width: '100%',
		marginTop: 12,
	},
	titleRow: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'center',
		width: '100%',
	},
	titleMain: {
		flex: 1,
	},
	titleIcons: {
		flexDirection: 'row',
		gap: 15,
	},
	title: {
		fontSize: 24,
		color: '#fff',
	},
	artist: {
		fontSize: 18,
		opacity: 0.7,
		color: '#fff',
	},
	iconButton: {
		width: 32,
		height: 32,
		borderRadius: 20,
		justifyContent: 'center',
		alignItems: 'center',
	},
});
