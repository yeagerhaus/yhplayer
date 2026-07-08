import { router } from 'expo-router';
import { useMemo } from 'react';
import { useAudioStore } from '@/hooks/useAudioStore';
import { useLibraryStore } from '@/hooks/useLibraryStore';
import { useOfflineFilteredLibrary } from '@/hooks/useOfflineFilteredLibrary';
import { usePodcastDownloadsStore } from '@/hooks/usePodcastDownloadsStore';
import { usePodcastProgressStore } from '@/hooks/usePodcastProgressStore';
import type { Album, HomeFeedItem, HomeFeedKind, HomeHub, Playlist, Song } from '@/types';
import { toPlayableSong } from '@/types/podcast';
import { fetchPlaylistTracks } from '@/utils/plex';

const HALF_LIFE_MS = 48 * 60 * 60 * 1000; // 2 days
const MAX_ITEMS = 12;
/** Podcasts/tracks below this many seconds in aren't worth a "continue" card. */
const MIN_RESUME_SECONDS = 30;
/** Keep suggestions/recently-added from crowding out real history. */
const SUGGESTION_CAP_RATIO = 0.5;

const KIND_WEIGHT: Record<HomeFeedKind, number> = {
	'continue-podcast': 1.0,
	'continue-track': 1.0,
	'continue-playlist': 1.0,
	mix: 0.8,
	station: 0.6,
	suggestion: 0.5,
	'recently-added': 0.4,
};

const SOFT_KINDS = new Set<HomeFeedKind>(['suggestion', 'recently-added']);

/** Exponential recency decay with a 2-day half-life. `at` in ms; undefined = fresh. */
function recencyWeight(at?: number): number {
	if (at == null) return 1;
	const ageMs = Math.max(0, Date.now() - at);
	return Math.exp((-Math.LN2 * ageMs) / HALF_LIFE_MS);
}

function score(kind: HomeFeedKind, at?: number): number {
	return KIND_WEIGHT[kind] * recencyWeight(at);
}

/** Play an album by resolving its tracks from the library; navigate as a fallback. */
function playAlbum(album: Album, tracks: Song[], playSound: ReturnType<typeof useAudioStore.getState>['playSound']) {
	const albumTracks = tracks
		.filter((t) => t.albumId === album.id)
		.sort((a, b) => a.discNumber - b.discNumber || a.trackNumber - b.trackNumber);
	if (albumTracks.length > 0) {
		playSound(albumTracks[0], albumTracks);
	} else {
		router.push({ pathname: '/(tabs)/(library)/(albums)/[albumId]', params: { albumId: album.id } });
	}
}

/** Resolve and play a Plex playlist/mix/station from its `key`, starting at `startId` when present. */
async function playPlaylistKey(
	pl: Playlist,
	startId: string | undefined,
	playSound: ReturnType<typeof useAudioStore.getState>['playSound'],
) {
	const key = pl.key ?? pl.ratingKey;
	if (!key) return;
	const tracks = await fetchPlaylistTracks(key);
	if (tracks.length === 0) return;
	const start = (startId && tracks.find((t) => t.id === startId)) || tracks[0];
	playSound(start, tracks, { playlistRatingKey: pl.ratingKey });
}

/** Classify a hub into a feed kind + eyebrow label from its identifier/title. */
function classifyHub(hub: HomeHub): { kind: HomeFeedKind; eyebrow: string } {
	const id = (hub.identifier || '').toLowerCase();
	const title = (hub.title || '').toLowerCase();
	const eyebrow = hub.title ? hub.title.toUpperCase() : 'FOR YOU';
	if (id.includes('station') || title.includes('station') || title.includes('radio')) {
		return { kind: 'station', eyebrow };
	}
	if (id.includes('mix') || title.includes('mix')) {
		return { kind: 'mix', eyebrow };
	}
	if (id.includes('recentlyadded') || title.includes('recently added')) {
		return { kind: 'recently-added', eyebrow: hub.title ? eyebrow : 'RECENTLY ADDED' };
	}
	return { kind: 'suggestion', eyebrow };
}

/**
 * Builds the ranked "For You" feed: a blend of continue-listening (last music
 * queue + in-progress podcasts), Plex smart hubs (Mixes For You, stations), and
 * recently-added fallback. First item is intended for the hero; the rest feed the
 * carousel. Fully cold-start capable (no history required).
 */
export function useHomeFeed(): HomeFeedItem[] {
	const currentSong = useAudioStore((s) => s.currentSong);
	const currentPlaylistRatingKey = useAudioStore((s) => s.currentPlaylistRatingKey);
	const playSound = useAudioStore((s) => s.playSound);

	const hubs = useLibraryStore((s) => s.hubs);
	const playlistsById = useLibraryStore((s) => s.playlistsById);

	const progressByEpisodeId = usePodcastProgressStore((s) => s.progressByEpisodeId);
	const downloads = usePodcastDownloadsStore((s) => s.downloads);

	const { tracks, albums, playlists } = useOfflineFilteredLibrary();

	return useMemo(() => {
		const items: HomeFeedItem[] = [];
		const seen = new Set<string>();

		const add = (item: HomeFeedItem, dedupeKey: string) => {
			if (seen.has(dedupeKey)) return;
			seen.add(dedupeKey);
			items.push(item);
		};

		// 1. Continue — current podcast (resume mid-episode).
		if (currentSong?.source === 'podcast') {
			const prog = progressByEpisodeId[currentSong.id];
			if (!prog?.completed) {
				const duration = prog?.duration || currentSong.duration || 0;
				add(
					{
						id: `continue-podcast-${currentSong.id}`,
						kind: 'continue-podcast',
						eyebrow: 'CONTINUE LISTENING',
						title: currentSong.title,
						subtitle: currentSong.artist,
						artwork: currentSong.artworkUrl || currentSong.artwork || '',
						progress: duration > 0 && prog ? Math.min(1, prog.position / duration) : undefined,
						score: score('continue-podcast', prog?.updatedAt),
						play: () => playSound(currentSong, [currentSong]),
					},
					`episode:${currentSong.id}`,
				);
			}
		}

		// 2. Continue — other in-progress downloaded podcast episodes.
		for (const dl of Object.values(downloads)) {
			const prog = progressByEpisodeId[dl.episodeId];
			if (!prog || prog.completed || prog.position < MIN_RESUME_SECONDS) continue;
			if (seen.has(`episode:${dl.episodeId}`)) continue;
			const song = toPlayableSong(dl, dl.showTitle, dl.imageUrl, dl.localUri);
			const duration = prog.duration || dl.durationSeconds || 0;
			add(
				{
					id: `continue-podcast-${dl.episodeId}`,
					kind: 'continue-podcast',
					eyebrow: 'CONTINUE LISTENING',
					title: dl.title,
					subtitle: dl.showTitle,
					artwork: dl.imageUrl || '',
					progress: duration > 0 ? Math.min(1, prog.position / duration) : undefined,
					score: score('continue-podcast', prog.updatedAt),
					play: () => playSound(song, [song]),
				},
				`episode:${dl.episodeId}`,
			);
		}

		// 3. Continue — last-played music (restart the album/playlist from that track's top).
		if (currentSong && currentSong.source !== 'podcast') {
			const contextPlaylist = currentPlaylistRatingKey ? playlistsById[currentPlaylistRatingKey] : undefined;
			if (contextPlaylist) {
				add(
					{
						id: `continue-playlist-${contextPlaylist.id}`,
						kind: 'continue-playlist',
						eyebrow: 'CONTINUE LISTENING',
						title: contextPlaylist.title,
						subtitle: `${contextPlaylist.leafCount ?? 0} songs`,
						artwork: contextPlaylist.artworkUrl || '',
						score: score('continue-playlist'),
						play: () => {
							const { originalQueue } = useAudioStore.getState();
							if (originalQueue.length > 0) {
								const start = originalQueue.find((s) => s.id === currentSong.id) ?? originalQueue[0];
								playSound(start, originalQueue, { playlistRatingKey: contextPlaylist.ratingKey });
							} else {
								playPlaylistKey(contextPlaylist, currentSong.id, playSound);
							}
						},
					},
					`playlist:${contextPlaylist.id}`,
				);
			} else {
				add(
					{
						id: `continue-track-${currentSong.id}`,
						kind: 'continue-track',
						eyebrow: 'CONTINUE LISTENING',
						title: currentSong.album || currentSong.title,
						subtitle: currentSong.artist,
						artwork: currentSong.artworkUrl || currentSong.artwork || '',
						score: score('continue-track'),
						play: () => {
							const { originalQueue } = useAudioStore.getState();
							const queue = originalQueue.length > 0 ? originalQueue : [currentSong];
							const start = queue.find((s) => s.id === currentSong.id) ?? currentSong;
							playSound(start, queue);
						},
					},
					currentSong.albumId ? `album:${currentSong.albumId}` : `track:${currentSong.id}`,
				);
			}
		}

		// 4. Plex smart hubs — mixes, stations, suggestions, recently added.
		for (const hub of hubs) {
			const { kind, eyebrow } = classifyHub(hub);

			for (const pl of hub.playlists) {
				add(
					{
						id: `hub-playlist-${hub.id}-${pl.id}`,
						kind,
						eyebrow,
						title: pl.title,
						subtitle: kind === 'station' ? 'Radio' : `${pl.leafCount ?? 0} songs`,
						artwork: pl.artworkUrl || '',
						score: score(kind),
						play: () => playPlaylistKey(pl, undefined, playSound),
					},
					`playlist:${pl.id}`,
				);
			}

			for (const album of hub.albums) {
				add(
					{
						id: `hub-album-${hub.id}-${album.id}`,
						kind: 'recently-added',
						eyebrow: kind === 'recently-added' ? eyebrow : 'RECENTLY ADDED',
						title: album.title,
						subtitle: album.artist,
						artwork: album.artwork || album.thumb || '',
						score: score('recently-added', album.addedAt != null ? album.addedAt * 1000 : undefined),
						play: () => playAlbum(album, tracks, playSound),
					},
					`album:${album.id}`,
				);
			}
		}

		// 5. Fallback filler (older servers with no hubs / thin feed): recently added + playlists.
		if (items.length < MAX_ITEMS) {
			const recentAlbums = [...albums]
				.filter((a) => a.addedAt != null)
				.sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0))
				.slice(0, MAX_ITEMS);
			for (const album of recentAlbums) {
				add(
					{
						id: `fallback-album-${album.id}`,
						kind: 'recently-added',
						eyebrow: 'RECENTLY ADDED',
						title: album.title,
						subtitle: album.artist,
						artwork: album.artwork || album.thumb || '',
						score: score('recently-added', album.addedAt != null ? album.addedAt * 1000 : undefined),
						play: () => playAlbum(album, tracks, playSound),
					},
					`album:${album.id}`,
				);
			}

			const recentPlaylists = [...playlists]
				.filter((p) => p.playlistType === 'audio' && p.artworkUrl != null)
				.sort((a, b) => (b.lastViewedAt ?? 0) - (a.lastViewedAt ?? 0))
				.slice(0, MAX_ITEMS);
			for (const pl of recentPlaylists) {
				add(
					{
						id: `fallback-playlist-${pl.id}`,
						kind: 'suggestion',
						eyebrow: 'PLAYLIST',
						title: pl.title,
						subtitle: `${pl.leafCount ?? 0} songs`,
						artwork: pl.artworkUrl || '',
						score: score('suggestion', pl.lastViewedAt),
						play: () => playPlaylistKey(pl, undefined, playSound),
					},
					`playlist:${pl.id}`,
				);
			}
		}

		// Rank by score (desc), then apply a soft cap so suggestions don't dominate.
		items.sort((a, b) => b.score - a.score);

		const softCap = Math.ceil(MAX_ITEMS * SUGGESTION_CAP_RATIO);
		const result: HomeFeedItem[] = [];
		let softCount = 0;
		for (const item of items) {
			if (SOFT_KINDS.has(item.kind)) {
				if (softCount >= softCap) continue;
				softCount++;
			}
			result.push(item);
			if (result.length >= MAX_ITEMS) break;
		}

		return result;
	}, [currentSong, currentPlaylistRatingKey, playSound, hubs, playlistsById, progressByEpisodeId, downloads, tracks, albums, playlists]);
}
