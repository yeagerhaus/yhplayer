import type { Album } from './album';
import type { Playlist } from './playlist';
import type { Song } from './song';

/**
 * A parsed Plex home hub (from `GET /hubs/sections/{sectionId}`), normalized by
 * content type. Covers "Mixes For You", radio stations, recently added, etc.
 */
export type HomeHub = {
	/** hubIdentifier, or a key/title fallback. */
	id: string;
	title: string;
	/** Plex hubIdentifier, e.g. "home.continue", "station.*", "<section>.recentlyAdded". */
	identifier: string;
	/** Layout hint from Plex: 'hero', 'shelf', 'list', etc. */
	style?: string;
	/** Primary content type of the hub: 'playlist', 'album', 'track', 'mixed', etc. */
	type?: string;
	tracks: Song[];
	albums: Album[];
	playlists: Playlist[];
};

export type HomeFeedKind =
	| 'continue-track'
	| 'continue-playlist'
	| 'continue-podcast'
	| 'mix'
	| 'station'
	| 'suggestion'
	| 'recently-added';

/**
 * A single card in the "For You" hero/carousel. Produced by `useHomeFeed` from a
 * blend of listening history and Plex smart hubs.
 */
export type HomeFeedItem = {
	id: string;
	kind: HomeFeedKind;
	/** Eyebrow label, e.g. "CONTINUE LISTENING", "MIX FOR YOU", "STATION". */
	eyebrow: string;
	title: string;
	subtitle: string;
	artwork: string;
	/** 0..1 playback progress (podcasts only). */
	progress?: number;
	/** Ranking score (higher first). */
	score: number;
	play: () => void | Promise<void>;
};
