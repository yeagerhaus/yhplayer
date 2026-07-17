import * as Haptics from 'expo-haptics';
import { useCallback, useEffect } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import { Easing, runOnJS, type SharedValue, useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated';
import { useAudioStore } from '@/hooks/useAudioStore';
import { usePlaybackProgressStore } from '@/hooks/usePlaybackProgressStore';

const PROGRESS_UPDATE_INTERVAL_MS = 500;

export interface Scrubber {
	/** Current fill, 0-100. Reflects scrubbing while the user drags, otherwise live playback. */
	progress: SharedValue<number>;
	/** 0 when idle, animates to 1 while the user is actively scrubbing. */
	scrubActive: SharedValue<number>;
	/** True for the duration of a pan scrub. */
	isScrubbing: SharedValue<boolean>;
	/** Combined tap + pan gesture to attach to the scrubber's GestureDetector. */
	composedGesture: ReturnType<typeof Gesture.Race>;
	/** Attach to the touch target so gesture math has an up-to-date width/x. */
	onLayout: (event: LayoutChangeEvent) => void;
}

/**
 * Headless scrubber: owns all seek/gesture/progress logic so any visual
 * (bar, waveform, etc.) can share the exact same interaction behavior.
 */
export function useScrubber(): Scrubber {
	const position = usePlaybackProgressStore((state) => state.position);
	const duration = usePlaybackProgressStore((state) => state.duration);
	const isPlaying = useAudioStore((state) => state.isPlaying);
	const playbackRate = useAudioStore((state) => state.playbackRate);
	const seekTo = useAudioStore((state) => state.seekTo);

	const containerWidth = useSharedValue(0);
	const containerX = useSharedValue(0);
	const isScrubbing = useSharedValue(false);
	const scrubbingProgress = useSharedValue(0);
	const scrubActive = useSharedValue(0);
	const animatedProgress = useSharedValue(0);

	// On each native position update, animate smoothly to the next expected position.
	useEffect(() => {
		// Avoid wiping the bar on transient duration=0 while we still have a position (native timing/metadata hiccups).
		if (duration === 0) {
			if (position > 0) return;
			animatedProgress.value = 0;
			return;
		}
		const currentPercent = Math.min(100, Math.max(0, (position / duration) * 100));
		if (isPlaying) {
			const nextPercent = Math.min(100, currentPercent + ((playbackRate * PROGRESS_UPDATE_INTERVAL_MS) / 1000 / duration) * 100);
			animatedProgress.value = currentPercent;
			animatedProgress.value = withTiming(nextPercent, {
				duration: PROGRESS_UPDATE_INTERVAL_MS,
				easing: Easing.linear,
			});
		} else {
			animatedProgress.value = currentPercent;
		}
	}, [position, duration, isPlaying, playbackRate]);

	const progress = useDerivedValue(() => {
		if (isScrubbing.value) {
			return scrubbingProgress.value;
		}
		return animatedProgress.value;
	});

	const handleSeek = useCallback(
		(newPosition: number) => {
			seekTo(newPosition);
		},
		[seekTo],
	);

	const fireHaptic = useCallback(() => {
		Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
	}, []);

	const panGesture = Gesture.Pan()
		.onStart((event) => {
			isScrubbing.value = true;
			scrubActive.value = withTiming(1, { duration: 200 });
			runOnJS(fireHaptic)();
			const relativeX = event.absoluteX - containerX.value;
			const progressPercent = (relativeX / containerWidth.value) * 100;
			scrubbingProgress.value = Math.max(0, Math.min(100, progressPercent));
		})
		.onUpdate((event) => {
			const relativeX = event.absoluteX - containerX.value;
			const progressPercent = (relativeX / containerWidth.value) * 100;
			scrubbingProgress.value = Math.max(0, Math.min(100, progressPercent));
		})
		.onEnd(() => {
			const newPosition = (scrubbingProgress.value / 100) * duration;
			runOnJS(handleSeek)(newPosition);
			isScrubbing.value = false;
			scrubActive.value = withTiming(0, { duration: 200 });
		});

	const tapGesture = Gesture.Tap().onStart((event) => {
		const relativeX = event.absoluteX - containerX.value;
		const progressPercent = (relativeX / containerWidth.value) * 100;
		const clampedProgress = Math.max(0, Math.min(100, progressPercent));
		const newPosition = (clampedProgress / 100) * duration;
		runOnJS(handleSeek)(newPosition);
	});

	const composedGesture = Gesture.Race(panGesture, tapGesture);

	const onLayout = useCallback(
		(event: LayoutChangeEvent) => {
			const layout = event.nativeEvent.layout;
			containerWidth.value = layout.width;
			event.target.measure((_x, _y, _width, _height, pageX) => {
				containerX.value = pageX;
			});
		},
		[containerWidth, containerX],
	);

	return { progress, scrubActive, isScrubbing, composedGesture, onLayout };
}
