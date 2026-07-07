import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';
import { Text } from '@/components/Text';
import { useColors } from '@/hooks/useColors';
import type { Artist } from '@/types/artist';
import { Div } from '../Div';

interface SearchArtistItemProps {
	artist: Artist;
	query: string;
	onPress?: () => void;
}

export default function SearchArtistItem({ artist, query, onPress }: SearchArtistItemProps) {
	const colors = useColors();

	const handlePress = () => {
		router.push({
			pathname: '/(tabs)/(library)/(artists)/[artistId]',
			params: { artistId: artist.key },
		});
		onPress?.();
	};

	const highlightText = (text: string, query: string) => {
		if (!query) return text;

		const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
		return parts.map((part, index) =>
			part.toLowerCase() === query.toLowerCase() ? (
				<Text key={index} style={[styles.highlighted, { backgroundColor: colors.brand, color: '#ffffff' }]}>
					{part}
				</Text>
			) : (
				part
			),
		);
	};

	const genreText = artist.genres.length > 0 ? artist.genres.slice(0, 2).join(', ') : 'Artist';

	return (
		<Pressable onPress={handlePress} style={styles.artistItem}>
			{artist.thumb ? (
				<Image source={{ uri: artist.thumb }} style={styles.artistImage} />
			) : (
				<Div transparent style={styles.artistIconContainer}>
					<Text style={styles.artistIcon}>{artist.name.charAt(0).toUpperCase()}</Text>
				</Div>
			)}
			<Div transparent style={[styles.artistInfoContainer, { borderBottomColor: colors.listDivider }]}>
				<Div transparent style={styles.artistInfo}>
					<Text type='body' numberOfLines={1} style={styles.artistName}>
						{highlightText(artist.name, query)}
					</Text>
					<Text type='bodySM' numberOfLines={1} style={styles.artistStats}>
						{genreText}
					</Text>
				</Div>
			</Div>
		</Pressable>
	);
}

const styles = StyleSheet.create({
	artistItem: {
		flexDirection: 'row',
		alignItems: 'center',
		marginBottom: 6,
		gap: 12,
	},
	artistImage: {
		width: 50,
		height: 50,
		borderRadius: 25,
		backgroundColor: '#ddd',
	},
	artistIconContainer: {
		width: 50,
		height: 50,
		borderRadius: 25,
		backgroundColor: '#FA2D48',
		justifyContent: 'center',
		alignItems: 'center',
	},
	artistIcon: {
		fontSize: 20,
		fontWeight: 'bold',
		color: 'white',
	},
	artistInfoContainer: {
		flex: 1,
		gap: 4,
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'center',
		borderBottomWidth: StyleSheet.hairlineWidth,
		paddingBottom: 14,
		paddingRight: 14,
	},
	artistInfo: {
		flex: 1,
		backgroundColor: 'transparent',
	},
	artistName: {
		fontSize: 15,
		fontWeight: '400',
	},
	artistStats: {
		fontSize: 12,
		fontWeight: '400',
		opacity: 0.6,
	},
	highlighted: {
		fontWeight: '600',
	},
});
