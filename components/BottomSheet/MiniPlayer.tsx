import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import React, { useCallback } from 'react';
import { Platform, Pressable, StyleSheet, useColorScheme } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Div, type GradientConfig } from '@/components/Div';
import { Text } from '@/components/Text';
import { useUltraBlurColors } from '@/hooks';
import { useAudioStore } from '@/hooks/useAudioStore';
import { useColors } from '@/hooks/useColors';

const PRESS_DOWN = { duration: 80 } as const;
const PRESS_UP = { duration: 150 } as const;

export function MiniPlayer() {
	const router = useRouter();
	const currentSong = useAudioStore((state) => state.currentSong);
	const insets = useSafeAreaInsets();
	const pressScale = useSharedValue(1);

	const bottomPosition = Platform.OS === 'ios' ? insets.bottom + 57 : 60;

	const animatedStyle = useAnimatedStyle(() => ({
		flex: 1,
		transform: [{ scale: pressScale.value }],
	}));

	const handlePress = useCallback(() => {
		if (currentSong) router.push(`/music/${currentSong.id}`);
	}, [router, currentSong]);

	const handlePressIn = useCallback(() => {
		pressScale.value = withTiming(0.97, PRESS_DOWN);
	}, [pressScale]);

	const handlePressOut = useCallback(() => {
		pressScale.value = withTiming(1, PRESS_UP);
	}, [pressScale]);

	return (
		<Pressable
			onPress={handlePress}
			onPressIn={handlePressIn}
			onPressOut={handlePressOut}
			style={[styles.container, { bottom: bottomPosition }]}
		>
			<Animated.View style={animatedStyle}>
				<Div
					useGlass
					style={{
						...styles.content,
						marginHorizontal: 22,
						borderRadius: 100,
						marginBottom: 0,
					}}
				>
					<MiniPlayerContent />
				</Div>
			</Animated.View>
		</Pressable>
	);
}

// Extract the content into a separate component for reusability
const MiniPlayerContent = React.memo(() => {
	const _colorScheme = useColorScheme();
	const colors = useColors();
	const currentSong = useAudioStore((state) => state.currentSong);
	const isPlaying = useAudioStore((state) => state.isPlaying);
	const togglePlayPause = useAudioStore((state) => state.togglePlayPause);
	const skipToNext = useAudioStore((state) => state.skipToNext);
	const skipBackward15 = useAudioStore((state) => state.skipBackward15);
	const skipForward15 = useAudioStore((state) => state.skipForward15);
	const unloadPlayer = useAudioStore((state) => state.unloadPlayer);

	const handleUnload = React.useCallback(() => {
		Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
		unloadPlayer();
	}, [unloadPlayer]);

	const isPodcast = currentSong?.source === 'podcast';
	const artwork = React.useMemo(() => currentSong?.artworkUrl || currentSong?.artwork, [currentSong?.artworkUrl, currentSong?.artwork]);
	const title = React.useMemo(() => currentSong?.title, [currentSong?.title]);
	const { colors: ultraBlur, hasColors } = useUltraBlurColors();
	const artworkBgColor = useAudioStore((state) => state.artworkBgColor);
	const fallbackColor = isPodcast ? colors.background : artworkBgColor || '#000000';

	const gradients: GradientConfig[] = [
		{
			colors: hasColors ? [ultraBlur.topLeft, ultraBlur.bottomRight] : [fallbackColor, fallbackColor],
			start: { x: 0, y: 0 },
			end: { x: 1, y: 1 },
			style: { ...styles.miniPlayerContent, paddingHorizontal: 0 },
		},
		{
			colors: hasColors ? [`${ultraBlur.topRight}CC`, `${ultraBlur.bottomLeft}CC`] : ['transparent', 'transparent'],
			start: { x: 1, y: 0 },
			end: { x: 0, y: 1 },
			style: styles.miniPlayerContent,
		},
	];

	if (!currentSong) return null;

	return (
		<Div
			style={[
				styles.miniPlayerContent,
				{ paddingHorizontal: 0, backgroundColor: 'transparent' }, // colorScheme === 'light' ? '#ffffffa4' : 'transparent' },
			]}
			gradients={gradients}
			transparent
		>
			<Image source={{ uri: artwork }} style={styles.artwork} />
			<Div transparent style={styles.textContainer}>
				<Text style={styles.title} numberOfLines={1} ellipsizeMode='tail'>
					{title}
				</Text>
			</Div>
			<Div transparent style={styles.controls}>
				{isPodcast ? (
					<>
						<Pressable style={styles.controlButton} onPress={skipBackward15}>
							<SymbolView name='gobackward.15' type='hierarchical' size={22} tintColor={colors.brand} />
						</Pressable>
						<Pressable style={styles.controlButton} onPress={togglePlayPause} onLongPress={handleUnload}>
							<SymbolView
								name={isPlaying ? 'pause.fill' : 'play.fill'}
								type='hierarchical'
								size={20}
								tintColor={colors.brand}
							/>
						</Pressable>
						<Pressable style={styles.controlButton} onPress={skipForward15}>
							<SymbolView name='goforward.15' type='hierarchical' size={22} tintColor={colors.brand} />
						</Pressable>
					</>
				) : (
					<>
						<Pressable style={styles.controlButton} onPress={togglePlayPause} onLongPress={handleUnload}>
							<SymbolView
								name={isPlaying ? 'pause.fill' : 'play.fill'}
								type='hierarchical'
								size={20}
								tintColor={colors.brand}
							/>
						</Pressable>
						<Pressable style={styles.controlButton} onPress={skipToNext}>
							<SymbolView name='forward.fill' type='hierarchical' size={24} tintColor={colors.brand} />
						</Pressable>
					</>
				)}
			</Div>
		</Div>
	);
});

const styles = StyleSheet.create({
	container: {
		position: 'absolute',
		left: 0,
		right: 0,
		height: 56,
		zIndex: 1000,
	},
	content: {
		flexDirection: 'row',
		alignItems: 'center',
		overflow: 'hidden',
		zIndex: 1000,
		flex: 1,
		paddingVertical: 0,
	},
	miniPlayerContent: {
		flex: 1,
		flexDirection: 'row',
		alignItems: 'center',
		height: '100%',
		paddingHorizontal: 10,
	},
	title: {
		fontWeight: '500',
	},
	artwork: {
		marginLeft: 16,
		width: 40,
		height: 40,
		borderRadius: 4,
	},
	textContainer: {
		flex: 1,
		marginLeft: 12,
		backgroundColor: 'transparent',
	},
	controls: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 4,
		marginRight: 4,
		backgroundColor: 'transparent',
	},
	controlButton: {
		padding: 8,
	},
});
