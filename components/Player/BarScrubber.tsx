import { GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { Div } from '../Div';
import type { Scrubber } from './useScrubber';

const TRACK_HEIGHT_IDLE = 5;
const TRACK_HEIGHT_ACTIVE = 8;

export function BarScrubber({ progress, scrubActive, composedGesture, onLayout }: Scrubber) {
	const fillStyle = useAnimatedStyle(() => ({
		width: `${progress.value}%`,
	}));

	const thumbStyle = useAnimatedStyle(() => ({
		opacity: scrubActive.value,
		transform: [{ scale: 0.3 + scrubActive.value * 0.7 }],
	}));

	const trackHeightStyle = useAnimatedStyle(() => ({
		height: TRACK_HEIGHT_IDLE + scrubActive.value * (TRACK_HEIGHT_ACTIVE - TRACK_HEIGHT_IDLE),
	}));

	return (
		<Div transparent style={{ width: '100%', marginTop: 4 }}>
			<GestureDetector gesture={composedGesture}>
				<Animated.View
					onLayout={onLayout}
					style={{
						width: '100%',
						paddingVertical: 6,
						justifyContent: 'center',
					}}
				>
					<Animated.View
						style={[
							trackHeightStyle,
							{
								width: '100%',
								borderRadius: 30,
								backgroundColor: 'rgba(255, 255, 255, 0.3)',
								justifyContent: 'center',
							},
						]}
					>
						<Animated.View
							style={[fillStyle, { height: '100%', borderRadius: 30, backgroundColor: '#fff', position: 'relative' }]}
						>
							<Animated.View
								style={[
									thumbStyle,
									{
										position: 'absolute',
										right: -8,
										top: '50%',
										marginTop: -8,
										width: 16,
										height: 16,
										borderRadius: 8,
										backgroundColor: '#fff',
										shadowColor: '#000',
										shadowOffset: { width: 0, height: 2 },
										shadowOpacity: 0.3,
										shadowRadius: 4,
										elevation: 4,
									},
								]}
							/>
						</Animated.View>
					</Animated.View>
				</Animated.View>
			</GestureDetector>
		</Div>
	);
}
