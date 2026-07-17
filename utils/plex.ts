// Re-export everything from the new robust Plex client

export type { PlexError, PlexResponse } from './plex-client';
export {
	addToPlaylist,
	buildPlexURL,
	createPlaylist,
	deletePlaylist,
	fetchAllAlbums,
	fetchAllArtists,
	fetchAllPlaylists,
	fetchAllTracks,
	fetchArtistRadioPlaylist,
	fetchArtistRadioTracks,
	fetchPlaylist,
	fetchPlaylistTracks,
	fetchRecentlyPlayed,
	fetchSectionHubs,
	fetchUltraBlurColors,
	movePlaylistItem,
	plexClient,
	removeFromPlaylist,
	scrobble,
	testPlexServer,
	updatePlaylistMetadata,
} from './plex-client';
