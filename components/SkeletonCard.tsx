import { LinearGradient } from 'expo-linear-gradient';
import { cloneElement, useEffect } from 'react';
import { type DimensionValue, StyleSheet, useColorScheme, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

const AnimatedLinearGradient = Animated.createAnimatedComponent(LinearGradient);

interface SkeletonProps {
	width: DimensionValue;
	height: DimensionValue;
	borderRadius?: number;
}

export function Skeleton({ width, height, borderRadius = 8 }: SkeletonProps) {
	const numericWidth = typeof width === 'number' ? width : 200;
	const translateX = useSharedValue(-numericWidth);
	const colorScheme = useColorScheme();
	const isDark = colorScheme === 'dark';

	const baseColor = isDark ? '#1a1a1a' : '#e8e8e8';
	const shimmerColors = isDark ? (['#1a1a1a', '#2a2a2a', '#1a1a1a'] as const) : (['#e8e8e8', '#f5f5f5', '#e8e8e8'] as const);

	useEffect(() => {
		translateX.value = withRepeat(withTiming(numericWidth, { duration: 1200 }), -1, false);
	}, [numericWidth, translateX]);

	const animatedStyle = useAnimatedStyle(() => ({
		transform: [{ translateX: translateX.value }],
	}));

	return (
		<View style={{ width, height, borderRadius, backgroundColor: baseColor, overflow: 'hidden' }}>
			<AnimatedLinearGradient
				colors={shimmerColors}
				start={{ x: 0, y: 0.5 }}
				end={{ x: 1, y: 0.5 }}
				style={[styles.shimmer, { width: numericWidth }, animatedStyle]}
			/>
		</View>
	);
}

interface SkeletonCardProps {
	size?: number;
}

export function SkeletonCard({ size = 175 }: SkeletonCardProps) {
	return (
		<View>
			<Skeleton width={size} height={size} borderRadius={8} />
			<Skeleton width={size * 0.7} height={12} borderRadius={4} />
		</View>
	);
}

export function SkeletonList({ count, children }: { count: number; children: React.ReactElement }) {
	return <>{Array.from({ length: count }, (_, i) => cloneElement(children, { key: `sk-${i}` }))}</>;
}

const styles = StyleSheet.create({
	shimmer: {
		...StyleSheet.absoluteFill,
		height: '100%',
	},
});
