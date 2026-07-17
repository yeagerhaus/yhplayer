import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import React, { useCallback } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useAudioStore } from '@/hooks/useAudioStore';
import { Div } from '../Div';

const PRESS_DOWN = { duration: 80 } as const;
const PRESS_UP = { duration: 150 } as const;

function AnimatedButton({
	onPress,
	onLongPress,
	style,
	children,
}: {
	onPress: () => void;
	onLongPress?: () => void;
	style?: any;
	children: React.ReactNode;
}) {
	const scale = useSharedValue(1);
	const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
	const handleIn = useCallback(() => {
		scale.value = withTiming(0.85, PRESS_DOWN);
	}, [scale]);
	const handleOut = useCallback(() => {
		scale.value = withTiming(1, PRESS_UP);
	}, [scale]);
	return (
		<Pressable onPress={onPress} onLongPress={onLongPress} onPressIn={handleIn} onPressOut={handleOut} style={style}>
			<Animated.View style={animStyle}>{children}</Animated.View>
		</Pressable>
	);
}

export const PlaybackControls = React.memo(() => {
	const router = useRouter();
	const currentSong = useAudioStore((state) => state.currentSong);
	const isPlaying = useAudioStore((state) => state.isPlaying);
	const togglePlayPause = useAudioStore((state) => state.togglePlayPause);
	const skipToNext = useAudioStore((state) => state.skipToNext);
	const skipToPrevious = useAudioStore((state) => state.skipToPrevious);
	const skipBackward15 = useAudioStore((state) => state.skipBackward15);
	const skipForward15 = useAudioStore((state) => state.skipForward15);
	const unloadPlayer = useAudioStore((state) => state.unloadPlayer);

	const isPodcast = currentSong?.source === 'podcast';

	const handleUnload = useCallback(() => {
		Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
		if (router.canGoBack()) router.back();
		unloadPlayer();
	}, [router, unloadPlayer]);

	return (
		<Div transparent style={styles.buttonContainer}>
			<AnimatedButton style={styles.button} onPress={isPodcast ? skipBackward15 : skipToPrevious}>
				<SymbolView name={isPodcast ? 'gobackward.15' : 'backward.fill'} type='hierarchical' size={35} tintColor='#fff' />
			</AnimatedButton>
			<AnimatedButton style={[styles.button, styles.playButton]} onPress={togglePlayPause} onLongPress={handleUnload}>
				<SymbolView name={isPlaying ? 'pause.fill' : 'play.fill'} type='hierarchical' size={40} tintColor='#fff' />
			</AnimatedButton>
			<AnimatedButton style={styles.button} onPress={isPodcast ? skipForward15 : skipToNext}>
				<SymbolView name={isPodcast ? 'goforward.15' : 'forward.fill'} type='hierarchical' size={35} tintColor='#fff' />
			</AnimatedButton>
		</Div>
	);
});

const styles = StyleSheet.create({
	buttonContainer: {
		flexDirection: 'row',
		justifyContent: 'center',
		alignItems: 'center',
		gap: 50,
		backgroundColor: 'transparent',
		marginTop: 10,
	},
	button: {
		padding: 10,
	},
	playButton: {
		transform: [{ scale: 1.2 }],
	},
});
