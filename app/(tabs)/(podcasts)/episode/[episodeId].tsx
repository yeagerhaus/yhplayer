import { Image } from 'expo-image';
import * as Linking from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import type React from 'react';
import { useCallback, useMemo } from 'react';
import { Alert, Pressable, StyleSheet, useColorScheme } from 'react-native';
import { Main } from '@/components';
import { ContextMenu, type ContextMenuItem } from '@/components/ContextMenu';
import { Div } from '@/components/Div';
import { Text } from '@/components/Text';
import { useAudioStore } from '@/hooks/useAudioStore';
import { useColors } from '@/hooks/useColors';
import { usePlaybackProgressStore } from '@/hooks/usePlaybackProgressStore';
import { usePodcastDownloadsStore } from '@/hooks/usePodcastDownloadsStore';
import { usePodcastProgressStore } from '@/hooks/usePodcastProgressStore';
import { usePodcastStore } from '@/hooks/usePodcastStore';
import { toPlayableSong } from '@/types';
import type { PodcastDownload, PodcastEpisode } from '@/types/podcast';

function _formatDuration(seconds: number | undefined): string {
	if (seconds == null || seconds <= 0) return '';
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);
	if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
	return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatDate(pubDate: string | undefined): string {
	if (!pubDate) return '';
	try {
		const d = new Date(pubDate);
		return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
	} catch {
		return pubDate;
	}
}

function formatDurationShort(seconds: number | undefined): string {
	if (seconds == null || seconds <= 0) return '';
	const h = Math.floor(seconds / 3600);
	const m = Math.round((seconds % 3600) / 60);
	if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
	return `${m} min`;
}

function isDownloadRecord(ep: PodcastEpisode | PodcastDownload): ep is PodcastDownload {
	return 'localUri' in ep && 'downloadedAt' in ep;
}

const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g;

function LinkedText({ text, style, linkColor }: { text: string; style?: any; linkColor: string }) {
	const parts = useMemo(() => {
		const result: React.ReactNode[] = [];
		let lastIndex = 0;
		URL_REGEX.lastIndex = 0;
		let match = URL_REGEX.exec(text);
		while (match !== null) {
			if (match.index > lastIndex) {
				result.push(text.slice(lastIndex, match.index));
			}
			const url = match[0];
			result.push(
				<Text key={match.index} type='body' style={{ color: linkColor }} onPress={() => Linking.openURL(url)}>
					{url}
				</Text>,
			);
			lastIndex = match.index + url.length;
			match = URL_REGEX.exec(text);
		}
		if (lastIndex < text.length) {
			result.push(text.slice(lastIndex));
		}
		return result;
	}, [text, linkColor]);

	return (
		<Text type='body' style={style}>
			{parts}
		</Text>
	);
}

export default function EpisodeDetailScreen() {
	const colors = useColors();
	const { episodeId, feedId } = useLocalSearchParams<{ episodeId: string; feedId: string }>();
	const colorScheme = useColorScheme();
	const isDark = colorScheme === 'dark';

	const feeds = usePodcastStore((s) => s.feeds);
	const episodesByFeedId = usePodcastStore((s) => s.episodesByFeedId);

	const feed = useMemo(() => feeds.find((f) => f.id === feedId), [feeds, feedId]);
	const downloadRecord = usePodcastDownloadsStore((s) => s.downloads[episodeId]);
	const episode = useMemo((): PodcastEpisode | PodcastDownload | undefined => {
		if (feedId && episodesByFeedId[feedId]) {
			const found = episodesByFeedId[feedId].find((ep) => ep.id === episodeId);
			if (found) return found;
		}
		if (downloadRecord) return downloadRecord;
		for (const eps of Object.values(episodesByFeedId)) {
			const found = eps.find((ep) => ep.id === episodeId);
			if (found) return found;
		}
		return undefined;
	}, [episodeId, feedId, episodesByFeedId, downloadRecord]);

	const currentSong = useAudioStore((s) => s.currentSong);
	const playSound = useAudioStore((s) => s.playSound);
	const playNext = useAudioStore((s) => s.playNext);
	const addToQueue = useAudioStore((s) => s.addToQueue);
	const togglePlayPause = useAudioStore((s) => s.togglePlayPause);
	const isPlaying = useAudioStore((s) => (s.currentSong?.id === episodeId ? s.isPlaying : false));

	const isCurrentEpisode = currentSong?.id === episodeId;
	const livePosition = usePlaybackProgressStore((s) => (isCurrentEpisode ? s.position : null));
	const liveDuration = usePlaybackProgressStore((s) => (isCurrentEpisode ? s.duration : null));

	const progress = usePodcastProgressStore((s) => s.progressByEpisodeId[episodeId]);
	const markAsPlayed = usePodcastProgressStore((s) => s.markAsPlayed);
	const saveProgress = usePodcastProgressStore((s) => s.saveProgress);

	const isDownloaded = usePodcastDownloadsStore((s) => s.isDownloaded(episodeId));
	const isDownloading = usePodcastDownloadsStore((s) => s.isDownloading(episodeId));
	const downloadEpisode = usePodcastDownloadsStore((s) => s.downloadEpisode);
	const removeDownload = usePodcastDownloadsStore((s) => s.removeDownload);
	const getLocalUri = usePodcastDownloadsStore((s) => s.getLocalUri);

	const showTitle = feed?.title || (episode && isDownloadRecord(episode) ? episode.showTitle : '') || 'Show';
	const showImageUrl = feed?.imageUrl || episode?.imageUrl;
	const localUri = useMemo(
		() => (episode && isDownloadRecord(episode) ? episode.localUri : getLocalUri(episodeId)),
		[episode, episodeId, getLocalUri],
	);

	const song = useMemo(() => {
		if (!episode) return null;
		return toPlayableSong(episode, showTitle, showImageUrl, localUri);
	}, [episode, showTitle, showImageUrl, localUri]);

	const displayPosition = livePosition ?? progress?.position ?? 0;
	const displayDuration = (liveDuration ?? progress?.duration ?? episode?.durationSeconds ?? 0) || 1;
	const progressPercent = displayDuration > 0 ? Math.min(1, Math.max(0, displayPosition / displayDuration)) : 0;

	const handlePlay = useCallback(() => {
		if (!song) return;
		if (isCurrentEpisode) {
			togglePlayPause();
		} else {
			playSound(song, [song]);
		}
	}, [song, isCurrentEpisode, togglePlayPause, playSound]);

	const handleDownload = useCallback(() => {
		if (!episode || !feed) return;
		if (isDownloaded || isDownloadRecord(episode)) {
			Alert.alert('Remove download', `Remove "${episode.title}" from this device?`, [
				{ text: 'Cancel', style: 'cancel' },
				{ text: 'Remove', style: 'destructive', onPress: () => removeDownload(episode.id).catch(() => {}) },
			]);
		} else {
			downloadEpisode(episode as PodcastEpisode, feed).catch(() => {});
		}
	}, [episode, feed, isDownloaded, removeDownload, downloadEpisode]);

	const menuItems: ContextMenuItem[] = useMemo(() => {
		if (!song) return [];
		const items: ContextMenuItem[] = [];

		if (progress?.completed) {
			items.push({
				label: 'Mark as Unplayed',
				systemImage: 'arrow.counterclockwise',
				onPress: () => saveProgress(episodeId, 0, progress.duration, false),
			});
		} else {
			items.push({
				label: 'Mark as Played',
				systemImage: 'checkmark.circle',
				onPress: () => markAsPlayed(episodeId),
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
		);

		return items;
	}, [song, progress, episodeId, saveProgress, markAsPlayed, playNext, addToQueue]);

	if (!episode) {
		return (
			<Div style={[styles.container, { backgroundColor: isDark ? '#000' : '#fff' }]}>
				<Div transparent style={styles.centered}>
					<Text type='body' colorVariant='muted'>
						Episode not found
					</Text>
				</Div>
			</Div>
		);
	}

	const artwork = episode.imageUrl || showImageUrl;
	const downloaded = isDownloaded || isDownloadRecord(episode);

	return (
		<Main style={[styles.container, { backgroundColor: isDark ? '#000' : '#fff' }]}>
			{artwork ? (
				<Div transparent display='flex' justifyContent='center' alignItems='center' style={{ width: '100%', paddingTop: 40 }}>
					<Image source={{ uri: artwork }} style={styles.artwork} contentFit='contain' />
				</Div>
			) : (
				<Div style={[styles.artwork, { backgroundColor: '#444', justifyContent: 'center', alignItems: 'center' }]}>
					<SymbolView name='mic.fill' size={80} type='hierarchical' tintColor='#999' />
				</Div>
			)}

			<Div transparent style={styles.titleSection}>
				<Div transparent style={styles.titleRow}>
					<Div transparent style={{ flex: 1 }}>
						<Text type='h2' style={styles.title}>
							{episode.title}
						</Text>
						<Pressable
							onPress={() =>
								feedId &&
								router.push({
									pathname: '/(tabs)/(podcasts)/[feedId]',
									params: { feedId },
								})
							}
						>
							<Text type='body' style={styles.showName}>
								{showTitle}
							</Text>
						</Pressable>
					</Div>
					<ContextMenu items={menuItems} style={styles.menuButton}>
						<SymbolView name='ellipsis' size={20} tintColor='#999' />
					</ContextMenu>
				</Div>

				<Div transparent style={styles.metaRow}>
					{episode.pubDate ? (
						<Text type='bodySM' colorVariant='muted'>
							{formatDate(episode.pubDate)}
						</Text>
					) : null}
					{episode.durationSeconds ? (
						<Text type='bodySM' colorVariant='muted'>
							{formatDurationShort(episode.durationSeconds)}
						</Text>
					) : null}
					{downloaded && (
						<Div transparent style={styles.downloadedBadge}>
							<SymbolView name='checkmark.circle' size={14} tintColor={colors.brand} />
							<Text type='bodyXS' style={{ color: colors.brand }}>
								Downloaded
							</Text>
						</Div>
					)}
				</Div>
			</Div>

			{/* Playback controls */}
			<Div transparent style={styles.controlsSection}>
				<Pressable
					onPress={handlePlay}
					style={[
						styles.playbackRow,
						{
							backgroundColor: colorScheme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
							borderColor: colorScheme === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)',
						},
					]}
				>
					<SymbolView name={isCurrentEpisode && isPlaying ? 'pause.fill' : 'play.fill'} size={12} tintColor={colors.brand} />
					<Div transparent style={styles.progressBarContainer}>
						<Div
							transparent
							style={[
								styles.progressBarTrack,
								{ backgroundColor: colorScheme === 'dark' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)' },
							]}
						>
							<Div
								transparent
								style={[styles.progressBarFill, { width: `${progressPercent * 100}%`, backgroundColor: colors.brand }]}
							/>
						</Div>
					</Div>
					<Div transparent style={styles.durationPill}>
						<Text type='bodyXS' style={[styles.durationText, { color: colors.brand }]}>
							{formatDurationShort(displayDuration)}
						</Text>
					</Div>
				</Pressable>

				<Div transparent style={styles.actionButtons}>
					<Pressable onPress={handleDownload} disabled={isDownloading} style={styles.actionButton}>
						<SymbolView name={downloaded ? 'trash' : 'arrow.down.circle'} size={22} tintColor={colors.brand} />
						<Text type='bodyXS' style={{ color: colors.brand }}>
							{isDownloading ? 'Downloading…' : downloaded ? 'Remove' : 'Download'}
						</Text>
					</Pressable>
					<Pressable
						onPress={() => {
							if (progress?.completed) {
								saveProgress(episodeId, 0, progress.duration, false);
							} else {
								markAsPlayed(episodeId);
							}
						}}
						style={styles.actionButton}
					>
						<SymbolView
							name={progress?.completed ? 'arrow.counterclockwise' : 'checkmark.circle'}
							size={22}
							tintColor={colors.brand}
						/>
						<Text type='bodyXS' style={{ color: colors.brand }}>
							{progress?.completed ? 'Unplayed' : 'Played'}
						</Text>
					</Pressable>
					{song && (
						<Pressable onPress={() => addToQueue([song])} style={styles.actionButton}>
							<SymbolView name='list.bullet' size={22} tintColor={colors.brand} />
							<Text type='bodyXS' style={{ color: colors.brand }}>
								Queue
							</Text>
						</Pressable>
					)}
				</Div>
			</Div>

			{/* Description / show notes */}
			{'description' in episode && episode.description ? (
				<Div transparent style={styles.descriptionSection}>
					<LinkedText text={episode.description} style={styles.description} linkColor={colors.brand} />
				</Div>
			) : null}
		</Main>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
	},
	centered: {
		flex: 1,
		justifyContent: 'center',
		alignItems: 'center',
		paddingTop: 80,
	},
	artwork: {
		width: '100%',
		maxHeight: 250,
		aspectRatio: 1,
		borderRadius: 8,
	},
	titleSection: {
		paddingHorizontal: 16,
		paddingTop: 20,
	},
	titleRow: {
		flexDirection: 'row',
		alignItems: 'flex-start',
		gap: 12,
	},
	title: {
		fontSize: 22,
		fontWeight: '700',
	},
	showName: {
		opacity: 0.6,
		marginTop: 4,
	},
	menuButton: {
		justifyContent: 'center',
		alignItems: 'center',
		marginTop: 6,
	},
	metaRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 12,
		marginTop: 12,
	},
	downloadedBadge: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 4,
	},
	controlsSection: {
		display: 'flex',
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		paddingHorizontal: 16,
		paddingTop: 24,
		gap: 16,
	},
	playbackRow: {
		maxWidth: 120,
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
	progressBarContainer: {
		flex: 1,
		minWidth: 0,
	},
	progressBarTrack: {
		height: 4,
		borderRadius: 2,
		overflow: 'hidden',
	},
	progressBarFill: {
		height: '100%',
		borderRadius: 2,
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
	actionButtons: {
		flexDirection: 'row',
		justifyContent: 'center',
		gap: 32,
		paddingTop: 8,
	},
	actionButton: {
		alignItems: 'center',
		gap: 4,
	},
	descriptionSection: {
		paddingHorizontal: 16,
		paddingTop: 24,
		paddingBottom: 140,
	},
	description: {
		opacity: 0.8,
		lineHeight: 22,
	},
});
