import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
	Easing,
	Extrapolation,
	interpolate,
	runOnJS,
	useAnimatedStyle,
	useSharedValue,
	withTiming,
} from 'react-native-reanimated';
import { Div } from '@/components';
import { ExpandedPlayer } from '@/components/BottomSheet/ExpandedPlayer';
import { FullBleedPlayer } from '@/components/BottomSheet/FullBleedPlayer';
import { useRootScale } from '@/ctx/RootScaleContext';
import { useAppearanceStore } from '@/hooks/useAppearanceStore';

// Constants moved outside component to prevent recalculation
const SCALE_FACTOR = 0.83;
const SCREEN_HEIGHT = Dimensions.get('window').height;
const DRAG_THRESHOLD = Math.min(SCREEN_HEIGHT * 0.15, 120);
const VELOCITY_THRESHOLD = 800;
const HORIZONTAL_DRAG_THRESHOLD = Math.min(Dimensions.get('window').width * 0.51, 80);
const DIRECTION_LOCK_ANGLE = 45;
const ENABLE_HORIZONTAL_DRAG_CLOSE = false;

const EASE_OUT = Easing.out(Easing.cubic);

const SNAP_BACK_CONFIG = {
	duration: 250,
	easing: EASE_OUT,
} as const;

const DISMISS_CONFIG = {
	duration: 200,
	easing: EASE_OUT,
} as const;

function MusicScreen() {
	const router = useRouter();
	const { scale, setScale } = useRootScale();
	const useFullBleedPlayer = useAppearanceStore((s) => s.useFullBleedPlayer);
	const Player = useFullBleedPlayer ? FullBleedPlayer : ExpandedPlayer;

	// Queue state
	const [queueOpen, setQueueOpen] = useState(false);
	const queueOpenShared = useSharedValue(false);

	useEffect(() => {
		queueOpenShared.value = queueOpen;
	}, [queueOpen, queueOpenShared]);

	const toggleQueue = useCallback(() => {
		Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
		setQueueOpen((prev) => !prev);
	}, []);

	// Shared values - grouped for better organization
	const translateY = useSharedValue(0);
	const translateX = useSharedValue(0);
	const scrollOffset = useSharedValue(0);
	const statusBarStyle = useSharedValue<'light' | 'dark'>('light');

	// Gesture state
	const isDragging = useSharedValue(false);
	const isScrolling = useSharedValue(false);
	const isHorizontalGesture = useSharedValue(false);
	const initialGestureX = useSharedValue(0);
	const initialGestureY = useSharedValue(0);

	// Component state
	const isClosing = useRef(false);

	// Note: numericId calculation removed as it was unused

	const handleHapticFeedback = useCallback(() => {
		try {
			Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
		} catch (error) {
			console.log('Haptics not available:', error);
		}
	}, []);

	const goBack = useCallback(() => {
		if (!isClosing.current) {
			isClosing.current = true;
			handleHapticFeedback();
			requestAnimationFrame(() => {
				router.back();
			});
		} else {
			router.replace('/(tabs)/home');
		}
	}, [router, handleHapticFeedback]);

	const calculateGestureAngle = useCallback((x: number, y: number) => {
		'worklet';
		const angle = Math.abs(Math.atan2(y, x) * (180 / Math.PI));
		return angle;
	}, []);

	const panGesture = useMemo(
		() =>
			Gesture.Pan()
				.onStart((event) => {
					'worklet';
					// Disable drag-to-close when queue is open
					if (queueOpenShared.value) return;

					initialGestureX.value = event.x;
					initialGestureY.value = event.y;
					isHorizontalGesture.value = false;

					if (scrollOffset.value <= 0) {
						isDragging.value = true;
						translateY.value = 0;
					}
				})
				.onUpdate((event) => {
					'worklet';
					if (queueOpenShared.value) return;

					const dx = event.translationX;
					const dy = event.translationY;

					// Only check for horizontal gesture if enabled
					if (ENABLE_HORIZONTAL_DRAG_CLOSE && !isHorizontalGesture.value && !isScrolling.value) {
						if (Math.abs(dx) > 10) {
							const angle = calculateGestureAngle(dx, dy);
							if (angle < DIRECTION_LOCK_ANGLE) {
								isHorizontalGesture.value = true;
							}
						}
					}

					// Handle horizontal gesture only if enabled
					if (ENABLE_HORIZONTAL_DRAG_CLOSE && isHorizontalGesture.value) {
						translateX.value = dx;
						translateY.value = dy;

						const totalDistance = Math.sqrt(dx * dx + dy * dy);
						const progress = Math.min(totalDistance / 300, 1);
						scale.value = SCALE_FACTOR + progress * (1 - SCALE_FACTOR);
						statusBarStyle.value = progress > 0.2 ? 'dark' : 'light';
					}
					// Handle vertical-only gesture
					else if (scrollOffset.value <= 0 && isDragging.value) {
						translateY.value = Math.max(0, dy);
						const progress = Math.min(dy / 600, 1);
						scale.value = SCALE_FACTOR + progress * (1 - SCALE_FACTOR);
						statusBarStyle.value = progress > 0.5 ? 'dark' : 'light';
					}
				})
				.onEnd((event) => {
					'worklet';
					if (queueOpenShared.value) return;

					isDragging.value = false;

					// Handle horizontal gesture end only if enabled
					if (ENABLE_HORIZONTAL_DRAG_CLOSE && isHorizontalGesture.value) {
						const dx = event.translationX;
						const dy = event.translationY;
						const totalDistance = Math.sqrt(dx * dx + dy * dy);
						const shouldClose = totalDistance > HORIZONTAL_DRAG_THRESHOLD;

						if (shouldClose) {
							const exitX = dx * 2;
							const exitY = dy * 2;

							translateX.value = withTiming(exitX, DISMISS_CONFIG);
							translateY.value = withTiming(exitY, DISMISS_CONFIG);
							scale.value = withTiming(1, DISMISS_CONFIG);
							runOnJS(handleHapticFeedback)();
							runOnJS(goBack)();
						} else {
							translateX.value = withTiming(0, SNAP_BACK_CONFIG);
							translateY.value = withTiming(0, SNAP_BACK_CONFIG);
							scale.value = withTiming(SCALE_FACTOR, SNAP_BACK_CONFIG);
						}
					}
					// Handle vertical gesture end
					else if (scrollOffset.value <= 0) {
						const shouldClose = event.translationY > DRAG_THRESHOLD || event.velocityY > VELOCITY_THRESHOLD;

						if (shouldClose) {
							translateY.value = withTiming(SCREEN_HEIGHT, DISMISS_CONFIG);
							scale.value = withTiming(1, DISMISS_CONFIG);
							runOnJS(handleHapticFeedback)();
							runOnJS(goBack)();
						} else {
							translateY.value = withTiming(0, SNAP_BACK_CONFIG);
							scale.value = withTiming(SCALE_FACTOR, SNAP_BACK_CONFIG);
						}
					}
				})
				.onFinalize(() => {
					'worklet';
					isDragging.value = false;
					isHorizontalGesture.value = false;
				}),
		[calculateGestureAngle, scale, handleHapticFeedback, goBack, queueOpenShared],
	);

	const scrollGesture = useMemo(
		() =>
			Gesture.Native()
				.onBegin(() => {
					'worklet';
					isScrolling.value = true;
					if (!isDragging.value) {
						translateY.value = 0;
					}
				})
				.onEnd(() => {
					'worklet';
					isScrolling.value = false;
				}),
		[],
	);

	const composedGestures = useMemo(() => Gesture.Simultaneous(panGesture, scrollGesture), [panGesture, scrollGesture]);

	// Optimized scroll handler
	const handleScroll = useCallback((event: any) => {
		'worklet';
		scrollOffset.value = event.nativeEvent.contentOffset.y;
		if (!isDragging.value && translateY.value !== 0) {
			translateY.value = 0;
		}
	}, []);

	const ScrollComponent = useMemo(
		() => (props: any) => (
			<GestureDetector gesture={composedGestures}>
				<Animated.ScrollView {...props} onScroll={handleScroll} scrollEventThrottle={16} bounces={false} />
			</GestureDetector>
		),
		[composedGestures, handleScroll],
	);

	const animatedStyle = useAnimatedStyle(
		() => ({
			transform: [{ translateY: translateY.value }, { translateX: translateX.value }],
			opacity: interpolate(translateY.value, [0, DRAG_THRESHOLD], [1, 0.85], Extrapolation.CLAMP),
			borderTopLeftRadius: interpolate(translateY.value, [0, DRAG_THRESHOLD], [40, 12], Extrapolation.CLAMP),
			borderTopRightRadius: interpolate(translateY.value, [0, DRAG_THRESHOLD], [40, 12], Extrapolation.CLAMP),
		}),
		[],
	);

	useEffect(() => {
		const timeout = setTimeout(() => {
			try {
				setScale(SCALE_FACTOR);
			} catch (error) {
				console.log('Initial scale error:', error);
			}
		}, 0);

		return () => {
			clearTimeout(timeout);
			try {
				setScale(1);
			} catch (error) {
				console.log('Cleanup scale error:', error);
			}
		};
	}, [setScale]);

	return (
		<Div style={staticStyles.root}>
			<StatusBar animated={true} style={statusBarStyle.value} />
			<Animated.View style={[staticStyles.playerContainer, animatedStyle]}>
				<Player scrollComponent={queueOpen ? undefined : ScrollComponent} queueOpen={queueOpen} onToggleQueue={toggleQueue} />
			</Animated.View>
		</Div>
	);
}

const staticStyles = {
	root: { flex: 1, backgroundColor: 'transparent' },
	playerContainer: { flex: 1, backgroundColor: 'transparent', overflow: 'hidden' as const },
} as const;

export default React.memo(MusicScreen);
