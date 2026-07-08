import React from 'react';
import { InteractionManager } from 'react-native';
import ImageColors from 'react-native-image-colors';
import { create } from 'zustand';
import { getStreamingPlaybackBitrateKbps } from '@/hooks/usePlaybackSettingsStore';
import { computeCrossfadeDuration, computeIncomingLoudnessTrim } from '@/lib/crossfadeAlgorithm';
import { getCachedNetworkPlaybackRoute } from '@/lib/networkPlaybackRoute';
import TrackPlayer, {
	Capability,
	Event,
	IOSCategory,
	IOSCategoryMode,
	RepeatMode,
	State,
	usePlaybackState,
	useTrackPlayerEvents,
} from '@/lib/playerAdapter';
import { storage } from '@/lib/storage';
import type { LoudnessData, Song } from '@/types';
import { performanceMonitor } from '@/utils/performance';
import { buildPlexStreamUrl } from '@/utils/plex-stream-url';
import { queueScrobble } from '@/utils/scrobble-queue';

// Storage keys
export const STORAGE_QUEUE_KEY = 'SONG_QUEUE';
export const STORAGE_ORIGINAL_QUEUE_KEY = 'ORIGINAL_QUEUE';
export const STORAGE_SONG_KEY = 'CURRENT_SONG';
export const STORAGE_SONG_DATA_KEY = 'CURRENT_SONG_DATA'; // full Song JSON for offline fallback
export const STORAGE_POSITION_KEY = 'CURRENT_POSITION';
export const STORAGE_REPEAT_MODE_KEY = 'REPEAT_MODE';
export const STORAGE_SHUFFLE_KEY = 'SHUFFLE_MODE';
export const STORAGE_VOLUME_KEY = 'VOLUME';
export const STORAGE_PLAYBACK_RATE_KEY = 'PLAYBACK_RATE';
export const STORAGE_SLEEP_TIMER_ENDS_AT_KEY = 'SLEEP_TIMER_ENDS_AT';

// Lightweight queue persistence — save only IDs, resolve from library store
function saveQueueState(queue: Song[], originalQueue: Song[], currentSong: Song | null) {
	const queueIds = queue.map((s) => s.id);
	const originalIds = originalQueue.map((s) => s.id);
	storage.set(STORAGE_QUEUE_KEY, JSON.stringify(queueIds));
	storage.set(STORAGE_ORIGINAL_QUEUE_KEY, JSON.stringify(originalIds));
	if (currentSong) {
		storage.set(STORAGE_SONG_KEY, currentSong.id);
	}
}

function saveCurrentSong(song: Song) {
	storage.set(STORAGE_SONG_KEY, song.id);
	storage.set(STORAGE_SONG_DATA_KEY, JSON.stringify(song));
}

function resolveIdsToSongs(ids: string[]): Song[] {
	const { useLibraryStore } = require('@/hooks/useLibraryStore');
	const songsById = useLibraryStore.getState().songsById;
	const songs: Song[] = [];
	for (const id of ids) {
		const song = songsById[id];
		if (song) songs.push(song);
	}
	return songs;
}

// Artwork color cache
const artworkColorCache = new Map<string, string>();

interface AudioState {
	// Playback state
	currentSong: Song | null;
	queue: Song[];
	originalQueue: Song[];
	isPlaying: boolean;
	repeatMode: number;
	isShuffled: boolean;
	volume: number;
	playbackRate: number;
	isBuffering: boolean;
	error: string | null;
	artworkBgColor: string | null;
	currentPlaylistRatingKey: string | null;

	// Playback actions
	playSound: (song: Song, queue?: Song[], options?: { playlistRatingKey?: string }) => Promise<void>;
	togglePlayPause: () => Promise<void>;
	skipToNext: () => Promise<void>;
	skipToPrevious: () => Promise<void>;
	seekTo: (position: number) => Promise<void>;
	skipBackward15: () => Promise<void>;
	skipForward15: () => Promise<void>;
	unloadPlayer: () => Promise<void>;

	// Queue management
	addToQueue: (songs: Song[]) => Promise<void>;
	playNext: (song: Song) => Promise<void>;
	removeFromQueue: (index: number) => void;
	clearQueue: () => void;
	reorderQueue: (fromIndex: number, toIndex: number) => void;
	getQueue: () => Song[];

	// Settings
	toggleRepeat: () => Promise<void>;
	toggleShuffle: () => Promise<void>;
	setVolume: (volume: number) => Promise<void>;
	setPlaybackRate: (rate: number) => Promise<void>;

	// Sleep timer (JS-based; works on all platforms)
	sleepTimerEndsAt: number | null;
	setSleepTimer: (minutes: number | null) => void;
	getSleepTimerRemainingSeconds: () => number | null;

	// Internal state management
	_isRestoringPlayback: boolean;
	_setIsPlaying: (isPlaying: boolean) => void;
	_setCurrentSong: (song: Song | null) => void;
	_setIsBuffering: (isBuffering: boolean) => void;
	_setError: (error: string | null) => void;
	_setArtworkBgColor: (color: string | null) => void;

	// Initialization
	initializePlayer: () => Promise<void>;
	restorePlaybackState: () => Promise<void>;
}

// Fisher-Yates shuffle algorithm
function shuffleArray<T>(array: T[]): T[] {
	const shuffled = [...array];
	for (let i = shuffled.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
	}
	return shuffled;
}

// Shuffle queue while keeping current song at the beginning
function createShuffledQueue(queue: Song[], currentSong: Song | null): Song[] {
	if (!currentSong || queue.length <= 1) return queue;

	const currentIndex = queue.findIndex((s) => s.id === currentSong.id);
	if (currentIndex === -1) return shuffleArray(queue);

	const withoutCurrent = queue.filter((_, i) => i !== currentIndex);
	const shuffled = shuffleArray(withoutCurrent);
	return [currentSong, ...shuffled];
}

// Track which song ID has been pre-warmed to avoid duplicate fetches
let prewarmedSongId: string | null = null;
let lastCrossfadeSignature = '';

function getNextQueueSongForCrossfade(queue: Song[], currentSong: Song | null, repeatMode: number): Song | null {
	if (!currentSong || queue.length < 2) return null;
	const idx = queue.findIndex((s) => s.id === currentSong.id);
	if (idx === -1) return null;
	let nextIdx = idx + 1;
	if (nextIdx >= queue.length) {
		if (repeatMode === RepeatMode.Queue) nextIdx = 0;
		else return null;
	}
	return queue[nextIdx] ?? null;
}

// Playback error retry tracking
let lastErrorRetryAt = 0;

// Natural advance (track ended → next started): latency tracking (excludes skips)
let lastProgressTimestamp = 0; // timestamp of the last progress update for gap measurement
let lastUserSkipAt = 0;
const SKIP_DEBOUNCE_MS = 2000;
let restoredPausedAt = 0; // set after a paused restore; suppresses spurious iOS RemotePlay
const RESTORE_REMOTE_PLAY_SUPPRESS_MS = 3000;

function scrobbleSong(song: Song) {
	if (song.source === 'podcast') return;
	queueScrobble(song).catch(() => {});
}

// Extract artwork color with caching
async function extractArtworkColor(song: Song): Promise<string> {
	// Check cache first
	if (artworkColorCache.has(song.id)) {
		return artworkColorCache.get(song.id)!;
	}

	const artworkUrl = song.artworkUrl || song.artwork;
	if (!artworkUrl) {
		return '#000';
	}

	try {
		const result = await ImageColors.getColors(artworkUrl, {
			fallback: '#000',
			cache: true,
			key: song.id.toString(),
		});

		let color = '#000';
		if (result.platform === 'android' || result.platform === 'web') {
			color = result.dominant || '#000';
		} else if (result.platform === 'ios') {
			color = result.background || '#000';
		}

		// Cache the result
		artworkColorCache.set(song.id, color);
		return color;
	} catch (err) {
		console.warn('Failed to extract artwork color:', err);
		return '#000';
	}
}

// Cached lazy-require accessors (avoids repeated require() per call in hot paths)
let _downloadsStore: typeof import('@/hooks/useMusicDownloadsStore').useMusicDownloadsStore | undefined;
let _playbackSettingsStore: typeof import('@/hooks/usePlaybackSettingsStore').usePlaybackSettingsStore | undefined;
let _progressStore: typeof import('@/hooks/usePlaybackProgressStore').usePlaybackProgressStore | undefined;

function getDownloadsStore() {
	if (!_downloadsStore) {
		_downloadsStore = require('@/hooks/useMusicDownloadsStore').useMusicDownloadsStore;
	}
	return _downloadsStore!;
}

/** Prefer `Song.loudnessData`; fall back to value stored when the track was downloaded. */
function effectiveLoudnessData(song: Song | null | undefined): LoudnessData | undefined {
	if (!song) return undefined;
	if (song.loudnessData) return song.loudnessData;
	return getDownloadsStore().getState().downloads[song.id]?.loudnessData;
}
function getPlaybackSettingsStore() {
	if (!_playbackSettingsStore) {
		_playbackSettingsStore = require('@/hooks/usePlaybackSettingsStore').usePlaybackSettingsStore;
	}
	return _playbackSettingsStore!;
}
function getProgressStore() {
	if (!_progressStore) {
		_progressStore = require('@/hooks/usePlaybackProgressStore').usePlaybackProgressStore;
	}
	return _progressStore!;
}

// Convert Song to TrackPlayer track
function songToTrack(song: Song) {
	const localUri = song.localUri || getDownloadsStore().getState().getLocalUri(song.id);
	if (__DEV__ && !localUri) {
		// console.log(`[songToTrack] No localUri for ${song.id}, using remote URL`);
	}
	const url = localUri || (typeof song.uri === 'string' && song.uri.trim().length > 0 ? song.uri : null);
	if (song.source === 'podcast' && !url) {
		throw new Error('Podcast episode has no playable URL');
	}

	const referenceUrl = url ?? song.uri ?? '';
	let finalUrl = referenceUrl;
	let directUrl: string | undefined;
	if (!localUri && song.source !== 'podcast' && finalUrl.includes('X-Plex-Token')) {
		const ps = getPlaybackSettingsStore().getState();
		const bitrate = getStreamingPlaybackBitrateKbps(
			ps.streamingBitrateWifi,
			ps.streamingBitrateCellular,
			ps.streamingTranscodeCapKbps,
			getCachedNetworkPlaybackRoute(),
		);
		if (bitrate !== null) {
			const built = buildPlexStreamUrl(song, referenceUrl, bitrate);
			finalUrl = built.url;
			directUrl = built.directUrl;
			// console.log(`[songToTrack] Plex remote stream ${song.id} @ ${bitrate} kbps`);
		}
	}

	return {
		id: song.id.toString(),
		url: finalUrl,
		...(directUrl ? { directUrl } : {}),
		title: song.title,
		artist: song.artist,
		album: song.album,
		artwork: song.artworkUrl || song.artwork,
		duration: song.duration,
		...(song.source === 'podcast' ? { crossfadeDisabled: true as const } : {}),
	};
}

/** Resume position for a podcast: for downloaded episodes use the download record (resumeAt); otherwise progress store. */
function getPodcastResumePosition(song: Song): number | undefined {
	const { usePodcastDownloadsStore } = require('@/hooks/usePodcastDownloadsStore');
	const { usePodcastProgressStore } = require('@/hooks/usePodcastProgressStore');
	const progress = usePodcastProgressStore.getState().getProgress(song.id);
	const isDownloaded = usePodcastDownloadsStore.getState().isDownloaded(song.id);
	const downloadResumeAt = isDownloaded ? usePodcastDownloadsStore.getState().getResumeAt(song.id) : undefined;

	if (isDownloaded && downloadResumeAt != null && downloadResumeAt > 10) return downloadResumeAt;
	if (progress?.completed) return undefined;
	if (progress && progress.position > 10) return progress.position;
	return undefined;
}

/**
 * If current song is a podcast with saved progress, resume from it. The native podcast backend
 * (AVPlayer) applies the seek as soon as the item is ready, so a single seekTo is reliable even
 * before playback has actually started (no deferred re-seek needed).
 */
async function maybeResumePodcast(song: Song): Promise<void> {
	if (song.source !== 'podcast') return;
	const position = getPodcastResumePosition(song);
	if (position == null) return;
	await TrackPlayer.seekTo(position);
}

// Podcast progress: debounced save while playing (latest position), immediate save on pause
let podcastProgressTimeout: ReturnType<typeof setTimeout> | null = null;
let pendingPodcastProgress: { episodeId: string; position: number; duration: number } | null = null;
const PODCAST_PROGRESS_DEBOUNCE_MS = 3000;

function schedulePodcastProgressSave(episodeId: string, position: number, duration: number) {
	pendingPodcastProgress = { episodeId, position, duration };
	if (podcastProgressTimeout == null) {
		podcastProgressTimeout = setTimeout(() => {
			if (pendingPodcastProgress) {
				const { usePodcastProgressStore } = require('@/hooks/usePodcastProgressStore');
				usePodcastProgressStore
					.getState()
					.saveProgress(pendingPodcastProgress.episodeId, pendingPodcastProgress.position, pendingPodcastProgress.duration);
				const { usePodcastDownloadsStore } = require('@/hooks/usePodcastDownloadsStore');
				if (usePodcastDownloadsStore.getState().isDownloaded(pendingPodcastProgress.episodeId)) {
					usePodcastDownloadsStore
						.getState()
						.updateResumeAt(pendingPodcastProgress.episodeId, pendingPodcastProgress.position)
						.catch(() => {});
				}
				pendingPodcastProgress = null;
			}
			podcastProgressTimeout = null;
		}, PODCAST_PROGRESS_DEBOUNCE_MS);
	}
}

function savePodcastProgressImmediate(episodeId: string, position: number, duration: number) {
	if (podcastProgressTimeout) {
		clearTimeout(podcastProgressTimeout);
		podcastProgressTimeout = null;
	}
	pendingPodcastProgress = null;
	// Don't save 0/0 — this happens during reset()/add() race and would clobber real progress
	if (position <= 0 && duration <= 0) return;
	const { usePodcastProgressStore } = require('@/hooks/usePodcastProgressStore');
	usePodcastProgressStore.getState().saveProgress(episodeId, position, duration);
	const { usePodcastDownloadsStore } = require('@/hooks/usePodcastDownloadsStore');
	if (usePodcastDownloadsStore.getState().isDownloaded(episodeId)) {
		usePodcastDownloadsStore
			.getState()
			.updateResumeAt(episodeId, position)
			.catch(() => {});
	}
}

export const useAudioStore = create<AudioState>((set, get) => ({
	// Initial state
	currentSong: null,
	queue: [],
	originalQueue: [],
	isPlaying: false,
	repeatMode: RepeatMode.Queue,
	isShuffled: false,
	volume: 1.0,
	playbackRate: 1.0,
	isBuffering: false,
	error: null,
	artworkBgColor: null,
	currentPlaylistRatingKey: null,
	sleepTimerEndsAt: null,
	_isRestoringPlayback: false,

	// Internal setters
	_setIsPlaying: (isPlaying) => set({ isPlaying }),
	_setCurrentSong: (song) => set({ currentSong: song }),
	_setIsBuffering: (isBuffering) => set({ isBuffering }),
	_setError: (error) => set({ error }),
	_setArtworkBgColor: (color) => set({ artworkBgColor: color }),

	// Initialize TrackPlayer
	initializePlayer: async () => {
		try {
			// Try to setup player, but ignore if already initialized
			try {
				await TrackPlayer.setupPlayer({
					iosCategory: IOSCategory.Playback,
					iosCategoryMode: IOSCategoryMode.Default,
					autoHandleInterruptions: true,
					minBuffer: 120,
					maxBuffer: 300,
					playBuffer: 1,
					waitForBuffer: false,
				});
			} catch (setupError: any) {
				// If player is already initialized, that's fine - just continue
				if (setupError?.message?.includes('already been initialized')) {
					console.log('TrackPlayer already initialized, skipping setup');
				} else {
					// Re-throw other errors
					throw setupError;
				}
			}

			await TrackPlayer.updateOptions({
				alwaysPauseOnInterruption: false,
				capabilities: [Capability.Play, Capability.Pause, Capability.SkipToNext, Capability.SkipToPrevious, Capability.SeekTo],
				compactCapabilities: [Capability.Play, Capability.Pause],
				notificationCapabilities: [
					Capability.Play,
					Capability.Pause,
					Capability.SkipToNext,
					Capability.SkipToPrevious,
					Capability.SeekTo,
				],
				progressUpdateEventInterval: 0.5,
			});

			getPlaybackSettingsStore().getState().syncNativeCrossfade();

			// Restore saved settings
			try {
				const savedRepeatStr = storage.getString(STORAGE_REPEAT_MODE_KEY);
				const savedShuffleStr = storage.getString(STORAGE_SHUFFLE_KEY);
				const savedVolumeStr = storage.getString(STORAGE_VOLUME_KEY);
				const savedRateStr = storage.getString(STORAGE_PLAYBACK_RATE_KEY);
				const savedSleepTimerEndsAtStr = storage.getString(STORAGE_SLEEP_TIMER_ENDS_AT_KEY);

				if (savedRepeatStr) {
					const repeatMode = Number.parseInt(savedRepeatStr, 10);
					set({ repeatMode });
					await TrackPlayer.setRepeatMode(repeatMode);
				}

				if (savedShuffleStr) {
					set({ isShuffled: savedShuffleStr === 'true' });
				}

				if (savedVolumeStr) {
					const volume = Number.parseFloat(savedVolumeStr);
					set({ volume });
					await TrackPlayer.setVolume(volume);
				}

				if (savedRateStr) {
					const rate = Number.parseFloat(savedRateStr);
					set({ playbackRate: rate });
					await TrackPlayer.setRate(rate);
				}

				if (savedSleepTimerEndsAtStr) {
					const endsAt = Number.parseInt(savedSleepTimerEndsAtStr, 10);
					if (endsAt > Date.now()) {
						set({ sleepTimerEndsAt: endsAt });
					} else {
						storage.remove(STORAGE_SLEEP_TIMER_ENDS_AT_KEY);
					}
				}

				await get().restorePlaybackState();
			} catch (err) {
				console.warn('Failed to restore playback state:', err);
			}
		} catch (err) {
			console.error('Failed to initialize TrackPlayer:', err);
			set({ error: 'Failed to initialize audio player' });
		}
	},

	// Restore queue + current song + position from MMKV.
	// Safe to call multiple times — bails early if a song is already loaded.
	// Falls back to a single-song queue if the library isn't hydrated yet (shows mini player).
	restorePlaybackState: async () => {
		if (get().currentSong !== null) return;

		try {
			const savedSongStr = storage.getString(STORAGE_SONG_KEY);
			const savedSongDataStr = storage.getString(STORAGE_SONG_DATA_KEY);
			const savedQueueStr = storage.getString(STORAGE_QUEUE_KEY);
			const savedOriginalQueueStr = storage.getString(STORAGE_ORIGINAL_QUEUE_KEY);
			const savedPosStr = storage.getString(STORAGE_POSITION_KEY);

			if (!savedSongStr && !savedSongDataStr) return;

			// Resolve current song: library lookup first, then fall back to stored full JSON
			let currentSong: Song | null = null;
			if (savedSongStr) {
				try {
					const songParsed = JSON.parse(savedSongStr);
					const songId = typeof songParsed === 'string' ? songParsed : songParsed?.id;
					if (songId) {
						const { useLibraryStore } = require('@/hooks/useLibraryStore');
						currentSong = useLibraryStore.getState().songsById[songId] || null;
					}
				} catch {
					const { useLibraryStore } = require('@/hooks/useLibraryStore');
					currentSong = useLibraryStore.getState().songsById[savedSongStr] || null;
				}
			}
			if (!currentSong && savedSongDataStr) {
				try {
					currentSong = JSON.parse(savedSongDataStr) as Song;
				} catch {}
			}
			if (!currentSong) return;

			const position = savedPosStr ? Number(savedPosStr) : 0;

			// Resolve full queue from library; fall back to single-song queue
			let queue: Song[] = [];
			if (savedQueueStr) {
				try {
					const parsed = JSON.parse(savedQueueStr);
					const queueIds: string[] =
						Array.isArray(parsed) && typeof parsed[0] === 'string'
							? parsed
							: Array.isArray(parsed)
								? parsed.map((s: any) => s.id)
								: [];
					queue = resolveIdsToSongs(queueIds);
				} catch {}
			}

			const isPartialRestore = queue.length === 0;
			if (isPartialRestore) {
				queue = [currentSong]; // library not ready; mini player + single-song playback
			} else if (savedOriginalQueueStr) {
				try {
					const origParsed = JSON.parse(savedOriginalQueueStr);
					const origIds: string[] =
						Array.isArray(origParsed) && typeof origParsed[0] === 'string'
							? origParsed
							: Array.isArray(origParsed)
								? origParsed.map((s: any) => s.id)
								: [];
					const resolvedOrig = resolveIdsToSongs(origIds);
					if (resolvedOrig.length > 0) set({ originalQueue: resolvedOrig });
				} catch {}
			}

			// Defer native queue load until after transitions/animations so a quick "open album" tap
			// does not reset() a restore that already started a download (avoids spurious "cancelled").
			await new Promise<void>((resolve) => {
				InteractionManager.runAfterInteractions(() => resolve());
			});

			// Reset native player before loading — prevents stale queue from a previous
			// JS session (e.g. Metro reload) causing duplicate tracks or wrong skip index.
			// The flag suppresses the sync hook for the entire native operation.
			set({ _isRestoringPlayback: true });
			try {
				await TrackPlayer.reset();
				await TrackPlayer.add(queue.map(songToTrack));

				const trackIndex = Math.max(
					0,
					queue.findIndex((s) => s.id === currentSong!.id),
				);
				// Load the track paused at the saved position atomically. The native `skip` runs an async
				// load/prime; passing startPaused/startAtSeconds lets it seek and stay paused INSIDE that
				// task, avoiding the race where a separate pause() ran before load finished and playback
				// then auto-started (and reset position to 0).
				await TrackPlayer.skip(trackIndex, { startPaused: true, startAtSeconds: position > 0 ? position : undefined });
				restoredPausedAt = Date.now();
			} finally {
				set({ _isRestoringPlayback: false });
			}

			const color = await extractArtworkColor(currentSong);
			set({ currentSong, queue, artworkBgColor: color, isPlaying: false });
			const usePlaybackProgressStore = getProgressStore();
			usePlaybackProgressStore.setState({ position });

			if (currentSong.source !== 'podcast') {
				await TrackPlayer.setRate(1);
				set({ playbackRate: 1 });
			}

			if (isPartialRestore) {
				console.log('⚠️ Partial restore (library not cached): showing last track, full queue pending');
			} else {
				// console.log(`✅ Restored playback state (${queue.length} tracks)`);
			}
		} catch (err) {
			console.warn('Failed to restore playback state:', err);
		}
	},

	// Play sound
	playSound: async (song: Song, newQueue?: Song[], options?: { playlistRatingKey?: string }) => {
		lastUserSkipAt = Date.now(); // user-initiated track change, not natural advance
		return performanceMonitor.trackAsync(
			'playSound',
			async () => {
				try {
					// Podcast: require a playable URI (native layer creates empty asset otherwise → no sound)
					if (song.source === 'podcast') {
						const uri = song.uri;
						if (typeof uri !== 'string' || uri.trim().length === 0) {
							set({
								error: 'This episode has no playable URL',
								currentSong: song,
								artworkBgColor: null,
							});
							return;
						}
					}

					// If switching away from a podcast, save its progress NOW (before we update currentSong,
					// because PlaybackActiveTrackChanged will see the new currentSong and skip the save).
					const prev = get().currentSong;
					if (prev?.source === 'podcast' && prev.id !== song.id) {
						const usePlaybackProgressStore = getProgressStore();
						const { position: prevPos, duration: prevDur } = usePlaybackProgressStore.getState();
						savePodcastProgressImmediate(prev.id, prevPos, prevDur);
					}

					// Track playlist context for scrobbling
					set({
						error: null,
						currentSong: song,
						currentPlaylistRatingKey: options?.playlistRatingKey ?? null,
					});
					saveCurrentSong(song);
					storage.remove(STORAGE_POSITION_KEY);

					// Fire-and-forget artwork color extraction
					extractArtworkColor(song)
						.then((color) => set({ artworkBgColor: color }))
						.catch(() => set({ artworkBgColor: '#000' }));

					const state = get();

					// Compare queues using Zustand state — no bridge call needed.
					// Never use same-queue shortcut for podcasts: native queue can be out of sync (e.g. after
					// restore or error recovery), so we always reset+add to guarantee playback.
					const isSameQueue =
						song.source !== 'podcast' &&
						newQueue &&
						state.queue.length === newQueue.length &&
						state.queue.length > 0 &&
						state.queue[0]?.id === newQueue[0]?.id &&
						state.queue[state.queue.length - 1]?.id === newQueue[newQueue.length - 1]?.id;

					if (isSameQueue) {
						// Same queue — just skip to the song (fastest path)
						const trackIndex = state.queue.findIndex((s) => s.id === song.id);
						if (trackIndex !== -1) {
							await TrackPlayer.skip(trackIndex);
						}
						await maybeResumePodcast(song);
						await TrackPlayer.play();
					} else if (newQueue) {
						// New queue — reset and load. Podcasts: single-episode queue only (no next/prev, avoids slow 292-track add).
						const queueToUse =
							song.source === 'podcast' ? [song] : state.isShuffled ? createShuffledQueue(newQueue, song) : newQueue;

						await TrackPlayer.reset();
						await TrackPlayer.add(queueToUse.map(songToTrack));

						// Set queue BEFORE skip so PlaybackActiveTrackChanged sees correct state
						saveQueueState(queueToUse, song.source === 'podcast' ? [song] : newQueue, song);
						set({ queue: queueToUse, originalQueue: song.source === 'podcast' ? [song] : newQueue });

						const trackIndex = queueToUse.findIndex((t) => t.id === song.id);
						await TrackPlayer.skip(Math.max(0, trackIndex));

						await maybeResumePodcast(song);
						await TrackPlayer.play();
					} else {
						// Single song
						await TrackPlayer.reset();
						await TrackPlayer.add(songToTrack(song));
						set({ queue: [song], originalQueue: [song] });
						await TrackPlayer.skip(0);
						await maybeResumePodcast(song);
						await TrackPlayer.play();
					}

					// Reset playback rate: always 1x for music; restore saved rate for podcasts
					if (song.source !== 'podcast') {
						if (get().playbackRate !== 1) {
							await TrackPlayer.setRate(1);
							set({ playbackRate: 1 });
						}
					} else {
						const savedRateStr = storage.getString(STORAGE_PLAYBACK_RATE_KEY);
						const savedRate = savedRateStr ? Math.max(0.5, Math.min(2.0, Number.parseFloat(savedRateStr))) : 1;
						if (get().playbackRate !== savedRate) {
							await TrackPlayer.setRate(savedRate);
							set({ playbackRate: savedRate });
						}
					}

					// Ensure podcast has a progress entry so UI shows bar and we persist updates.
					// Also clear stale "completed" flag if the user is re-playing an episode.
					if (song.source === 'podcast') {
						const { usePodcastProgressStore } = require('@/hooks/usePodcastProgressStore');
						const existing = usePodcastProgressStore.getState().getProgress(song.id);
						if (!existing) {
							usePodcastProgressStore.getState().saveProgress(song.id, 0, song.duration || 0);
						} else if (existing.completed && existing.position < existing.duration * 0.9) {
							usePodcastProgressStore.getState().saveProgress(song.id, existing.position, existing.duration, false);
						}
					}
				} catch (error) {
					console.error('Error in playSound:', error);
					set({
						error: 'Failed to play song',
						currentSong: null,
						isPlaying: false,
						artworkBgColor: null,
					});
					storage.remove(STORAGE_SONG_KEY);
				}
			},
			{ songId: song.id, queueLength: newQueue?.length || 0 },
		);
	},

	// Toggle play/pause
	togglePlayPause: async () => {
		restoredPausedAt = 0; // user explicitly interacting — lift restore suppression
		try {
			const playbackState = await TrackPlayer.getPlaybackState();
			if (playbackState.state === State.Playing) {
				await TrackPlayer.pause();
			} else {
				await TrackPlayer.play();
			}
		} catch (error) {
			console.error('Error toggling play/pause:', error);
		}
	},

	// Skip to next
	skipToNext: async () => {
		lastUserSkipAt = Date.now();
		return performanceMonitor.trackAsync('skipToNext', async () => {
			try {
				const state = get();
				if (!state.currentSong || state.queue.length === 0) return;

				const currentIndex = state.queue.findIndex((s) => s.id === state.currentSong!.id);
				if (currentIndex === -1) return;

				const nextIndex = (currentIndex + 1) % state.queue.length;
				const nextSong = state.queue[nextIndex];

				await TrackPlayer.skip(nextIndex);
				set({ currentSong: nextSong });

				saveQueueState(state.queue, state.originalQueue, nextSong);
				storage.remove(STORAGE_POSITION_KEY);

				extractArtworkColor(nextSong)
					.then((color) => set({ artworkBgColor: color }))
					.catch(() => set({ artworkBgColor: '#000' }));
			} catch (error) {
				console.error('Error skipping to next:', error);
			}
		});
	},

	// Skip to previous
	skipToPrevious: async () => {
		lastUserSkipAt = Date.now();
		return performanceMonitor.trackAsync('skipToPrevious', async () => {
			try {
				const state = get();
				if (!state.currentSong || state.queue.length === 0) return;

				// If position >= 3s, restart current song
				const usePlaybackProgressStore = getProgressStore();
				if (usePlaybackProgressStore.getState().position >= 3) {
					await TrackPlayer.seekTo(0);
					return;
				}

				const currentIndex = state.queue.findIndex((s) => s.id === state.currentSong!.id);
				if (currentIndex === -1) return;

				const prevIndex = currentIndex === 0 ? state.queue.length - 1 : currentIndex - 1;
				const prevSong = state.queue[prevIndex];

				await TrackPlayer.skip(prevIndex);
				set({ currentSong: prevSong });

				saveQueueState(state.queue, state.originalQueue, prevSong);
				storage.remove(STORAGE_POSITION_KEY);

				extractArtworkColor(prevSong)
					.then((color) => set({ artworkBgColor: color }))
					.catch(() => set({ artworkBgColor: '#000' }));
			} catch (error) {
				console.error('Error skipping to previous:', error);
			}
		});
	},

	// Seek to position
	seekTo: async (position: number) => {
		try {
			await TrackPlayer.seekTo(position);
			const usePlaybackProgressStore = getProgressStore();
			usePlaybackProgressStore.getState().setPosition(position);
		} catch (error) {
			console.error('Error seeking:', error);
		}
	},

	skipBackward15: async () => {
		const usePlaybackProgressStore = getProgressStore();
		const { position } = usePlaybackProgressStore.getState();
		await get().seekTo(Math.max(0, position - 15));
	},

	skipForward15: async () => {
		const usePlaybackProgressStore = getProgressStore();
		const { position, duration } = usePlaybackProgressStore.getState();
		await get().seekTo(Math.min(duration, position + 15));
	},

	// Add to queue
	addToQueue: async (songs: Song[]) => {
		try {
			const state = get();
			const newQueue = [...state.queue, ...songs];
			const newOriginalQueue = [...state.originalQueue, ...songs];

			await TrackPlayer.add(songs.map(songToTrack));

			set({ queue: newQueue, originalQueue: newOriginalQueue });
			saveQueueState(newQueue, newOriginalQueue, state.currentSong);
		} catch (error) {
			console.error('Error adding to queue:', error);
		}
	},

	// Play next (insert after current song)
	playNext: async (song: Song) => {
		try {
			const state = get();
			if (!state.currentSong) {
				await get().playSound(song, [song]);
				return;
			}

			const currentIndex = state.queue.findIndex((s) => s.id === state.currentSong!.id);
			if (currentIndex === -1) return;

			const newQueue = [...state.queue];
			newQueue.splice(currentIndex + 1, 0, song);

			const newOriginalQueue = [...state.originalQueue];
			const originalIndex = newOriginalQueue.findIndex((s) => s.id === state.currentSong!.id);
			if (originalIndex !== -1) {
				newOriginalQueue.splice(originalIndex + 1, 0, song);
			}

			// Get current TrackPlayer queue and insert the song
			const trackPlayerQueue = await TrackPlayer.getQueue();
			const trackPlayerIndex = trackPlayerQueue.findIndex((t) => t.id === state.currentSong!.id);
			if (trackPlayerIndex !== -1) {
				await TrackPlayer.add(songToTrack(song), trackPlayerIndex + 1);
			}

			set({ queue: newQueue, originalQueue: newOriginalQueue });
			saveQueueState(newQueue, newOriginalQueue, state.currentSong);
		} catch (error) {
			console.error('Error adding song to play next:', error);
		}
	},

	// Remove from queue
	removeFromQueue: (index: number) => {
		const state = get();
		if (index < 0 || index >= state.queue.length) return;

		const newQueue = [...state.queue];
		const removedSong = newQueue.splice(index, 1)[0];

		// Remove from original queue as well
		const newOriginalQueue = state.originalQueue.filter((s) => s.id !== removedSong.id);

		set({ queue: newQueue, originalQueue: newOriginalQueue });
		saveQueueState(newQueue, newOriginalQueue, state.currentSong);

		// Remove from TrackPlayer
		TrackPlayer.remove(index).catch((err) => console.warn('Failed to remove track:', err));
	},

	// Clear queue
	clearQueue: () => {
		const state = get();
		if (!state.currentSong) return;

		const newQueue = [state.currentSong];
		const newOriginalQueue = [state.currentSong];

		set({ queue: newQueue, originalQueue: newOriginalQueue });
		saveQueueState(newQueue, newOriginalQueue, state.currentSong);

		// Reset TrackPlayer queue
		TrackPlayer.reset()
			.then(() => TrackPlayer.add(songToTrack(state.currentSong!)))
			.catch((err) => console.warn('Failed to reset queue:', err));
	},

	// Fully unload the player: stop playback, clear the queue, current song,
	// persisted playback state, and reset progress. Leaves user settings
	// (repeat/shuffle/volume/rate/sleep timer) untouched.
	unloadPlayer: async () => {
		try {
			await TrackPlayer.reset();
		} catch (error) {
			console.warn('Failed to reset player during unload:', error);
		}

		prewarmedSongId = null;
		lastCrossfadeSignature = '';

		set({
			currentSong: null,
			queue: [],
			originalQueue: [],
			isPlaying: false,
			isBuffering: false,
			artworkBgColor: null,
			currentPlaylistRatingKey: null,
			error: null,
		});

		try {
			const progressStore = getProgressStore();
			progressStore.getState().setPosition(0);
			progressStore.getState().setDuration(0);
		} catch {}

		storage.remove(STORAGE_QUEUE_KEY);
		storage.remove(STORAGE_ORIGINAL_QUEUE_KEY);
		storage.remove(STORAGE_SONG_KEY);
		storage.remove(STORAGE_SONG_DATA_KEY);
		storage.remove(STORAGE_POSITION_KEY);
	},

	// Reorder queue
	reorderQueue: (fromIndex: number, toIndex: number) => {
		const state = get();
		if (fromIndex < 0 || fromIndex >= state.queue.length || toIndex < 0 || toIndex >= state.queue.length) {
			return;
		}

		const newQueue = [...state.queue];
		const [movedSong] = newQueue.splice(fromIndex, 1);
		newQueue.splice(toIndex, 0, movedSong);

		set({ queue: newQueue });
		storage.set(STORAGE_QUEUE_KEY, JSON.stringify(newQueue.map((s) => s.id)));

		// Reorder in TrackPlayer
		TrackPlayer.move(fromIndex, toIndex).catch((err) => console.warn('Failed to reorder track:', err));
	},

	// Get queue
	getQueue: () => get().queue,

	// Toggle repeat
	toggleRepeat: async () => {
		const state = get();
		const nextMode =
			state.repeatMode === RepeatMode.Off
				? RepeatMode.Track
				: state.repeatMode === RepeatMode.Track
					? RepeatMode.Queue
					: RepeatMode.Off;

		await TrackPlayer.setRepeatMode(nextMode);
		set({ repeatMode: nextMode });
		storage.set(STORAGE_REPEAT_MODE_KEY, String(nextMode));
	},

	// Toggle shuffle — swaps upcoming tracks without interrupting current playback
	// Toggle shuffle — reorders queue around the current track without interrupting playback
	toggleShuffle: async () => {
		const state = get();
		const newShuffleState = !state.isShuffled;

		let newQueue: Song[];

		if (newShuffleState) {
			newQueue = createShuffledQueue(state.originalQueue, state.currentSong);
		} else {
			newQueue = [...state.originalQueue];
		}

		set({ isShuffled: newShuffleState, queue: newQueue });

		// Rebuild TrackPlayer queue around the current track without interrupting it
		try {
			const activeIndex = await TrackPlayer.getActiveTrackIndex();
			if (activeIndex != null) {
				// Remove tracks BEFORE the current one (so current becomes index 0)
				if (activeIndex > 0) {
					const beforeIndices = Array.from({ length: activeIndex }, (_, i) => i);
					await TrackPlayer.remove(beforeIndices);
				}
				// Now current track is at index 0 — remove everything after it
				await TrackPlayer.removeUpcomingTracks();

				// Build the rest of the queue: everything except current song
				const currentId = state.currentSong?.id;
				const rest = newQueue.filter((s) => s.id !== currentId);

				if (rest.length > 0) {
					await TrackPlayer.add(rest.map(songToTrack));
				}
			}
		} catch (err) {
			console.warn('Failed to update TrackPlayer queue for shuffle:', err);
		}

		storage.set(STORAGE_QUEUE_KEY, JSON.stringify(newQueue.map((s) => s.id)));
		storage.set(STORAGE_SHUFFLE_KEY, String(newShuffleState));
	},

	// Set volume
	setVolume: async (volume: number) => {
		try {
			const clampedVolume = Math.max(0, Math.min(1, volume));
			await TrackPlayer.setVolume(clampedVolume);
			set({ volume: clampedVolume });
			storage.set(STORAGE_VOLUME_KEY, String(clampedVolume));
		} catch (error) {
			console.error('Error setting volume:', error);
		}
	},

	// Set playback rate
	setPlaybackRate: async (rate: number) => {
		try {
			const clampedRate = Math.max(0.5, Math.min(2.0, rate));
			await TrackPlayer.setRate(clampedRate);
			set({ playbackRate: clampedRate });
			storage.set(STORAGE_PLAYBACK_RATE_KEY, String(clampedRate));
		} catch (error) {
			console.error('Error setting playback rate:', error);
		}
	},

	setSleepTimer: (minutes: number | null) => {
		if (minutes == null) {
			set({ sleepTimerEndsAt: null });
			storage.remove(STORAGE_SLEEP_TIMER_ENDS_AT_KEY);
			return;
		}
		const endsAt = Date.now() + minutes * 60 * 1000;
		set({ sleepTimerEndsAt: endsAt });
		storage.set(STORAGE_SLEEP_TIMER_ENDS_AT_KEY, String(endsAt));
	},

	getSleepTimerRemainingSeconds: () => {
		const endsAt = get().sleepTimerEndsAt;
		if (endsAt == null) return null;
		const rem = Math.ceil((endsAt - Date.now()) / 1000);
		return rem <= 0 ? null : rem;
	},
}));

// Hook to sync TrackPlayer events with the store
export function useTrackPlayerSync() {
	const playbackState = usePlaybackState();

	// Sync playing state - wrapped in useEffect to avoid setState during render
	React.useEffect(() => {
		const state = useAudioStore.getState();
		if (state._isRestoringPlayback) return;

		if (playbackState?.state === State.Playing && !state.isPlaying) {
			state._setIsPlaying(true);
		} else if (playbackState?.state !== State.Playing && state.isPlaying) {
			state._setIsPlaying(false);
			if (state.currentSong?.source === 'podcast') {
				const usePlaybackProgressStore = getProgressStore();
				const { position, duration } = usePlaybackProgressStore.getState();
				savePodcastProgressImmediate(state.currentSong.id, position, duration);
			}
		}

		// Handle buffering
		if (playbackState?.state === State.Buffering && !state.isBuffering) {
			state._setIsBuffering(true);
		} else if (playbackState?.state !== State.Buffering && state.isBuffering) {
			state._setIsBuffering(false);
		}
	}, [playbackState?.state]);

	useTrackPlayerEvents(
		[
			Event.PlaybackProgressUpdated,
			Event.PlaybackQueueEnded,
			Event.PlaybackActiveTrackChanged,
			Event.PlaybackError,
			Event.RemotePlay,
			Event.RemotePause,
			Event.RemoteNext,
			Event.RemotePrevious,
			Event.RemoteSeek,
		],
		async (event) => {
			// Get fresh state for each event
			const state = useAudioStore.getState();

			if (event.type === Event.PlaybackProgressUpdated) {
				const position = event.position ?? 0;
				const duration = event.duration ?? 0;
				const usePlaybackProgressStore = getProgressStore();
				const progressStore = usePlaybackProgressStore.getState();
				progressStore.setPosition(position);
				progressStore.setDuration(duration);
				lastProgressTimestamp = Date.now();

				// Sleep timer: stop playback when time is up
				const { sleepTimerEndsAt } = useAudioStore.getState();
				if (sleepTimerEndsAt != null && Date.now() >= sleepTimerEndsAt) {
					await TrackPlayer.pause();
					useAudioStore.getState().setSleepTimer(null);
				}

				const remaining = duration - position;

				const pbs = getPlaybackSettingsStore().getState();
				if (
					pbs.crossfadeEnabled &&
					state.currentSong?.source !== 'podcast' &&
					state.repeatMode !== RepeatMode.Track &&
					duration > 0 &&
					remaining < 90
				) {
					const nextSong = getNextQueueSongForCrossfade(state.queue, state.currentSong, state.repeatMode);
					if (nextSong && state.currentSong) {
						const baseConfig = {
							defaultDuration: pbs.crossfadeDurationSec,
							minDuration: 1,
							maxDuration: 12,
						};
						const outLoudness = effectiveLoudnessData(state.currentSong);
						const inLoudness = effectiveLoudnessData(nextSong);
						const sec = pbs.crossfadeAdaptiveEnabled
							? computeCrossfadeDuration(outLoudness, inLoudness, baseConfig)
							: pbs.crossfadeDurationSec;
						// Gain-match the incoming track during the overlap (only when Adaptive is on, since it
						// relies on the same loudness metadata). Reset to 1 otherwise so a stale trim can't linger.
						const trim = pbs.crossfadeAdaptiveEnabled ? computeIncomingLoudnessTrim(outLoudness, inLoudness) : 1;
						const sig = `${state.currentSong.id}|${nextSong.id}|${sec.toFixed(2)}|${trim.toFixed(3)}`;
						if (sig !== lastCrossfadeSignature) {
							lastCrossfadeSignature = sig;
							TrackPlayer.setNextCrossfadeDuration(sec).catch(() => {});
							TrackPlayer.setNextCrossfadeTrim(trim).catch(() => {});
						}
					}
				}

				// Pre-fetch first 256KB of next track to warm OS HTTP cache
				if (remaining > 0 && remaining < 45 && state.queue.length > 1 && state.currentSong) {
					const currentIndex = state.queue.findIndex((s) => s.id === state.currentSong!.id);
					if (currentIndex !== -1) {
						const nextIndex = (currentIndex + 1) % state.queue.length;
						const nextSong = state.queue[nextIndex];
						if (nextSong && nextSong.id !== prewarmedSongId) {
							prewarmedSongId = nextSong.id;
							try {
								const track = songToTrack(nextSong);
								const { YhwavAudioModule } = require('@/modules/yhwav-audio/src');
								if (YhwavAudioModule?.prewarmURL) {
									YhwavAudioModule.prewarmURL(track.url, nextSong.id);
								} else {
									fetch(track.url, { headers: { Range: 'bytes=0-262143' } }).catch(() => {});
								}
							} catch {}
						}
					}
				}

				// Save podcast progress (debounced) so we can resume later
				if (state.currentSong?.source === 'podcast') {
					schedulePodcastProgressSave(state.currentSong.id, position, duration);
				}
			}

			if (event.type === Event.PlaybackQueueEnded) {
				if (state.currentSong?.source === 'podcast') {
					const usePlaybackProgressStore = getProgressStore();
					const prog = usePlaybackProgressStore.getState();
					const dur = prog.duration > 0 ? prog.duration : prog.position;
					savePodcastProgressImmediate(state.currentSong.id, dur, dur);
				}
				if (state.currentSong) scrobbleSong(state.currentSong);
				console.log('🎵 Queue ended, repeat mode:', state.repeatMode);
			}

			if (event.type === Event.PlaybackActiveTrackChanged) {
				// Use the event index + our Zustand queue — no native bridge calls needed
				const trackIndex = event.index;
				if (trackIndex == null || trackIndex < 0 || trackIndex >= state.queue.length) return;

				const newCurrentSong = state.queue[trackIndex];
				if (!newCurrentSong || newCurrentSong.id === state.currentSong?.id) return;

				const isNaturalAdvance = lastProgressTimestamp > 0 && Date.now() - lastUserSkipAt > SKIP_DEBOUNCE_MS;
				// Only update currentSong for natural advances. For user-initiated skips, playSound already
				// set currentSong optimistically. Stale events (e.g. a natural-advance KVO that queued on
				// the main thread just before the skip ran) would otherwise corrupt the display.
				if (!isNaturalAdvance) return;

				const previousSong = state.currentSong;
				const now = Date.now();
				const nativeGapMs = event.previousTrackEndedAt ? now - event.previousTrackEndedAt : null;
				const jsGapMs = now - lastProgressTimestamp;
				if (__DEV__) {
					const gapLabel = nativeGapMs != null ? `${nativeGapMs.toFixed(0)}ms native` : `${jsGapMs.toFixed(0)}ms js`;
					console.log(`🎵 Natural advance: ${previousSong?.id ?? '?'} → ${newCurrentSong.id} (${gapLabel})`);
				}
				if (previousSong) scrobbleSong(previousSong);

				// Reset pre-warm tracker for the new track
				prewarmedSongId = null;
				lastCrossfadeSignature = '';

				state._setCurrentSong(newCurrentSong);

				// Reset progress bar immediately so it doesn't flash the old track's position
				const progressStore = getProgressStore().getState();
				progressStore.setPosition(0);
				progressStore.setDuration(newCurrentSong.duration ?? 0);

				// Persist & extract color asynchronously
				saveCurrentSong(newCurrentSong);
				extractArtworkColor(newCurrentSong)
					.then((color) => useAudioStore.getState()._setArtworkBgColor(color))
					.catch(() => {});
			}

			if (event.type === Event.PlaybackError) {
				// TEMP DIAGNOSTIC: log the failing track's URL + probe the server response.
				// Remove once the playback-failure cause is identified.
				if (__DEV__ && state.currentSong) {
					try {
						const failingTrack = songToTrack(state.currentSong);
						console.warn(
							`🛑 PlaybackError: id=${state.currentSong.id} "${state.currentSong.title}" source=${state.currentSong.source ?? 'music'}`,
							(event as any)?.message ?? (event as any)?.code ?? event,
						);
						console.warn(`🛑 URL: ${failingTrack.url}`);
						if ((failingTrack as any).directUrl) console.warn(`🛑 directUrl: ${(failingTrack as any).directUrl}`);
						if (typeof failingTrack.url === 'string' && failingTrack.url.startsWith('http')) {
							fetch(failingTrack.url, { method: 'HEAD' })
								.then((res) => {
									console.warn(
										`🛑 HEAD ${res.status} ${res.statusText} · content-type=${res.headers.get('content-type')} · content-length=${res.headers.get('content-length')}`,
									);
								})
								.catch((e) => console.warn('🛑 HEAD probe failed:', e?.message ?? e));
						}
					} catch (e: any) {
						console.warn('🛑 PlaybackError diagnostic failed:', e?.message ?? e);
					}
				}

				// Only retry if we were actually playing — never auto-play from a paused/restored state.
				if (!state.isPlaying) return;

				const now = Date.now();
				const canRetry = now - lastErrorRetryAt > 3000;

				if (canRetry && state.currentSong && state.queue.length > 0) {
					lastErrorRetryAt = now;
					const trackIndex = state.queue.findIndex((s) => s.id === state.currentSong!.id);
					if (trackIndex !== -1) {
						try {
							await TrackPlayer.skip(trackIndex);
							await TrackPlayer.play();
							// console.log('✅ Retry succeeded');
						} catch {
							console.warn('Retry failed, keeping player state intact');
							useAudioStore.setState({ isPlaying: false });
						}
					}
				} else if (!canRetry) {
					console.warn('Playback error after recent retry, skipping to next');
					const trackIndex = state.queue.findIndex((s) => s.id === state.currentSong!.id);
					const nextIndex = trackIndex + 1;
					if (nextIndex < state.queue.length) {
						try {
							lastErrorRetryAt = now;
							const nextSong = state.queue[nextIndex];
							state._setCurrentSong(nextSong);
							await TrackPlayer.skip(nextIndex);
							await TrackPlayer.play();
							// console.log(`✅ Skipped failed track → ${nextSong.id}`);
						} catch {
							useAudioStore.setState({ isPlaying: false });
						}
					} else {
						useAudioStore.setState({ isPlaying: false });
					}
				}
			}

			if (event.type === Event.RemotePlay) {
				if (Date.now() - restoredPausedAt < RESTORE_REMOTE_PLAY_SUPPRESS_MS) return;
				await TrackPlayer.play();
			}

			if (event.type === Event.RemotePause) {
				await TrackPlayer.pause();
			}

			if (event.type === Event.RemoteNext) {
				lastUserSkipAt = Date.now();
				await state.skipToNext();
			}

			if (event.type === Event.RemotePrevious) {
				lastUserSkipAt = Date.now();
				await state.skipToPrevious();
			}

			if (event.type === Event.RemoteSeek) {
				await state.seekTo(event.position ?? 0);
			}
		},
	);
}
