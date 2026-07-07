import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Dimensions, Pressable, StyleSheet, View } from 'react-native';
import { Div } from '../Div';
import { Text } from '../Text';

const screenWidth = Dimensions.get('window').width;
const itemSize = screenWidth / 2 - 24;

interface PlaylistItemProps {
	item: {
		id: string;
		title: string;
		artwork: string;
		count: number;
	};
	size?: number;
	editorial?: boolean;
}

export default function PlaylistItem({ item, size, editorial }: PlaylistItemProps) {
	const s = size ?? itemSize;
	const iconSize = Math.round(60 * (s / itemSize));
	const onPress = () =>
		router.push({
			pathname: '/(tabs)/(library)/(playlists)/[playlistId]',
			params: { playlistId: item.id },
		});

	if (editorial) {
		return (
			<Pressable style={[styles.editorialContainer, { width: s, height: s }]} onPress={onPress}>
				{item.artwork ? (
					<Image
						source={{ uri: item.artwork }}
						style={StyleSheet.absoluteFill}
						contentFit='cover'
						recyclingKey={item.id}
						transition={200}
					/>
				) : (
					<View style={[StyleSheet.absoluteFill, styles.editorialFallback]}>
						<SymbolView name='music.note' size={iconSize} type='hierarchical' tintColor='#ddd' />
					</View>
				)}
				<LinearGradient colors={['transparent', 'rgba(0,0,0,0.75)']} style={[styles.editorialGradient, { height: s * 0.45 }]} />
				<View style={styles.editorialText}>
					<Text style={[styles.editorialTitle, { maxWidth: s - 20 }]} numberOfLines={1}>
						{item.title}
					</Text>
					<Text style={styles.editorialCount}>{item.count} songs</Text>
				</View>
			</Pressable>
		);
	}

	return (
		<Pressable style={[styles.gridItem, size != null && { width: s, marginBottom: 0 }]} onPress={onPress}>
			{item.artwork ? (
				<Image
					source={{ uri: item.artwork }}
					style={[styles.artwork, size != null && { width: s, height: s }]}
					contentFit='cover'
					recyclingKey={item.id}
					transition={200}
				/>
			) : (
				<Div
					style={[
						styles.artwork,
						{ backgroundColor: '#666', justifyContent: 'center', alignItems: 'center' },
						size != null && { width: s, height: s },
					]}
				>
					<SymbolView name='music.note' size={iconSize} type='hierarchical' tintColor='#ddd' />
				</Div>
			)}
			<Text style={[styles.name, size != null && { maxWidth: s }]} numberOfLines={1}>
				{item.title}
			</Text>
			<Text style={styles.count}>{item.count} songs</Text>
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
		fontSize: 14,
		fontWeight: '600',
		textAlign: 'center',
		maxWidth: itemSize,
	},
	artist: {
		fontSize: 14,
		textAlign: 'center',
		maxWidth: itemSize,
	},
	count: {
		fontSize: 10,
		textAlign: 'center',
	},
	editorialContainer: {
		borderRadius: 10,
		overflow: 'hidden',
		backgroundColor: '#222',
	},
	editorialFallback: {
		backgroundColor: '#444',
		justifyContent: 'center',
		alignItems: 'center',
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
	editorialCount: {
		color: 'rgba(255,255,255,0.7)',
		fontSize: 12,
	},
});
