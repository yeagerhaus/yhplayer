import { create } from 'zustand';
import { storage } from '@/lib/storage';
import type { Song } from '@/types';
import { fetchUltraBlurColors } from '@/utils/plex';
import { useAudioStore } from './useAudioStore';
import { getIsOfflineMode } from './useOfflineModeStore';

const STORAGE_KEY = 'ULTRABLUR_CACHE';
const MAX_ENTRIES = 500;
const TRIM_TO = 250;

const memoryCache = new Map<string, string[]>();
let cacheLoaded = false;

function loadCache(): void {
	if (cacheLoaded) return;
	try {
		const raw = storage.getString(STORAGE_KEY);
		if (raw) {
			const parsed: Record<string, string[]> = JSON.parse(raw);
			for (const [key, value] of Object.entries(parsed)) {
				if (Array.isArray(value)) {
					memoryCache.set(key, value);
				}
			}
		}
	} catch {}
	cacheLoaded = true;
}

function persistCache(): void {
	if (memoryCache.size > MAX_ENTRIES) {
		const keys = Array.from(memoryCache.keys());
		const toRemove = keys.slice(0, keys.length - TRIM_TO);
		for (const key of toRemove) {
			memoryCache.delete(key);
		}
	}

	const obj: Record<string, string[]> = {};
	for (const [key, value] of memoryCache.entries()) {
		obj[key] = value;
	}
	storage.set(STORAGE_KEY, JSON.stringify(obj));
}

export interface UltraBlurDirectionalColors {
	topLeft: string;
	topRight: string;
	bottomRight: string;
	bottomLeft: string;
}

const DEFAULT_COLORS: UltraBlurDirectionalColors = {
	topLeft: '#000',
	topRight: '#000',
	bottomRight: '#000',
	bottomLeft: '#000',
};

function arrayToDirectional(colors: string[]): UltraBlurDirectionalColors {
	// Order from API: [topLeft, topRight, bottomRight, bottomLeft]
	return {
		topLeft: colors[0] || '#000',
		topRight: colors[1] || '#000',
		bottomRight: colors[2] || '#000',
		bottomLeft: colors[3] || '#000',
	};
}

interface UltraBlurState {
	colors: UltraBlurDirectionalColors;
	hasColors: boolean;
	fetchColors: (song: Song) => Promise<void>;
}

export const useUltraBlurColors = create<UltraBlurState>((set) => ({
	colors: DEFAULT_COLORS,
	hasColors: false,

	fetchColors: async (song: Song) => {
		const songId = song.id;

		// 1. Check in-memory cache
		const cached = memoryCache.get(songId);
		if (cached) {
			set({ colors: arrayToDirectional(cached), hasColors: true });
			return;
		}

		// 2. Ensure MMKV cache is loaded, then re-check
		if (!cacheLoaded) {
			loadCache();
			const fromDisk = memoryCache.get(songId);
			if (fromDisk) {
				set({ colors: arrayToDirectional(fromDisk), hasColors: true });
				return;
			}
		}

		// 3. Fetch from API. Skip when offline — Plex isn't reachable and initialize() would throw,
		// surfacing as an uncaught rejection on every track change in offline mode.
		const thumbUrl = song.artworkUrl || song.artwork;
		if (!thumbUrl || getIsOfflineMode()) {
			set({ colors: DEFAULT_COLORS, hasColors: false });
			return;
		}

		try {
			const colors = await fetchUltraBlurColors(thumbUrl);
			if (colors && colors.length > 0) {
				memoryCache.set(songId, colors);
				persistCache();
				set({ colors: arrayToDirectional(colors), hasColors: true });
			} else {
				set({ colors: DEFAULT_COLORS, hasColors: false });
			}
		} catch {
			// Network/offline/transient failure — fall back to defaults rather than rejecting.
			set({ colors: DEFAULT_COLORS, hasColors: false });
		}
	},
}));

// Auto-fetch when currentSong changes
let lastSongId: string | null = null;
useAudioStore.subscribe((state) => {
	const song = state.currentSong;
	if (!song || song.id === lastSongId) return;
	lastSongId = song.id;
	useUltraBlurColors
		.getState()
		.fetchColors(song)
		.catch(() => {});
});

// Kick off cache load eagerly
loadCache();
