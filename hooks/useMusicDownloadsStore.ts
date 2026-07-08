import * as FileSystem from 'expo-file-system/legacy';
import { create } from 'zustand';
import { storage } from '@/lib/storage';
import type { Album } from '@/types/album';
import type { Artist } from '@/types/artist';
import type { Playlist } from '@/types/playlist';
import type { LoudnessData, Song } from '@/types/song';
import { buildPlexStreamUrl } from '@/utils/plex-stream-url';

const STORAGE_KEY = 'MUSIC_DOWNLOADS';
const PLAYLISTS_STORAGE_KEY = 'MUSIC_DOWNLOAD_PLAYLISTS';
const ARTISTS_STORAGE_KEY = 'MUSIC_DOWNLOAD_ARTISTS';
const ALBUMS_STORAGE_KEY = 'MUSIC_DOWNLOAD_ALBUMS';

function safeSegment(id: string): string {
	return encodeURIComponent(id).replace(/%/g, '_').slice(0, 120);
}

function extensionFromUrl(url: string): string {
	try {
		const path = new URL(url).pathname;
		const ext = path.slice(path.lastIndexOf('.'));
		if (['.mp3', '.m4a', '.aac', '.ogg', '.wav', '.flac', '.alac'].includes(ext.toLowerCase())) return ext;
	} catch {}
	return '.mp3';
}

export interface MusicDownload {
	songId: string;
	localUri: string;
	title: string;
	artist: string;
	album: string;
	albumId?: string;
	artistKey?: string;
	artworkUrl?: string;
	downloadedAt: number;
	/** Snapshotted at download time for adaptive crossfade when offline or library lacks stream metadata. */
	loudnessData?: LoudnessData;
}

export interface DownloadedPlaylist {
	id: string;
	key: string;
	ratingKey: string;
	title: string;
	summary?: string;
	artworkUrl?: string;
	playlistType: 'audio' | 'video' | 'photo';
	leafCount?: number;
	songs: Song[];
	downloadedAt: number;
}

interface QueueProgress {
	completed: number;
	total: number;
}

interface MusicDownloadsState {
	downloads: Record<string, MusicDownload>;
	downloadedPlaylists: Record<string, DownloadedPlaylist>;
	downloadedArtists: Record<string, Artist>;
	downloadedAlbums: Record<string, Album>;
	downloading: Set<string>;
	queue: Song[];
	queueTotal: number;
	queueCompleted: number;
	hydrated: boolean;

	hydrate: () => void;
	downloadTrack: (song: Song) => void;
	downloadTracks: (songs: Song[]) => void;
	removeDownload: (songId: string) => Promise<void>;
	removeDownloads: (songIds: string[]) => Promise<void>;
	cancelQueue: () => void;
	isDownloaded: (songId: string) => boolean;
	isDownloading: (songId: string) => boolean;
	isQueued: (songId: string) => boolean;
	getLocalUri: (songId: string) => string | undefined;
	getQueueProgress: () => QueueProgress;

	savePlaylistForOffline: (playlist: Playlist, songs: Song[]) => Promise<void>;
	removePlaylistForOffline: (playlistKey: string) => Promise<void>;
	getOfflinePlaylist: (playlistKey: string) => DownloadedPlaylist | undefined;

	saveArtistForOffline: (artist: Artist) => Promise<void>;
	saveAlbumForOffline: (album: Album) => Promise<void>;
	snapshotMetadataForSongs: (songs: Song[]) => Promise<void>;
	removeAllDownloads: () => Promise<void>;
}

/** Number of tracks downloaded in parallel. Kept modest to avoid overwhelming the Plex server. */
const MAX_CONCURRENT_MUSIC_DOWNLOADS = 4;
/** Retries per track. Concurrent Plex transcodes can transiently fail under load; a short backoff recovers them. */
const MAX_DOWNLOAD_RETRIES = 2;
let activeMusicWorkers = 0;

function persistDownloads(downloads: Record<string, MusicDownload>) {
	storage.set(STORAGE_KEY, JSON.stringify(Object.values(downloads)));
}

function persistPlaylists(playlists: Record<string, DownloadedPlaylist>) {
	storage.set(PLAYLISTS_STORAGE_KEY, JSON.stringify(Object.values(playlists)));
}

function persistArtists(artists: Record<string, Artist>) {
	storage.set(ARTISTS_STORAGE_KEY, JSON.stringify(Object.values(artists)));
}

function persistAlbums(albums: Record<string, Album>) {
	storage.set(ALBUMS_STORAGE_KEY, JSON.stringify(Object.values(albums)));
}

type StoreGet = () => MusicDownloadsState;
type StoreSet = (partial: Partial<MusicDownloadsState> | ((s: MusicDownloadsState) => Partial<MusicDownloadsState>)) => void;

/** Download a single already-dequeued song and update the store accounting (success or failure). */
async function downloadQueuedSong(song: Song, get: StoreGet, set: StoreSet): Promise<void> {
	if (get().downloads[song.id]) {
		set((s) => ({ queueCompleted: s.queueCompleted + 1 }));
		return;
	}

	set((s) => ({ downloading: new Set(s.downloading).add(song.id) }));

	const dir = `${FileSystem.documentDirectory ?? ''}music`;
	const ext = extensionFromUrl(song.uri || song.streamUrl || '');
	const filename = `${safeSegment(song.id)}${ext}`;
	const localPath = `${dir}/${filename}`;

	const finishFailure = () => {
		set((s) => {
			const d = new Set(s.downloading);
			d.delete(song.id);
			return { downloading: d, queueCompleted: s.queueCompleted + 1 };
		});
	};

	for (let attempt = 0; attempt <= MAX_DOWNLOAD_RETRIES; attempt++) {
		try {
			if (attempt > 0) {
				// Backoff lets in-flight sibling downloads finish and the server recover before retrying.
				await new Promise((resolve) => setTimeout(resolve, 600 * attempt));
			}
			await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
			const sourceUrl = song.uri || song.streamUrl || '';
			// Always download the original file (no server-side transcode). Plex's universal transcoder
			// is CPU-bound and single-session, so running several transcodes in parallel overwhelmed the
			// server (truncated files / NSURLError -1017). Original files are static, so many download
			// reliably in parallel. The download-quality setting is hidden while this holds.
			const { url: downloadUrl } = buildPlexStreamUrl(song, sourceUrl, null);
			const downloadResumable = FileSystem.createDownloadResumable(downloadUrl, localPath, {
				sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
			});
			const result = await downloadResumable.downloadAsync();
			if (!result?.uri) throw new Error('Download returned no URI');

			const entry: MusicDownload = {
				songId: song.id,
				localUri: result.uri,
				title: song.title,
				artist: song.artist,
				album: song.album,
				artistKey: song.artistKey,
				artworkUrl: song.artworkUrl,
				downloadedAt: Date.now(),
				...(song.loudnessData ? { loudnessData: song.loudnessData } : {}),
			};

			set((s) => {
				const d = new Set(s.downloading);
				d.delete(song.id);
				return { downloads: { ...s.downloads, [song.id]: entry }, downloading: d, queueCompleted: s.queueCompleted + 1 };
			});
			persistDownloads(get().downloads);
			return;
		} catch (err) {
			if (attempt === MAX_DOWNLOAD_RETRIES) {
				console.warn(`Music download failed for ${song.title} after ${attempt + 1} attempts:`, err);
				finishFailure();
				return;
			}
			console.warn(`Music download retry ${attempt + 1}/${MAX_DOWNLOAD_RETRIES} for ${song.title}:`, err);
		}
	}
}

/** A single worker: atomically dequeues one song at a time and downloads it until the queue drains. */
async function musicDownloadWorker(get: StoreGet, set: StoreSet): Promise<void> {
	try {
		while (true) {
			const { queue } = get();
			if (queue.length === 0) break;
			// Dequeue synchronously (no await between read and write) so concurrent workers never
			// grab the same item.
			const song = queue[0];
			set({ queue: queue.slice(1) });
			await downloadQueuedSong(song, get, set);
		}
	} finally {
		activeMusicWorkers--;
		if (activeMusicWorkers === 0) {
			set({ queueTotal: 0, queueCompleted: 0 });
		}
	}
}

/** Spin up workers (up to the concurrency cap) to drain the queue in parallel. */
function processQueue(get: StoreGet, set: StoreSet) {
	while (activeMusicWorkers < MAX_CONCURRENT_MUSIC_DOWNLOADS && get().queue.length > 0) {
		activeMusicWorkers++;
		void musicDownloadWorker(get, set);
	}
}

export const useMusicDownloadsStore = create<MusicDownloadsState>((set, get) => ({
	downloads: {},
	downloadedPlaylists: {},
	downloadedArtists: {},
	downloadedAlbums: {},
	downloading: new Set(),
	queue: [],
	queueTotal: 0,
	queueCompleted: 0,
	hydrated: false,

	hydrate: () => {
		try {
			const rawDownloads = storage.getString(STORAGE_KEY);
			const rawPlaylists = storage.getString(PLAYLISTS_STORAGE_KEY);
			const rawArtists = storage.getString(ARTISTS_STORAGE_KEY);
			const rawAlbums = storage.getString(ALBUMS_STORAGE_KEY);

			const downloads: Record<string, MusicDownload> = {};
			if (rawDownloads) {
				const list: MusicDownload[] = JSON.parse(rawDownloads);
				for (const d of list) downloads[d.songId] = d;
			}

			const downloadedPlaylists: Record<string, DownloadedPlaylist> = {};
			if (rawPlaylists) {
				const list: DownloadedPlaylist[] = JSON.parse(rawPlaylists);
				for (const p of list) downloadedPlaylists[p.key] = p;
			}

			const downloadedArtists: Record<string, Artist> = {};
			if (rawArtists) {
				const list: Artist[] = JSON.parse(rawArtists);
				for (const a of list) downloadedArtists[a.key] = a;
			}

			const downloadedAlbums: Record<string, Album> = {};
			if (rawAlbums) {
				const list: Album[] = JSON.parse(rawAlbums);
				for (const a of list) downloadedAlbums[a.id] = a;
			}

			set({ downloads, downloadedPlaylists, downloadedArtists, downloadedAlbums, hydrated: true });
		} catch {
			set({ hydrated: true });
		}
	},

	downloadTrack: (song: Song) => {
		const { downloads, downloading, queue } = get();
		if (downloads[song.id] || downloading.has(song.id) || queue.some((s) => s.id === song.id)) return;
		set((s) => ({
			queue: [...s.queue, song],
			queueTotal: s.queueTotal + 1,
		}));
		get().snapshotMetadataForSongs([song]);
		processQueue(get, set);
	},

	downloadTracks: (songs: Song[]) => {
		const { downloads, downloading, queue } = get();
		const queueIds = new Set(queue.map((s) => s.id));
		const newSongs = songs.filter((s) => !downloads[s.id] && !downloading.has(s.id) && !queueIds.has(s.id));
		if (newSongs.length === 0) return;
		set((s) => ({
			queue: [...s.queue, ...newSongs],
			queueTotal: s.queueTotal + newSongs.length,
		}));
		get().snapshotMetadataForSongs(newSongs);
		processQueue(get, set);
	},

	removeDownload: async (songId: string) => {
		const { downloads } = get();
		const entry = downloads[songId];
		if (!entry) return;

		try {
			await FileSystem.deleteAsync(entry.localUri, { idempotent: true });
		} catch {}

		const next = { ...downloads };
		delete next[songId];
		set({ downloads: next });
		persistDownloads(next);
	},

	removeDownloads: async (songIds: string[]) => {
		const { downloads } = get();
		const next = { ...downloads };
		for (const id of songIds) {
			const entry = next[id];
			if (entry) {
				try {
					await FileSystem.deleteAsync(entry.localUri, { idempotent: true });
				} catch {}
				delete next[id];
			}
		}
		set({ downloads: next });
		persistDownloads(next);
	},

	cancelQueue: () => {
		set({ queue: [], queueTotal: 0, queueCompleted: 0 });
	},

	isDownloaded: (songId: string) => !!get().downloads[songId],
	isDownloading: (songId: string) => get().downloading.has(songId),
	isQueued: (songId: string) => get().queue.some((s) => s.id === songId),
	getLocalUri: (songId: string) => get().downloads[songId]?.localUri,

	getQueueProgress: () => {
		const { queueTotal, queueCompleted } = get();
		return { completed: queueCompleted, total: queueTotal };
	},

	savePlaylistForOffline: async (playlist: Playlist, songs: Song[]) => {
		const entry: DownloadedPlaylist = {
			id: playlist.id,
			key: playlist.key,
			ratingKey: playlist.ratingKey,
			title: playlist.title,
			summary: playlist.summary,
			artworkUrl: playlist.artworkUrl,
			playlistType: playlist.playlistType,
			leafCount: songs.length,
			songs,
			downloadedAt: Date.now(),
		};
		const next = { ...get().downloadedPlaylists, [playlist.key]: entry };
		set({ downloadedPlaylists: next });
		persistPlaylists(next);
	},

	removePlaylistForOffline: async (playlistKey: string) => {
		const next = { ...get().downloadedPlaylists };
		delete next[playlistKey];
		set({ downloadedPlaylists: next });
		persistPlaylists(next);
	},

	getOfflinePlaylist: (playlistKey: string) => get().downloadedPlaylists[playlistKey],

	saveArtistForOffline: async (artist: Artist) => {
		const next = { ...get().downloadedArtists, [artist.key]: artist };
		set({ downloadedArtists: next });
		persistArtists(next);
	},

	saveAlbumForOffline: async (album: Album) => {
		const next = { ...get().downloadedAlbums, [album.id]: album };
		set({ downloadedAlbums: next });
		persistAlbums(next);
	},

	snapshotMetadataForSongs: async (songs: Song[]) => {
		const { useLibraryStore } = require('@/hooks/useLibraryStore');
		const libState = useLibraryStore.getState() as {
			artistsById: Record<string, Artist>;
			artists: Artist[];
			albumsById: Record<string, Album>;
		};
		const { artistsById, artists, albumsById } = libState;

		const { downloadedArtists, downloadedAlbums } = get();

		let artistsChanged = false;
		let albumsChanged = false;
		const nextArtists = { ...downloadedArtists };
		const nextAlbums = { ...downloadedAlbums };

		const seenArtistKeys = new Set<string>();
		const seenAlbumKeys = new Set<string>();

		for (const song of songs) {
			if (song.artistKey && !seenArtistKeys.has(song.artistKey)) {
				seenArtistKeys.add(song.artistKey);

				let artist: Artist | undefined = artistsById[song.artistKey];
				if (!artist) {
					const ratingKey = song.artistKey.split('/').pop() || song.artistKey;
					artist = artistsById[ratingKey];
				}
				if (!artist) {
					artist = artists.find((a) => a.name === song.artist);
				}
				if (artist && !nextArtists[artist.key]) {
					nextArtists[artist.key] = artist;
					artistsChanged = true;
				}
			}

			const albumKey = `${song.album}\0${song.artist}`;
			if (!seenAlbumKeys.has(albumKey)) {
				seenAlbumKeys.add(albumKey);
				const album = Object.values(albumsById).find((a) => a.title === song.album && a.artist === song.artist);
				if (album && !nextAlbums[album.id]) {
					nextAlbums[album.id] = album;
					albumsChanged = true;
				}
			}
		}

		if (artistsChanged || albumsChanged) {
			set({
				...(artistsChanged ? { downloadedArtists: nextArtists } : {}),
				...(albumsChanged ? { downloadedAlbums: nextAlbums } : {}),
			});
			if (artistsChanged) persistArtists(nextArtists);
			if (albumsChanged) persistAlbums(nextAlbums);
		}
	},

	removeAllDownloads: async () => {
		const { downloads } = get();
		for (const entry of Object.values(downloads)) {
			try {
				await FileSystem.deleteAsync(entry.localUri, { idempotent: true });
			} catch {}
		}
		set({
			downloads: {},
			downloadedPlaylists: {},
			downloadedArtists: {},
			downloadedAlbums: {},
			downloading: new Set(),
			queue: [],
			queueTotal: 0,
			queueCompleted: 0,
		});
		persistDownloads({});
		persistPlaylists({});
		persistArtists({});
		persistAlbums({});
	},
}));
