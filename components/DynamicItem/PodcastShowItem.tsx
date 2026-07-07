import { Image } from 'expo-image';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback } from 'react';
import { Dimensions, Pressable, StyleSheet } from 'react-native';
import { Div } from '../Div';
import { Text } from '../Text';

const screenWidth = Dimensions.get('window').width;
const itemSize = screenWidth / 2 - 24;

interface PodcastShowItemProps {
	item: {
		id: string;
		title: string;
		artwork: string;
		count: number;
	};
	size?: number;
}

export default function PodcastShowItem({ item, size }: PodcastShowItemProps) {
	const s = size ?? itemSize;
	const iconSize = Math.round(60 * (s / itemSize));

	const navigateToFeed = useCallback(() => {
		router.push({
			pathname: '/(tabs)/(podcasts)/[feedId]',
			params: { feedId: item.id },
		});
	}, [item.id]);

	return (
		<Pressable style={[styles.gridItem, size != null && { width: s, marginBottom: 0 }]} onPress={navigateToFeed}>
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
					<SymbolView name='mic.fill' size={iconSize} type='hierarchical' tintColor='#ddd' />
				</Div>
			)}
			<Text style={[styles.name, size != null && { maxWidth: s }]} numberOfLines={1}>
				{item.title}
			</Text>
			<Text style={styles.count}>{item.count} episodes</Text>
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
	count: {
		fontSize: 10,
		textAlign: 'center',
	},
});
