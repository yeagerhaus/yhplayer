import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import React, { useCallback } from 'react';
import { Platform, Pressable, StyleSheet } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAudioStore } from '@/hooks/useAudioStore';
import { useColors } from '@/hooks/useColors';
import { useUltraBlurColors } from '@/hooks/useUltraBlurColors';
import { Div } from '../Div';
import { ExtraControls } from '../Player/ExtraControls';
import { PlaybackControls } from '../Player/PlaybackControls';
import { QueueList } from '../Player/QueueList';
import { SongProgressBar } from '../Player/SongProgressBar';
import { TimeDisplay } from '../Player/TimeDisplay';
import { Text } from '../Text';

interface FullBleedPlayerProps {
	scrollComponent?: (props: any) => React.ReactElement;
	queueOpen?: boolean;
	onToggleQueue?: () => void;
}

const PRESS_DOWN = { duration: 80 } as const;
const PRESS_UP = { duration: 150 } as const;

function AnimatedIconButton({
	onPress,
	style,
	children,
	scaleTo = 0.8,
}: {
	onPress?: () => void;
	style?: any;
	children: React.ReactNode;
	scaleTo?: number;
}) {
	const scale = useSharedValue(1);
	const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
	const handleIn = useCallback(() => {
		scale.value = withTiming(scaleTo, PRESS_DOWN);
	}, [scale, scaleTo]);
	const handleOut = useCallback(() => {
		scale.value = withTiming(1, PRESS_UP);
	}, [scale]);
	return (
		<Pressable onPress={onPress} onPressIn={handleIn} onPressOut={handleOut} style={style}>
			<Animated.View style={animStyle}>{children}</Animated.View>
		</Pressable>
	);
}

function MusicControlRow({ onToggleQueue, queueOpen }: { onToggleQueue?: () => void; queueOpen?: boolean }) {
	const isPlaying = useAudioStore((state) => state.isPlaying);
	const isShuffled = useAudioStore((state) => state.isShuffled);
	const togglePlayPause = useAudioStore((state) => state.togglePlayPause);
	const toggleShuffle = useAudioStore((state) => state.toggleShuffle);
	const skipToNext = useAudioStore((state) => state.skipToNext);
	const skipToPrevious = useAudioStore((state) => state.skipToPrevious);

	const inactive = 'rgba(255, 255, 255, 0.55)';

	return (
		<Div transparent style={styles.controlRow}>
			<AnimatedIconButton style={styles.sideButton} onPress={toggleShuffle}>
				<SymbolView name='shuffle' size={22} tintColor={isShuffled ? '#fff' : inactive} />
			</AnimatedIconButton>
			<AnimatedIconButton style={styles.centerButton} onPress={skipToPrevious}>
				<SymbolView name='backward.fill' type='hierarchical' size={32} tintColor='#fff' />
			</AnimatedIconButton>
			<AnimatedIconButton style={styles.playButton} onPress={togglePlayPause}>
				<SymbolView name={isPlaying ? 'pause.fill' : 'play.fill'} type='hierarchical' size={40} tintColor='#fff' />
			</AnimatedIconButton>
			<AnimatedIconButton style={styles.centerButton} onPress={skipToNext}>
				<SymbolView name='forward.fill' type='hierarchical' size={32} tintColor='#fff' />
			</AnimatedIconButton>
			<AnimatedIconButton style={styles.sideButton} onPress={onToggleQueue}>
				<SymbolView name='list.bullet' size={22} tintColor={queueOpen ? '#fff' : inactive} />
			</AnimatedIconButton>
		</Div>
	);
}

export const FullBleedPlayer = React.memo(
	({ scrollComponent, queueOpen, onToggleQueue }: FullBleedPlayerProps) => {
		const ScrollComponentToUse = scrollComponent || ScrollView;
		const router = useRouter();
		const insets = useSafeAreaInsets();
		const currentSong = useAudioStore((state) => state.currentSong);
		const artworkBgColor = useAudioStore((state) => state.artworkBgColor);
		const { colors: ultraBlur, hasColors } = useUltraBlurColors();
		const colors = useColors();

		const MemoizedScrollComponent = React.useMemo(() => ScrollComponentToUse, [ScrollComponentToUse]);

		const isPodcast = currentSong?.source === 'podcast';
		const artwork = currentSong?.artworkUrl || currentSong?.artwork;
		const fallbackColor = isPodcast ? colors.background : artworkBgColor || (hasColors ? ultraBlur.bottomRight : '#000000');

		const handleCollapse = useCallback(() => {
			if (router.canGoBack()) router.back();
		}, [router]);

		const metadata = [currentSong?.artist, currentSong?.album].filter(Boolean).join('  ·  ');

		const playerUI = (
			<Div transparent style={styles.content}>
				<Div transparent style={styles.infoBlock}>
					<Text style={styles.eyebrow}>NOW PLAYING</Text>
					<Text style={styles.title} numberOfLines={3} ellipsizeMode='tail'>
						{currentSong?.title}
					</Text>
					{metadata ? <Text style={styles.metadata}>{metadata.toUpperCase()}</Text> : null}
				</Div>

				<Div transparent style={styles.controls}>
					<SongProgressBar />
					<TimeDisplay />
					{isPodcast ? (
						<>
							<PlaybackControls />
							<ExtraControls queueOpen={queueOpen} onToggleQueue={onToggleQueue} />
						</>
					) : (
						<MusicControlRow queueOpen={queueOpen} onToggleQueue={onToggleQueue} />
					)}
				</Div>
			</Div>
		);

		return (
			<Div style={styles.rootContainer} transparent>
				{artwork ? (
					<Image source={{ uri: artwork }} style={StyleSheet.absoluteFill} contentFit='cover' transition={250} />
				) : (
					<Div style={[StyleSheet.absoluteFill, { backgroundColor: fallbackColor }]} transparent />
				)}
				<LinearGradient
					colors={['rgba(0,0,0,0.35)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.5)', 'rgba(0,0,0,0.92)']}
					locations={[0, 0.3, 0.62, 1]}
					style={StyleSheet.absoluteFill}
				/>

				<Div style={[styles.innerContainer, { paddingTop: insets.top }]} transparent>
					<Div transparent style={styles.topBar}>
						<Div transparent style={styles.dragHandle} />
						<AnimatedIconButton style={styles.collapseButton} onPress={handleCollapse} scaleTo={0.85}>
							<SymbolView name='chevron.down' size={20} tintColor='rgba(255, 255, 255, 0.85)' />
						</AnimatedIconButton>
					</Div>

					{queueOpen ? (
						<Animated.View entering={FadeIn.duration(250)} exiting={FadeOut.duration(150)} style={styles.flex1}>
							<QueueList headerComponent={playerUI} onToggleQueue={onToggleQueue} />
						</Animated.View>
					) : (
						<Animated.View entering={FadeIn.duration(250)} exiting={FadeOut.duration(150)} style={styles.flex1}>
							<MemoizedScrollComponent
								style={styles.scrollView}
								contentContainerStyle={styles.scrollContent}
								showsVerticalScrollIndicator={false}
							>
								{playerUI}
							</MemoizedScrollComponent>
						</Animated.View>
					)}
				</Div>
			</Div>
		);
	},
	(prevProps, nextProps) => {
		return (
			prevProps.scrollComponent === nextProps.scrollComponent &&
			prevProps.queueOpen === nextProps.queueOpen &&
			prevProps.onToggleQueue === nextProps.onToggleQueue
		);
	},
);

const styles = StyleSheet.create({
	rootContainer: {
		flex: 1,
		height: '100%',
		width: '100%',
		borderTopLeftRadius: 40,
		borderTopRightRadius: 40,
		overflow: 'hidden',
		backgroundColor: '#000',
	},
	innerContainer: {
		flex: 1,
		height: '100%',
		width: '100%',
	},
	flex1: {
		flex: 1,
	},
	topBar: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'flex-end',
		paddingHorizontal: 20,
		paddingTop: 10,
		minHeight: 34,
	},
	dragHandle: {
		position: 'absolute',
		top: 10,
		left: '50%',
		marginLeft: -20,
		width: 40,
		height: 5,
		backgroundColor: 'rgba(255, 255, 255, 0.6)',
		borderRadius: 5,
	},
	collapseButton: {
		width: 32,
		height: 32,
		justifyContent: 'center',
		alignItems: 'flex-end',
	},
	scrollView: {
		flex: 1,
		width: '100%',
	},
	scrollContent: {
		flexGrow: 1,
	},
	content: {
		flex: 1,
		justifyContent: 'flex-end',
		paddingHorizontal: 24,
		paddingBottom: 20,
	},
	infoBlock: {
		width: '100%',
		marginBottom: 8,
	},
	eyebrow: {
		fontSize: 12,
		letterSpacing: 2,
		color: 'rgba(255, 255, 255, 0.7)',
		marginBottom: 10,
	},
	title: {
		fontFamily: Platform.select({ ios: 'Georgia', default: 'serif' }),
		fontStyle: 'italic',
		fontWeight: '700',
		fontSize: 34,
		lineHeight: 40,
		color: '#fff',
	},
	metadata: {
		fontSize: 13,
		letterSpacing: 1.2,
		color: 'rgba(255, 255, 255, 0.6)',
		marginTop: 12,
	},
	controls: {
		width: '100%',
		marginTop: 20,
	},
	controlRow: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		width: '100%',
		paddingHorizontal: 4,
		marginTop: 8,
	},
	sideButton: {
		width: 44,
		height: 44,
		justifyContent: 'center',
		alignItems: 'center',
	},
	centerButton: {
		width: 52,
		height: 52,
		justifyContent: 'center',
		alignItems: 'center',
	},
	playButton: {
		width: 60,
		height: 60,
		justifyContent: 'center',
		alignItems: 'center',
	},
});
