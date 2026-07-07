import { Image } from 'expo-image';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet } from 'react-native';
import { Text } from '@/components/Text';
import { useColors } from '@/hooks/useColors';
import type { Playlist } from '@/types/playlist';
import { Div } from '../Div';

interface SearchPlaylistItemProps {
	playlist: Playlist;
	query: string;
	onPress?: () => void;
}

export default function SearchPlaylistItem({ playlist, query, onPress }: SearchPlaylistItemProps) {
	const colors = useColors();

	const handlePress = () => {
		router.push({
			pathname: '/(tabs)/(library)/(playlists)/[playlistId]',
			params: { playlistId: playlist.key || playlist.id },
		});
		onPress?.();
	};

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

	return (
		<Pressable onPress={handlePress} style={styles.item}>
			{playlist.artworkUrl ? (
				<Image source={{ uri: playlist.artworkUrl }} style={styles.artwork} />
			) : (
				<Div transparent style={[styles.iconContainer, { backgroundColor: colors.surfaceTertiary }]}>
					<SymbolView name='music.note.list' size={24} tintColor='#ddd' />
				</Div>
			)}
			<Div transparent style={[styles.infoContainer, { borderBottomColor: colors.listDivider }]}>
				<Div transparent style={styles.info}>
					<Text type='body' numberOfLines={1} style={styles.title}>
						{highlightText(playlist.title, query)}
					</Text>
					<Text type='bodySM' numberOfLines={1} style={styles.subtitle}>
						{playlist.leafCount ?? 0} tracks
					</Text>
				</Div>
			</Div>
		</Pressable>
	);
}

const styles = StyleSheet.create({
	item: {
		flexDirection: 'row',
		alignItems: 'center',
		marginBottom: 6,
		gap: 12,
	},
	artwork: {
		width: 50,
		height: 50,
		borderRadius: 4,
	},
	iconContainer: {
		width: 50,
		height: 50,
		borderRadius: 4,
		justifyContent: 'center',
		alignItems: 'center',
	},
	infoContainer: {
		flex: 1,
		gap: 4,
		flexDirection: 'row',
		alignItems: 'center',
		borderBottomWidth: StyleSheet.hairlineWidth,
	},
	info: {
		flex: 1,
		backgroundColor: 'transparent',
	},
	title: {
		fontSize: 15,
		fontWeight: '400',
	},
	subtitle: {
		fontSize: 14,
		fontWeight: '400',
		opacity: 0.6,
	},
	highlighted: {
		fontWeight: '600',
	},
});
