import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView } from 'expo-symbols';
import React, { useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { HomeFeedItem } from '@/types';
import { Text } from './Text';

interface ForYouCardProps {
	item: HomeFeedItem;
	size?: number;
}

const ForYouCard = React.memo(
	({ item, size = 190 }: ForYouCardProps) => {
		const onPress = useCallback(() => {
			item.play();
		}, [item]);

		return (
			<Pressable style={{ width: size }} onPress={onPress}>
				<View style={[styles.artworkContainer, { width: size, height: size }]}>
					{item.artwork ? (
						<Image source={{ uri: item.artwork }} style={StyleSheet.absoluteFill} contentFit='cover' transition={200} />
					) : (
						<View style={[StyleSheet.absoluteFill, styles.fallback]}>
							<SymbolView name='music.note' size={44} type='hierarchical' tintColor='rgba(255,255,255,0.5)' />
						</View>
					)}
					<LinearGradient colors={['rgba(0,0,0,0.45)', 'transparent']} style={[styles.topGradient, { height: size * 0.4 }]} />
					<Text type='label' style={[styles.eyebrow, { maxWidth: size - 20 }]} numberOfLines={1}>
						{item.eyebrow}
					</Text>

					{item.progress != null && (
						<View style={styles.progressTrack}>
							<View style={[styles.progressFill, { width: `${Math.round(item.progress * 100)}%` }]} />
						</View>
					)}
				</View>

				<Text style={[styles.title, { maxWidth: size }]} numberOfLines={1}>
					{item.title}
				</Text>
				<Text style={[styles.subtitle, { maxWidth: size }]} numberOfLines={1}>
					{item.subtitle}
				</Text>
			</Pressable>
		);
	},
	(prev, next) => prev.item.id === next.item.id && prev.item.progress === next.item.progress && prev.size === next.size,
);

ForYouCard.displayName = 'ForYouCard';

export { ForYouCard };

const styles = StyleSheet.create({
	artworkContainer: {
		borderRadius: 12,
		overflow: 'hidden',
		backgroundColor: '#222',
		marginBottom: 8,
		justifyContent: 'flex-start',
	},
	fallback: {
		backgroundColor: '#333',
		justifyContent: 'center',
		alignItems: 'center',
	},
	topGradient: {
		position: 'absolute',
		top: 0,
		left: 0,
		right: 0,
	},
	eyebrow: {
		position: 'absolute',
		top: 10,
		left: 10,
		color: 'rgba(255,255,255,0.9)',
		fontSize: 10,
		letterSpacing: 1,
	},
	progressTrack: {
		position: 'absolute',
		bottom: 8,
		left: 8,
		right: 8,
		height: 3,
		borderRadius: 30,
		backgroundColor: 'rgba(255,255,255,0.3)',
		overflow: 'hidden',
	},
	progressFill: {
		height: '100%',
		borderRadius: 30,
		backgroundColor: '#fff',
	},
	title: {
		fontSize: 14,
		fontWeight: '600',
	},
	subtitle: {
		fontSize: 13,
		opacity: 0.6,
	},
});
