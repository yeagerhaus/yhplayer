import { InteractionManager } from 'react-native';
import { getIsOfflineMode } from '@/hooks/useOfflineModeStore';
import { storage } from '@/lib/storage';
import type { Album, Artist, HomeHub, Playlist, Song } from '@/types';

let useLibraryStore: any;
try {
	useLibraryStore = require('@/hooks/useLibraryStore').useLibraryStore;
} catch {}

const CACHE_TRACKS = 'CACHE_TRACKS';
const CACHE_ALBUMS = 'CACHE_ALBUMS';
const CACHE_ARTISTS = 'CACHE_ARTISTS';
const CACHE_PLAYLISTS = 'CACHE_PLAYLISTS';
const CACHE_RECENTLY_PLAYED = 'CACHE_RECENTLY_PLAYED';
const CACHE_HUBS = 'CACHE_HUBS';
const CACHE_LAST_FETCHED = 'CACHE_LAST_FETCHED';
const LEGACY_LIBRARY_KEY = 'LIBRARY_STATE';

interface LibraryCachePayload {
	tracks: Song[];
	albums: Album[];
	artists: Artist[];
	playlists: Playlist[];
	recentlyPlayed: Song[];
	hubs: HomeHub[];
	lastFetchedAt?: number;
}

function getStore() {
	if (!useLibraryStore) {
		useLibraryStore = require('@/hooks/useLibraryStore').useLibraryStore;
	}
	return useLibraryStore;
}

export function saveLibraryToCache() {
	try {
		const state = getStore().getState();
		storage.set(CACHE_TRACKS, JSON.stringify(state.tracks));
		storage.set(CACHE_ALBUMS, JSON.stringify(state.albums));
		storage.set(CACHE_ARTISTS, JSON.stringify(state.artists));
		storage.set(CACHE_PLAYLISTS, JSON.stringify(state.playlists));
		storage.set(CACHE_RECENTLY_PLAYED, JSON.stringify(state.recentlyPlayed));
		storage.set(CACHE_HUBS, JSON.stringify(state.hubs));
		storage.set(CACHE_LAST_FETCHED, String(Date.now()));
	} catch (err) {
		console.error('Failed to save library state:', err);
	}
}

export function loadLibraryFromCache(): LibraryCachePayload | null {
	try {
		const tracksRaw = storage.getString(CACHE_TRACKS);

		if (tracksRaw) {
			const tracks = JSON.parse(tracksRaw);
			if (Array.isArray(tracks)) {
				const albumsRaw = storage.getString(CACHE_ALBUMS);
				const artistsRaw = storage.getString(CACHE_ARTISTS);
				const playlistsRaw = storage.getString(CACHE_PLAYLISTS);
				const recentlyPlayedRaw = storage.getString(CACHE_RECENTLY_PLAYED);
				const hubsRaw = storage.getString(CACHE_HUBS);
				const lastFetchedRaw = storage.getString(CACHE_LAST_FETCHED);
				return {
					tracks,
					albums: albumsRaw ? JSON.parse(albumsRaw) : [],
					artists: artistsRaw ? JSON.parse(artistsRaw) : [],
					playlists: playlistsRaw ? JSON.parse(playlistsRaw) : [],
					recentlyPlayed: recentlyPlayedRaw ? JSON.parse(recentlyPlayedRaw) : [],
					hubs: hubsRaw ? JSON.parse(hubsRaw) : [],
					lastFetchedAt: lastFetchedRaw ? Number(lastFetchedRaw) : undefined,
				};
			}
		}

		// Migrate from legacy single-key format (AsyncStorage or old MMKV)
		const legacyRaw = storage.getString(LEGACY_LIBRARY_KEY);
		if (legacyRaw) {
			const parsed = JSON.parse(legacyRaw);
			storage.remove(LEGACY_LIBRARY_KEY);

			if (parsed?.tracks && Array.isArray(parsed.tracks)) {
				const payload: LibraryCachePayload = {
					tracks: parsed.tracks,
					albums: Array.isArray(parsed.albums) ? parsed.albums : [],
					artists: Array.isArray(parsed.artists) ? parsed.artists : [],
					playlists: Array.isArray(parsed.playlists) ? parsed.playlists : [],
					recentlyPlayed: Array.isArray(parsed.recentlyPlayed) ? parsed.recentlyPlayed : [],
					hubs: Array.isArray(parsed.hubs) ? parsed.hubs : [],
					lastFetchedAt: parsed.lastFetchedAt,
				};
				// Re-save in split format
				storage.set(CACHE_TRACKS, JSON.stringify(payload.tracks));
				storage.set(CACHE_ALBUMS, JSON.stringify(payload.albums));
				storage.set(CACHE_ARTISTS, JSON.stringify(payload.artists));
				storage.set(CACHE_PLAYLISTS, JSON.stringify(payload.playlists));
				storage.set(CACHE_RECENTLY_PLAYED, JSON.stringify(payload.recentlyPlayed));
				return payload;
			}

			if (Array.isArray(parsed)) {
				const payload: LibraryCachePayload = {
					tracks: parsed,
					albums: [],
					artists: [],
					playlists: [],
					recentlyPlayed: [],
					hubs: [],
				};
				storage.set(CACHE_TRACKS, JSON.stringify(parsed));
				return payload;
			}
		}

		return null;
	} catch (err) {
		console.error('Failed to load library state from cache:', err);
		return null;
	}
}

export function rehydrateLibraryStore(): boolean {
	const cached = loadLibraryFromCache();

	if (!cached || cached.tracks.length === 0) {
		return false;
	}

	const store = getStore();

	const songsById: Record<string, Song> = {};
	for (const song of cached.tracks) {
		if (!song?.id) continue;
		if (!song.titleLower) song.titleLower = song.title.toLowerCase();
		if (!song.artistLower) song.artistLower = song.artist.toLowerCase();
		if (!song.albumLower) song.albumLower = song.album.toLowerCase();
		songsById[song.id] = song;
	}

	const albumsById: Record<string, Album> = {};
	for (const album of cached.albums) {
		if (album?.id) albumsById[album.id] = album;
	}

	const artistsById: Record<string, Artist> = {};
	for (const artist of cached.artists) {
		if (artist?.key) artistsById[artist.key] = artist;
	}

	const playlistsById: Record<string, Playlist> = {};
	for (const playlist of cached.playlists) {
		if (playlist?.id) playlistsById[playlist.id] = playlist;
	}

	store.setState({
		tracks: cached.tracks,
		songsById,
		albums: cached.albums,
		albumsById,
		artists: cached.artists,
		artistsById,
		playlists: cached.playlists,
		playlistsById,
		recentlyPlayed: cached.recentlyPlayed,
		hubs: cached.hubs ?? [],
	});

	return true;
}

export function clearLibraryCache() {
	try {
		storage.remove(CACHE_TRACKS);
		storage.remove(CACHE_ALBUMS);
		storage.remove(CACHE_ARTISTS);
		storage.remove(CACHE_PLAYLISTS);
		storage.remove(CACHE_RECENTLY_PLAYED);
		storage.remove(CACHE_HUBS);
		storage.remove(CACHE_LAST_FETCHED);
	} catch (err) {
		console.error('Failed to clear library cache:', err);
	}
}

/**
 * Fetch fresh library data from the server, then atomically replace the store
 * and persisted cache. Keeps old data visible until the new data arrives.
 * Returns the number of tracks fetched, or 0 on failure.
 */
export async function clearCacheAndReload(): Promise<number> {
	if (getIsOfflineMode()) {
		return 0;
	}
	const {
		fetchAllTracks,
		fetchAllAlbums,
		fetchAllArtists,
		fetchAllPlaylists,
		fetchRecentlyPlayed,
		fetchSectionHubs,
	} = require('@/utils/plex');
	const store = getStore();

	try {
		const [tracks, albums, artists, playlists, recentlyPlayed, hubs] = await Promise.all([
			fetchAllTracks(),
			fetchAllAlbums(),
			fetchAllArtists(),
			fetchAllPlaylists(),
			fetchRecentlyPlayed(15),
			fetchSectionHubs().catch(() => []),
		]);

		const state = store.getState();
		if (tracks.length > 0) state.setTracks(tracks);
		if (albums.length > 0) state.setAlbums(albums);
		if (artists.length > 0) state.setArtists(artists);
		if (playlists.length > 0) state.setPlaylists(playlists);
		if (recentlyPlayed.length > 0) state.setRecentlyPlayed(recentlyPlayed);
		if (hubs.length > 0) state.setHubs(hubs);

		InteractionManager.runAfterInteractions(() => {
			saveLibraryToCache();
		});

		return tracks.length;
	} catch (err) {
		console.error('Failed to reload library:', err);
		return 0;
	}
}
