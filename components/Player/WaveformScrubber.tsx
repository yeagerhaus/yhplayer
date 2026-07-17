import { useCallback, useMemo, useState } from 'react';
import { type LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { useAudioStore } from '@/hooks/useAudioStore';
import { Div } from '../Div';
import type { Scrubber } from './useScrubber';
import { useTrackWaveform } from './useTrackWaveform';

export type WaveformVariant = 'segmented' | 'smooth';

const MAX_HEIGHT = 30;

const PLAYED_COLOR = '#fff';
const UNPLAYED_COLOR = 'rgba(255, 255, 255, 0.3)';

interface VariantConfig {
	buckets: number;
	smooth: boolean;
	barWidth: number;
	radius: number;
	minHeight: number;
}

const VARIANT_CONFIG: Record<WaveformVariant, VariantConfig> = {
	segmented: { buckets: 48, smooth: false, barWidth: 3.5, radius: 1.75, minHeight: 3 },
	// Continuous filled silhouette (SVG path) rather than discrete bars.
	smooth: { buckets: 100, smooth: true, barWidth: 0, radius: 0, minHeight: 0 },
};

export function WaveformScrubber({ variant, progress, scrubActive, composedGesture, onLayout }: Scrubber & { variant: WaveformVariant }) {
	const config = VARIANT_CONFIG[variant];
	const trackId = useAudioStore((state) => state.currentSong?.id);
	const peaks = useTrackWaveform(trackId, config.buckets, config.smooth);

	const [width, setWidth] = useState(0);

	const handleLayout = useCallback(
		(event: LayoutChangeEvent) => {
			onLayout(event);
			setWidth(event.nativeEvent.layout.width);
		},
		[onLayout],
	);

	const clipStyle = useAnimatedStyle(() => ({
		width: `${progress.value}%`,
	}));

	const activeStyle = useAnimatedStyle(() => ({
		transform: [{ scaleY: 1 + scrubActive.value * 0.12 }],
	}));

	const renderShape = (color: string) =>
		variant === 'smooth' ? (
			<SmoothShape peaks={peaks} width={width} color={color} />
		) : (
			<Bars
				peaks={peaks}
				width={width}
				color={color}
				barWidth={config.barWidth}
				radius={config.radius}
				minHeight={config.minHeight}
			/>
		);

	return (
		<Div transparent style={styles.wrapper}>
			<GestureDetector gesture={composedGesture}>
				<Animated.View onLayout={handleLayout} style={styles.touchTarget}>
					<Animated.View style={[styles.shapeArea, activeStyle]}>
						{renderShape(UNPLAYED_COLOR)}
						<Animated.View style={[styles.clip, clipStyle]}>{renderShape(PLAYED_COLOR)}</Animated.View>
					</Animated.View>
				</Animated.View>
			</GestureDetector>
		</Div>
	);
}

interface BarsProps {
	peaks: number[];
	width: number;
	color: string;
	barWidth: number;
	radius: number;
	minHeight: number;
}

/**
 * A row of amplitude bars at a fixed pixel width. Both the played and unplayed
 * layers render identical bars; the played layer is revealed by an animated clip,
 * so alignment is exact and only one animated value drives the fill.
 */
function Bars({ peaks, width, color, barWidth, radius, minHeight }: BarsProps) {
	const heights = useMemo(() => peaks.map((p) => Math.max(minHeight, p * MAX_HEIGHT)), [peaks, minHeight]);

	if (width === 0) return null;

	return (
		<View style={[styles.row, { width }]} pointerEvents='none'>
			{heights.map((height, index) => (
				<View key={index} style={{ width: barWidth, height, borderRadius: radius, backgroundColor: color }} />
			))}
		</View>
	);
}

interface SmoothShapeProps {
	peaks: number[];
	width: number;
	color: string;
}

/** A continuous filled waveform silhouette, mirrored around the vertical center. */
function SmoothShape({ peaks, width, color }: SmoothShapeProps) {
	const d = useMemo(() => buildWaveformPath(peaks, width, MAX_HEIGHT), [peaks, width]);

	if (width === 0 || !d) return null;

	return (
		<Svg width={width} height={MAX_HEIGHT} pointerEvents='none'>
			<Path d={d} fill={color} />
		</Svg>
	);
}

/**
 * Builds a filled path for the waveform: a smoothed top edge (left→right) and a
 * mirrored bottom edge (right→left), closed into a solid shape. Curves are drawn
 * through midpoints using each sample as a control point for a flowing silhouette.
 */
function buildWaveformPath(peaks: number[], width: number, height: number): string {
	const n = peaks.length;
	if (n < 2 || width <= 0) return '';

	const mid = height / 2;
	const half = height / 2;
	const x = (i: number) => Math.round((i / (n - 1)) * width * 10) / 10;
	const clamp = (i: number) => Math.min(1, Math.max(0, peaks[i]));
	const topY = (i: number) => Math.round((mid - clamp(i) * half) * 10) / 10;
	const botY = (i: number) => Math.round((mid + clamp(i) * half) * 10) / 10;

	let d = `M ${x(0)} ${topY(0)}`;
	for (let i = 1; i < n; i++) {
		const xc = Math.round(((x(i - 1) + x(i)) / 2) * 10) / 10;
		const yc = Math.round(((topY(i - 1) + topY(i)) / 2) * 10) / 10;
		d += ` Q ${x(i - 1)} ${topY(i - 1)} ${xc} ${yc}`;
	}
	d += ` L ${x(n - 1)} ${topY(n - 1)}`;
	d += ` L ${x(n - 1)} ${botY(n - 1)}`;
	for (let i = n - 2; i >= 0; i--) {
		const xc = Math.round(((x(i + 1) + x(i)) / 2) * 10) / 10;
		const yc = Math.round(((botY(i + 1) + botY(i)) / 2) * 10) / 10;
		d += ` Q ${x(i + 1)} ${botY(i + 1)} ${xc} ${yc}`;
	}
	d += ` L ${x(0)} ${botY(0)} Z`;
	return d;
}

const styles = StyleSheet.create({
	wrapper: {
		width: '100%',
		marginTop: 4,
	},
	touchTarget: {
		width: '100%',
		paddingVertical: 6,
		justifyContent: 'center',
	},
	shapeArea: {
		width: '100%',
		height: MAX_HEIGHT,
		justifyContent: 'center',
	},
	clip: {
		position: 'absolute',
		left: 0,
		top: 0,
		height: '100%',
		overflow: 'hidden',
	},
	row: {
		height: MAX_HEIGHT,
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
	},
});
