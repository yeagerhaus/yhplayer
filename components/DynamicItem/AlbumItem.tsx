import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Dimensions, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../Text';

const screenWidth = Dimensions.get('window').width;
const itemSize = screenWidth / 2 - 24;

interface AlbumItemProps {
	item: {
		id: string;
		album: string;
		artwork: string;
		artist: string;
		count?: number;
		year?: number;
	};
	size?: number;
	editorial?: boolean;
}

export default function AlbumItem({ item, size, editorial }: AlbumItemProps) {
	const s = size ?? itemSize;
	const onPress = () =>
		router.push({
			pathname: '/(tabs)/(library)/(albums)/[albumId]',
			params: { albumId: item.id },
		});

	if (editorial) {
		return (
			<Pressable style={[styles.editorialContainer, { width: s, height: s }]} onPress={onPress}>
				<Image source={{ uri: item.artwork }} style={StyleSheet.absoluteFill} transition={200} />
				<LinearGradient colors={['transparent', 'rgba(0,0,0,0.75)']} style={[styles.editorialGradient, { height: s * 0.45 }]} />
				<View style={styles.editorialText}>
					<Text style={[styles.editorialTitle, { maxWidth: s - 20 }]} numberOfLines={1}>
						{item.album}
					</Text>
					<Text style={[styles.editorialArtist, { maxWidth: s - 20 }]} numberOfLines={1}>
						{item.artist}
					</Text>
				</View>
			</Pressable>
		);
	}

	return (
		<Pressable style={[styles.gridItem, size != null && { width: s, marginBottom: 0 }]} onPress={onPress}>
			<Image source={{ uri: item.artwork }} style={[styles.artwork, size != null && { width: s, height: s }]} transition={200} />
			<Text type='h4' style={[styles.name, size != null && { maxWidth: s }]} numberOfLines={1}>
				{item.album}
			</Text>
			<Text type='body' style={[styles.artist, size != null && { maxWidth: s }]} numberOfLines={1}>
				{item.artist}
			</Text>
			{item.year != null && (
				<Text type='bodySM' style={[styles.year, size != null && { maxWidth: s }]} numberOfLines={1}>
					{item.year}
				</Text>
			)}
		</Pressable>
	);
}

const styles = StyleSheet.create({
	gridItem: {
		width: itemSize,
		marginBottom: 24,
		alignItems: 'center',
	},
	artwork: {
		width: itemSize,
		height: itemSize,
		borderRadius: 8,
		marginBottom: 8,
		backgroundColor: '#eee',
	},
	name: {
		maxWidth: itemSize,
	},
	artist: {
		fontSize: 14,
		textAlign: 'center',
		maxWidth: itemSize,
	},
	year: {
		fontSize: 10,
		textAlign: 'center',
		maxWidth: itemSize,
	},
	editorialContainer: {
		borderRadius: 10,
		overflow: 'hidden',
		backgroundColor: '#222',
	},
	editorialGradient: {
		position: 'absolute',
		bottom: 0,
		left: 0,
		right: 0,
	},
	editorialText: {
		position: 'absolute',
		bottom: 0,
		left: 0,
		right: 0,
		padding: 10,
	},
	editorialTitle: {
		color: '#fff',
		fontSize: 13,
		fontWeight: '600',
	},
	editorialArtist: {
		color: 'rgba(255,255,255,0.7)',
		fontSize: 12,
	},
});
