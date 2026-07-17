import { create } from 'zustand';
import type { Album, Artist, HomeHub, Playlist, Song } from '@/types';
import { performanceMonitor } from '@/utils/performance';

interface LibraryState {
	tracks: Song[];
	songsById: Record<string, Song>;
	albums: Album[];
	albumsById: Record<string, Album>;
	artists: Artist[];
	artistsById: Record<string, Artist>;
	playlists: Playlist[];
	playlistsById: Record<string, Playlist>;
	recentlyPlayed: Song[];
	hubs: HomeHub[];
	hasInitialized: boolean;
	setTracks: (songs: Song[]) => void;
	setAlbums: (albums: Album[]) => void;
	setArtists: (artists: Artist[]) => void;
	setPlaylists: (playlists: Playlist[]) => void;
	setRecentlyPlayed: (songs: Song[]) => void;
	setHubs: (hubs: HomeHub[]) => void;
	setHasInitialized: (value: boolean) => void;
}

export const useLibraryStore = create<LibraryState>((set) => ({
	tracks: [],
	songsById: {},
	albums: [],
	albumsById: {},
	artists: [],
	artistsById: {},
	playlists: [],
	playlistsById: {},
	recentlyPlayed: [],
	hubs: [],
	hasInitialized: false,

	setHasInitialized: (value: boolean) => set({ hasInitialized: value }),
	setRecentlyPlayed: (songs: Song[]) => set({ recentlyPlayed: songs }),
	setHubs: (hubs: HomeHub[]) => set({ hubs }),

	setAlbums: (albums: Album[]) => {
		const albumsById: Record<string, Album> = {};
		for (const album of albums) {
			if (album?.id) {
				albumsById[album.id] = album;
			}
		}
		set({ albums, albumsById });
		if (__DEV__) console.log(`Library indexed: ${albums.length} albums`);
	},

	setArtists: (artists: Artist[]) => {
		const artistsById: Record<string, Artist> = {};
		for (const artist of artists) {
			if (artist?.key) {
				artistsById[artist.key] = artist;
			}
		}
		set({ artists, artistsById });
		if (__DEV__) console.log(`Library indexed: ${artists.length} artists`);
	},

	setPlaylists: (playlists: Playlist[]) => {
		const playlistsById: Record<string, Playlist> = {};

		playlists.forEach((playlist) => {
			playlistsById[playlist.id] = playlist;
		});

		set({
			playlists,
			playlistsById,
		});
	},

	setTracks: (songs: Song[]) => {
		if (songs.length === 0) {
			set({ tracks: [], songsById: {} });
			return;
		}

		const endTimer = performanceMonitor.startTimer('library-indexing');

		const songsById: Record<string, Song> = {};
		for (const song of songs) {
			if (song?.id) {
				songsById[song.id] = song;
			}
		}

		set({ tracks: songs, songsById });
		endTimer({ trackCount: songs.length });
		if (__DEV__) console.log(`Library indexed: ${songs.length} tracks`);
	},
}));
