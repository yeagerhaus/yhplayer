import { Image } from 'expo-image';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useMemo } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { ContextMenu, type ContextMenuItem } from '@/components/ContextMenu';
import { Text } from '@/components/Text';
import { useAddToPlaylist } from '@/hooks/useAddToPlaylist';
import { useArtists } from '@/hooks/useArtists';
import { useColors } from '@/hooks/useColors';
import { useLibraryStore } from '@/hooks/useLibraryStore';
import type { Album } from '@/types/album';
import { Div } from '../Div';

interface SearchAlbumItemProps {
	album: Album;
	query: string;
	onPress?: () => void;
}

export default function SearchAlbumItem({ album, query, onPress }: SearchAlbumItemProps) {
	const colors = useColors();
	const openAddToPlaylist = useAddToPlaylist((s) => s.open);
	const { artists } = useArtists();
	const allTracks = useLibraryStore((s) => s.tracks);
	const matchedArtist = artists.find((a) => a.name === album.artist);

	const albumTrackIds = useMemo(
		() => allTracks.filter((t) => t.album === album.title && t.artist === album.artist).map((t) => t.id),
		[allTracks, album.title, album.artist],
	);

	const handlePress = () => {
		router.push({
			pathname: '/(tabs)/(library)/(albums)/[albumId]',
			params: { albumId: album.id },
		});
		onPress?.();
	};

	const menuItems: ContextMenuItem[] = [
		{
			label: 'Add to Playlist',
			systemImage: 'plus.circle',
			onPress: () => openAddToPlaylist(`${album.title} — ${album.artist}`, albumTrackIds),
			disabled: albumTrackIds.length === 0,
		},
		{
			label: 'Go to Artist',
			systemImage: 'person.circle',
			onPress: () => {
				if (matchedArtist) {
					router.push(`/(tabs)/(library)/(artists)/${matchedArtist.key}`);
				}
			},
		},
	];

	const highlightText = (text: string, q: string) => {
		if (!q) return text;

		const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
		return parts.map((part, index) =>
			part.toLowerCase() === q.toLowerCase() ? (
				<Text key={index} style={[styles.highlighted, { backgroundColor: colors.brand, color: '#ffffff' }]}>
					{part}
				</Text>
			) : (
				part
			),
		);
	};

	const artworkUri = album.thumb || album.artwork;

	return (
		<Pressable onPress={handlePress} style={styles.albumItem}>
			<Image source={{ uri: artworkUri }} style={styles.albumArtwork} />
			<Div transparent style={[styles.albumInfoContainer, { borderBottomColor: colors.listDivider }]}>
				<Div transparent style={styles.albumInfo}>
					<Text type='body' numberOfLines={1} style={styles.albumTitle}>
						{highlightText(album.title, query)}
					</Text>
					<Text type='bodySM' numberOfLines={1} style={styles.albumArtist}>
						{highlightText(album.artist, query)}
					</Text>
					{album.year && (
						<Text type='bodySM' numberOfLines={1} style={styles.albumYear}>
							{album.year}
						</Text>
					)}
				</Div>
				<ContextMenu items={menuItems} style={styles.moreButton}>
					<SymbolView name='ellipsis' size={20} tintColor='#999' />
				</ContextMenu>
			</Div>
		</Pressable>
	);
}

const styles = StyleSheet.create({
	albumItem: {
		flexDirection: 'row',
		alignItems: 'center',
		marginBottom: 6,
		gap: 12,
	},
	albumArtwork: {
		width: 50,
		height: 50,
		borderRadius: 4,
	},
	albumInfoContainer: {
		flex: 1,
		gap: 4,
		flexDirection: 'row',
		alignItems: 'center',
		borderBottomWidth: StyleSheet.hairlineWidth,
	},
	albumInfo: {
		flex: 1,
		backgroundColor: 'transparent',
	},
	albumTitle: {
		fontSize: 15,
		fontWeight: '400',
	},
	albumArtist: {
		fontSize: 14,
		fontWeight: '400',
		opacity: 0.6,
	},
	albumYear: {
		fontSize: 12,
		fontWeight: '400',
		opacity: 0.5,
	},
	moreButton: {
		padding: 8,
	},
	highlighted: {
		fontWeight: '600',
	},
});
