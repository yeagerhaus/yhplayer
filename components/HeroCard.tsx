import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView } from 'expo-symbols';
import React, { useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { HomeFeedItem } from '@/types';
import { Text } from './Text';

interface HeroCardProps {
	item: HomeFeedItem;
	height?: number;
}

const HeroCard = React.memo(({ item, height = 200 }: HeroCardProps) => {
	const onPress = useCallback(() => {
		item.play();
	}, [item]);

	return (
		<Pressable style={[styles.container, { height }]} onPress={onPress}>
			{item.artwork ? (
				<Image source={{ uri: item.artwork }} style={StyleSheet.absoluteFill} contentFit='cover' transition={200} />
			) : (
				<View style={[StyleSheet.absoluteFill, styles.fallback]}>
					<SymbolView name='music.note' size={64} type='hierarchical' tintColor='rgba(255,255,255,0.5)' />
				</View>
			)}
			<LinearGradient
				colors={['transparent', 'rgba(0,0,0,0.35)', 'rgba(0,0,0,0.85)']}
				locations={[0, 0.5, 1]}
				style={StyleSheet.absoluteFill}
			/>

			<View style={styles.content}>
				<Text type='label' style={styles.eyebrow} numberOfLines={1}>
					{item.eyebrow}
				</Text>
				<Text style={styles.title} numberOfLines={2}>
					{item.title}
				</Text>
				<Text style={styles.subtitle} numberOfLines={1}>
					{item.subtitle}
				</Text>

				{item.progress != null && (
					<View style={styles.progressTrack}>
						<View style={[styles.progressFill, { width: `${Math.round(item.progress * 100)}%` }]} />
					</View>
				)}
			</View>

			<View style={styles.playBadge}>
				<SymbolView name='play.fill' size={20} tintColor='#000' />
			</View>
		</Pressable>
	);
});

HeroCard.displayName = 'HeroCard';

export { HeroCard };

const styles = StyleSheet.create({
	container: {
		marginHorizontal: 16,
		borderRadius: 16,
		overflow: 'hidden',
		backgroundColor: '#222',
		justifyContent: 'flex-end',
	},
	fallback: {
		backgroundColor: '#333',
		justifyContent: 'center',
		alignItems: 'center',
	},
	content: {
		padding: 18,
	},
	eyebrow: {
		color: 'rgba(255,255,255,0.75)',
		letterSpacing: 1.2,
		marginBottom: 6,
	},
	title: {
		color: '#fff',
		fontSize: 26,
		fontWeight: '700',
		marginBottom: 2,
	},
	subtitle: {
		color: 'rgba(255,255,255,0.7)',
		fontSize: 15,
	},
	progressTrack: {
		marginTop: 12,
		height: 4,
		borderRadius: 30,
		backgroundColor: 'rgba(255,255,255,0.3)',
		overflow: 'hidden',
	},
	progressFill: {
		height: '100%',
		borderRadius: 30,
		backgroundColor: '#fff',
	},
	playBadge: {
		position: 'absolute',
		top: 16,
		right: 16,
		width: 44,
		height: 44,
		borderRadius: 22,
		backgroundColor: 'rgba(255,255,255,0.92)',
		justifyContent: 'center',
		alignItems: 'center',
	},
});
