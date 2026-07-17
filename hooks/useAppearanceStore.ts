import { create } from 'zustand';
import { storage } from '@/lib/storage';

const STORAGE_KEY = 'APPEARANCE_SETTINGS';

const DEFAULT_BRAND = '#7f62f5';

interface StoredAppearance {
	showPodcastsTab?: boolean;
	showMusicTab?: boolean;
	brandColor?: string | null;
	useBlurInsteadOfGlass?: boolean;
	useFullBleedPlayer?: boolean;
}

function persistAppearance(partial: StoredAppearance) {
	try {
		const raw = storage.getString(STORAGE_KEY);
		const current: StoredAppearance = raw ? JSON.parse(raw) : {};
		const next = { ...current, ...partial };
		storage.set(STORAGE_KEY, JSON.stringify(next));
	} catch {}
}

interface AppearanceState {
	showPodcastsTab: boolean;
	showMusicTab: boolean;
	brandColor: string | null;
	useBlurInsteadOfGlass: boolean;
	useFullBleedPlayer: boolean;
	hydrated: boolean;
	setShowPodcastsTab: (show: boolean) => void;
	setShowMusicTab: (show: boolean) => void;
	setBrandColor: (color: string | null) => void;
	setUseBlurInsteadOfGlass: (use: boolean) => void;
	setUseFullBleedPlayer: (use: boolean) => void;
	hydrate: () => void;
}

export const DEFAULT_BRAND_COLOR = DEFAULT_BRAND;

export const useAppearanceStore = create<AppearanceState>((set, _get) => ({
	showPodcastsTab: false,
	showMusicTab: true,
	brandColor: null,
	useBlurInsteadOfGlass: false,
	useFullBleedPlayer: false,
	hydrated: false,

	setShowPodcastsTab: (show: boolean) => {
		set({ showPodcastsTab: show });
		persistAppearance({ showPodcastsTab: show });
	},

	setShowMusicTab: (show: boolean) => {
		set({ showMusicTab: show });
		persistAppearance({ showMusicTab: show });
	},

	setBrandColor: (color: string | null) => {
		set({ brandColor: color });
		persistAppearance({ brandColor: color });
	},

	setUseBlurInsteadOfGlass: (use: boolean) => {
		set({ useBlurInsteadOfGlass: use });
		persistAppearance({ useBlurInsteadOfGlass: use });
	},

	setUseFullBleedPlayer: (use: boolean) => {
		set({ useFullBleedPlayer: use });
		persistAppearance({ useFullBleedPlayer: use });
	},

	hydrate: () => {
		try {
			const raw = storage.getString(STORAGE_KEY);
			if (raw) {
				const parsed: StoredAppearance = JSON.parse(raw);
				set({
					showPodcastsTab: parsed.showPodcastsTab ?? false,
					showMusicTab: parsed.showMusicTab ?? true,
					brandColor: parsed.brandColor ?? null,
					useBlurInsteadOfGlass: parsed.useBlurInsteadOfGlass ?? false,
					useFullBleedPlayer: parsed.useFullBleedPlayer ?? false,
				});
			}
		} catch {}
		set({ hydrated: true });
	},
}));
