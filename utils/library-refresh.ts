import { InteractionManager } from 'react-native';
import { useLibraryStore } from '@/hooks/useLibraryStore';
import { useOfflineModeStore } from '@/hooks/useOfflineModeStore';
import { saveLibraryToCache } from '@/utils/cache';
import { fetchAllAlbums, fetchAllArtists, fetchAllPlaylists, fetchAllTracks, fetchRecentlyPlayed, fetchSectionHubs } from '@/utils/plex';

let refreshPromise: Promise<void> | null = null;
let lastRefreshedAt = 0;

const THROTTLE_MS = 60_000;

async function doRefresh() {
	const { setTracks, setAlbums, setArtists, setPlaylists, setRecentlyPlayed, setHubs } = useLibraryStore.getState();

	const [tracks, albums, artists, playlists, recentlyPlayedSongs, hubs] = await Promise.all([
		fetchAllTracks(),
		fetchAllAlbums(),
		fetchAllArtists(),
		fetchAllPlaylists(),
		fetchRecentlyPlayed(15),
		fetchSectionHubs().catch(() => []),
	]);

	if (tracks.length > 0) setTracks(tracks);
	if (albums.length > 0) setAlbums(albums);
	if (artists.length > 0) setArtists(artists);
	if (playlists.length > 0) setPlaylists(playlists);
	if (recentlyPlayedSongs.length > 0) setRecentlyPlayed(recentlyPlayedSongs);
	if (hubs.length > 0) setHubs(hubs);

	lastRefreshedAt = Date.now();

	InteractionManager.runAfterInteractions(() => {
		saveLibraryToCache();
	});
}

export async function refreshLibrary(opts?: { force?: boolean }): Promise<void> {
	if (useOfflineModeStore.getState().offlineMode) return;
	if (refreshPromise) return refreshPromise;
	if (!opts?.force && Date.now() - lastRefreshedAt < THROTTLE_MS) return;

	refreshPromise = doRefresh();
	try {
		await refreshPromise;
	} finally {
		refreshPromise = null;
	}
}
