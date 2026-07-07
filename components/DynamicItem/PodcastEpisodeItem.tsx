import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import React, { useCallback, useMemo } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, useColorScheme, View } from 'react-native';
import { Text } from '@/components/Text';
import { useAudioStore } from '@/hooks/useAudioStore';
import { useColors } from '@/hooks/useColors';
import { usePlaybackProgressStore } from '@/hooks/usePlaybackProgressStore';
import { usePodcastDownloadsStore } from '@/hooks/usePodcastDownloadsStore';
import { usePodcastProgressStore } from '@/hooks/usePodcastProgressStore';
import { toPlayableSong } from '@/types';
import type { PodcastDownload, PodcastEpisode, PodcastFeed } from '@/types/podcast';
import type { Song } from '@/types/song';
import { ContextMenu, type ContextMenuItem } from '../ContextMenu';
import { Div } from '../Div';

function formatDuration(seconds: number | undefined): string {
	if (seconds == null || seconds <= 0) return '';
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);
	if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
	return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Short label for progress bar: "36m" or "1h 5m" */
function formatDurationShort(seconds: number | undefined): string {
	if (seconds == null || seconds <= 0) return '0m';
	const h = Math.floor(seconds / 3600);
	const m = Math.round((seconds % 3600) / 60);
	if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
	return `${m}m`;
}

function formatDate(pubDate: string | undefined): string {
	if (!pubDate) return '';
	try {
		const d = new Date(pubDate);
		return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
	} catch {
		return pubDate;
	}
}

export interface PodcastEpisodeItemProps {
	episode: PodcastEpisode | PodcastDownload;
	showTitle: string;
	showImageUrl?: string;
	queue?: Song[];
	listItem?: boolean;
	feed?: PodcastFeed;
}

function isDownload(ep: PodcastEpisode | PodcastDownload): ep is PodcastDownload {
	return 'localUri' in ep && 'downloadedAt' in ep;
}

const PodcastEpisodeItem = React.memo(
	({ episode, showTitle, showImageUrl, queue, listItem: _listItem = true, feed: _feed }: PodcastEpisodeItemProps) => {
		const colorScheme = useColorScheme();
		const colors = useColors();
		const currentSong = useAudioStore((state) => state.currentSong);
		const playSound = useAudioStore((state) => state.playSound);
		const playNext = useAudioStore((state) => state.playNext);
		const addToQueue = useAudioStore((state) => state.addToQueue);
		const togglePlayPause = useAudioStore((state) => state.togglePlayPause);
		const isPlaying = useAudioStore((state) => (state.currentSong?.id === episode.id ? state.isPlaying : false));

		const isCurrentEpisode = currentSong?.id === episode.id;
		const livePosition = usePlaybackProgressStore((state) => (isCurrentEpisode ? state.position : null));
		const liveDuration = usePlaybackProgressStore((state) => (isCurrentEpisode ? state.duration : null));
		const progress = usePodcastProgressStore((state) => state.progressByEpisodeId[episode.id]);
		const markAsPlayed = usePodcastProgressStore((state) => state.markAsPlayed);
		const saveProgress = usePodcastProgressStore((state) => state.saveProgress);
		const getLocalUri = usePodcastDownloadsStore((s) => s.getLocalUri);
		const isDownloaded = usePodcastDownloadsStore((s) => s.isDownloaded(episode.id));
		const isDownloading = usePodcastDownloadsStore((s) => s.isDownloading(episode.id));
		const downloadEpisode = usePodcastDownloadsStore((s) => s.downloadEpisode);
		const removeDownload = usePodcastDownloadsStore((s) => s.removeDownload);

		const localUri = useMemo(() => (isDownload(episode) ? episode.localUri : getLocalUri(episode.id)), [episode, getLocalUri]);

		const song = useMemo(
			() => toPlayableSong(episode, showTitle, showImageUrl, localUri),
			[episode, showTitle, showImageUrl, localUri],
		);

		const handlePress = useCallback(() => {
			router.push({
				pathname: '/(tabs)/(podcasts)/episode/[episodeId]',
				params: { episodeId: episode.id, feedId: episode.feedId },
			});
		}, [episode.id, episode.feedId]);

		const handlePlay = useCallback(() => {
			playSound(song, queue ?? [song]);
		}, [song, queue, playSound]);

		const menuItems: ContextMenuItem[] = useMemo(() => {
			const items: ContextMenuItem[] = [];

			if (_feed) {
				if (isDownloaded || isDownload(episode)) {
					items.push({
						label: 'Remove Download',
						systemImage: 'trash',
						destructive: true,
						onPress: () => {
							Alert.alert('Remove download', `Remove "${episode.title}" from this device?`, [
								{ text: 'Cancel', style: 'cancel' },
								{ text: 'Remove', style: 'destructive', onPress: () => removeDownload(episode.id).catch(() => {}) },
							]);
						},
					});
				} else {
					items.push({
						label: isDownloading ? 'Downloading…' : 'Download',
						systemImage: 'arrow.down.circle',
						disabled: isDownloading,
						onPress: () => downloadEpisode(episode as PodcastEpisode, _feed).catch(() => {}),
					});
				}
			}

			if (progress?.completed || (progress != null && progress.position > 0)) {
				items.push({
					label: 'Mark as Unplayed',
					systemImage: 'arrow.counterclockwise',
					onPress: () => saveProgress(episode.id, 0, progress?.duration ?? 0, false),
				});
			} else {
				items.push({
					label: 'Mark as Played',
					systemImage: 'checkmark.circle',
					onPress: () => markAsPlayed(episode.id, episode.durationSeconds),
				});
			}

			items.push(
				{
					label: 'Play Next',
					systemImage: 'text.line.first.and.arrowtriangle.forward',
					onPress: () => playNext(song),
				},
				{
					label: 'Add to Queue',
					systemImage: 'text.badge.plus',
					onPress: () => addToQueue([song]),
				},
				{
					label: 'Go to Show',
					systemImage: 'mic.fill',
					onPress: () =>
						router.push({
							pathname: '/(tabs)/(podcasts)/[feedId]',
							params: { feedId: episode.feedId },
						}),
				},
			);

			return items;
		}, [
			_feed,
			episode,
			isDownloaded,
			isDownloading,
			progress,
			song,
			removeDownload,
			downloadEpisode,
			markAsPlayed,
			saveProgress,
			playNext,
			addToQueue,
		]);

		const subtitle = useMemo(() => {
			const parts: string[] = [];
			if (episode.pubDate) parts.push(formatDate(episode.pubDate));
			if (episode.durationSeconds != null && episode.durationSeconds > 0) {
				parts.push(formatDuration(episode.durationSeconds));
			}
			return parts.length > 0 ? parts.join(' · ') : showTitle;
		}, [episode.pubDate, episode.durationSeconds, showTitle]);

		const description = useMemo(() => {
			if ('description' in episode && episode.description) return episode.description;
			return null;
		}, [episode]);

		const displayPosition = livePosition ?? progress?.position ?? 0;
		const displayDuration = (liveDuration ?? progress?.duration ?? episode.durationSeconds ?? 0) || 1;
		const _progressPercent = displayDuration > 0 ? Math.min(1, Math.max(0, displayPosition / displayDuration)) : 0;
		const canResume = !isCurrentEpisode && progress && !progress.completed && progress.position > 10;
		// Played = currently playing, completed, or has ever been played (progress with position > 0)
		const isPlayed = isCurrentEpisode || progress?.completed === true || (progress != null && progress.position > 0);
		// Pill: unplayed → total duration; played (in progress) → time remaining; completed or no data → hide
		const pillLabel = (() => {
			if (!isPlayed) {
				if (episode.durationSeconds != null && episode.durationSeconds > 0) {
					return formatDurationShort(episode.durationSeconds);
				}
				return null;
			}
			// Played: show time remaining when > 0 (and not "0m" from rounding)
			const remaining = Math.max(0, displayDuration - displayPosition);
			if (remaining > 0) {
				const formatted = formatDurationShort(remaining);
				if (formatted !== '0m') return `${formatted} left`;
			}
			return null;
		})();

		const onPlayBarPress = useCallback(
			(e: { stopPropagation: () => void }) => {
				e.stopPropagation();
				if (isCurrentEpisode) {
					togglePlayPause();
				} else {
					handlePlay();
				}
			},
			[isCurrentEpisode, togglePlayPause, handlePlay],
		);

		return (
			<Pressable onPress={handlePress} style={styles.row}>
				<Div style={[styles.info, { borderBottomColor: colors.listDivider }]} transparent>
					<Div style={styles.titleRow} transparent>
						{!isPlayed && <View style={[styles.unplayedDot, { backgroundColor: colors.brand }]} />}
						<Text
							type='h3'
							numberOfLines={1}
							style={[styles.title, { flex: 1, color: isCurrentEpisode ? colors.brand : colors.text }]}
						>
							{episode.title}
						</Text>
						{progress?.completed ? (
							<SymbolView name='checkmark.circle' size={16} tintColor={colors.brand} style={{ marginLeft: 4 }} />
						) : null}
						{isDownloading ? (
							<ActivityIndicator size='small' color={colors.brand} />
						) : isDownloaded || isDownload(episode) ? (
							<SymbolView
								name='arrow.down.to.line.circle.fill'
								size={16}
								tintColor={colors.brand}
								style={{ marginLeft: 4 }}
							/>
						) : null}
					</Div>
					{description != null && (
						<Div style={styles.subtitleRow} transparent>
							<Text type='bodySM' numberOfLines={2} style={styles.subtitle}>
								{description}
							</Text>
						</Div>
					)}
					<Div style={styles.subtitleRow} transparent>
						{canResume && (
							<Text type='bodyXS' numberOfLines={1} style={[styles.subtitle, styles.resumeLabel]}>
								Resume from {formatDuration(Math.floor(progress!.position))}
							</Text>
						)}
						<Text type='bodyXS' numberOfLines={1} style={styles.subtitle}>
							{subtitle}
						</Text>
					</Div>
					<Div display='flex' flexDirection='row' alignItems='center' justifyContent='space-between'>
						<Pressable
							onPress={onPlayBarPress}
							style={[
								styles.playbackRow,
								{
									backgroundColor: colorScheme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
									borderColor: colorScheme === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)',
								},
							]}
						>
							<SymbolView
								name={isCurrentEpisode && isPlaying ? 'pause.fill' : 'play.fill'}
								size={12}
								tintColor={colors.brand}
							/>
							{pillLabel != null ? (
								<View style={styles.durationPill}>
									<Text type='bodyXS' style={styles.durationText}>
										{pillLabel}
									</Text>
								</View>
							) : null}
						</Pressable>

						<ContextMenu items={menuItems} style={styles.menuButton}>
							<SymbolView name='ellipsis' size={16} tintColor={colors.brand} />
						</ContextMenu>
					</Div>
				</Div>
			</Pressable>
		);
	},
	(prev, next) =>
		prev.episode.id === next.episode.id &&
		prev.episode.title === next.episode.title &&
		prev.showTitle === next.showTitle &&
		prev.listItem === next.listItem &&
		prev.feed?.id === next.feed?.id &&
		prev.queue?.length === next.queue?.length,
);

PodcastEpisodeItem.displayName = 'PodcastEpisodeItem';

export default PodcastEpisodeItem;

const styles = StyleSheet.create({
	row: {
		flexDirection: 'row',
		alignItems: 'center',
		marginBottom: 6,
		gap: 12,
	},
	info: {
		flex: 1,
		gap: 8,
		borderBottomWidth: StyleSheet.hairlineWidth,
		paddingBottom: 4,
		paddingRight: 4,
		minWidth: 0,
		marginBottom: 4,
	},
	titleRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 8,
	},
	unplayedDot: {
		width: 6,
		height: 6,
		borderRadius: 3,
	},
	menuButton: {
		alignItems: 'center',
		justifyContent: 'center',
		marginLeft: 4,
	},
	subtitleRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 4,
	},
	title: {
		fontWeight: '400',
	},
	subtitle: {
		fontWeight: '400',
		opacity: 0.6,
		marginBottom: 8,
	},
	resumeLabel: {
		marginRight: 6,
	},
	playbackRow: {
		maxWidth: 90,
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		gap: 10,
		marginVertical: 8,
		paddingVertical: 8,
		paddingHorizontal: 10,
		borderRadius: 20,
		borderWidth: StyleSheet.hairlineWidth,
	},
	durationPill: {
		paddingHorizontal: 8,
		paddingVertical: 4,
		borderRadius: 10,
		backgroundColor: 'rgba(127,98,245,0.15)',
	},
	durationText: {
		fontWeight: '600',
	},
});
