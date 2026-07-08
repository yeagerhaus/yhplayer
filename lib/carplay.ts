import { Platform } from 'react-native';
import { CarPlay, type ListItem, ListTemplate, TabBarTemplate } from 'react-native-carplay';
import { useAudioStore } from '@/hooks/useAudioStore';
import { useLibraryStore } from '@/hooks/useLibraryStore';
import type { Playlist, Song } from '@/types';
import { fetchPlaylistTracks } from '@/utils/plex';

let recentlyPlayedList: ListTemplate | null = null;
let playlistsList: ListTemplate | null = null;
let storeUnsubscribers: (() => void)[] = [];

function artworkUrlForCarPlay(url: string | undefined): string | undefined {
	if (!url || typeof url !== 'string') return undefined;
	const t = url.trim();
	if (t.startsWith('http://') || t.startsWith('https://')) return t;
	return undefined;
}

function songToListItem(song: Song): ListItem {
	const imgUrl = artworkUrlForCarPlay(song.artworkUrl || song.artwork);
	const base: ListItem = {
		text: song.title,
		detailText: song.artist,
	};
	return imgUrl ? ({ ...base, imgUrl } as unknown as ListItem) : base;
}

function playlistToListItem(playlist: Playlist): ListItem {
	const imgUrl = artworkUrlForCarPlay(playlist.artworkUrl || playlist.artwork);
	const base: ListItem = {
		text: playlist.title,
		detailText: playlist.leafCount ? `${playlist.leafCount} tracks` : undefined,
		showsDisclosureIndicator: true,
	};
	return imgUrl ? ({ ...base, imgUrl } as unknown as ListItem) : base;
}

function buildRecentlyPlayedTemplate(songs: Song[]): ListTemplate {
	const template = new ListTemplate({
		id: 'carplay-recently-played',
		title: 'Recently Played',
		tabTitle: 'Recent',
		tabSystemImageName: 'clock',
		sections: [{ items: songs.map(songToListItem) }],
		emptyViewTitleVariants: ['No Recently Played'],
		emptyViewSubtitleVariants: ['Play some music to see it here'],
		async onItemSelect({ index }: { templateId: string; index: number }) {
			const { recentlyPlayed } = useLibraryStore.getState();
			const song = recentlyPlayed[index];
			if (song) {
				useAudioStore.getState().playSound(song, recentlyPlayed);
			}
		},
	});
	return template;
}

function buildPlaylistsTemplate(playlists: Playlist[]): ListTemplate {
	const template = new ListTemplate({
		id: 'carplay-playlists',
		title: 'Playlists',
		tabTitle: 'Playlists',
		tabSystemImageName: 'music.note.list',
		sections: [{ items: playlists.map(playlistToListItem) }],
		emptyViewTitleVariants: ['No Playlists'],
		emptyViewSubtitleVariants: ['Create playlists in your Plex library'],
		async onItemSelect({ index }: { templateId: string; index: number }) {
			const { playlists: currentPlaylists } = useLibraryStore.getState();
			const playlist = currentPlaylists[index];
			if (!playlist) return;

			// Push the detail template immediately with a loading empty-view so the driver gets instant
			// feedback; CarPlay auto-hides the empty view once we fill in the fetched tracks. Tracks are
			// captured in a mutable closure so row selection uses the resolved list.
			let tracks: Song[] = [];
			const detailTemplate = new ListTemplate({
				title: playlist.title,
				sections: [],
				emptyViewTitleVariants: ['Loading…'],
				emptyViewSubtitleVariants: ['Fetching tracks'],
				async onItemSelect({ index: trackIndex }: { templateId: string; index: number }) {
					const song = tracks[trackIndex];
					if (song) {
						useAudioStore.getState().playSound(song, tracks);
					}
				},
			});

			CarPlay.pushTemplate(detailTemplate, true);

			try {
				tracks = await fetchPlaylistTracks(playlist.key);
				detailTemplate.updateSections([{ items: tracks.map(songToListItem) }]);
			} catch {
				// Leave the list empty; the empty view communicates that nothing loaded.
				detailTemplate.updateSections([]);
			}
		},
	});
	return template;
}

function rebuildLists() {
	const { recentlyPlayed, playlists } = useLibraryStore.getState();
	recentlyPlayedList?.updateSections([{ items: recentlyPlayed.map(songToListItem) }]);
	playlistsList?.updateSections([{ items: playlists.map(playlistToListItem) }]);
}

function onConnect() {
	// `checkForConnection()` can fire `didConnect` before our callback is registered, so setupCarPlay
	// also invokes this directly for the already-connected case. Guard against building the templates
	// (and stacking subscriptions) twice.
	if (storeUnsubscribers.length > 0) {
		rebuildLists();
		return;
	}

	const { recentlyPlayed, playlists } = useLibraryStore.getState();

	recentlyPlayedList = buildRecentlyPlayedTemplate(recentlyPlayed);
	playlistsList = buildPlaylistsTemplate(playlists);

	const tabBar = new TabBarTemplate({
		title: 'Rite',
		templates: [recentlyPlayedList, playlistsList],
		onTemplateSelect() {},
	});

	CarPlay.setRootTemplate(tabBar, false);
	CarPlay.enableNowPlaying(true);

	// Keep CarPlay lists in sync with store changes. When CarPlay is plugged in at launch, the library
	// usually hydrates *after* connect, so these subscriptions are what populate the initially empty
	// lists once data arrives.
	const unsubRecent = useLibraryStore.subscribe((state, prev) => {
		if (state.recentlyPlayed !== prev.recentlyPlayed) {
			recentlyPlayedList?.updateSections([{ items: state.recentlyPlayed.map(songToListItem) }]);
		}
	});

	const unsubPlaylists = useLibraryStore.subscribe((state, prev) => {
		if (state.playlists !== prev.playlists) {
			playlistsList?.updateSections([{ items: state.playlists.map(playlistToListItem) }]);
		}
	});

	storeUnsubscribers.push(unsubRecent, unsubPlaylists);
}

function onDisconnect() {
	for (const unsub of storeUnsubscribers) unsub();
	storeUnsubscribers = [];
	recentlyPlayedList = null;
	playlistsList = null;
}

export function setupCarPlay() {
	if (Platform.OS !== 'ios') return;
	CarPlay.registerOnConnect(onConnect);
	CarPlay.registerOnDisconnect(onDisconnect);
	// If CarPlay was already connected before this ran (app launched while plugged in), the initial
	// `didConnect` fired before registration — build the templates now.
	if (CarPlay.connected) {
		onConnect();
	}
}

export function teardownCarPlay() {
	if (Platform.OS !== 'ios') return;
	CarPlay.unregisterOnConnect(onConnect);
	CarPlay.unregisterOnDisconnect(onDisconnect);
	onDisconnect();
}
