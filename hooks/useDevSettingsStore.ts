import { create } from 'zustand';
import { storage } from '@/lib/storage';

const STORAGE_KEY = 'DEV_SHOW_PERFORMANCE_DEBUGGER';
const STORAGE_SCRUBBER_KEY = 'DEV_SCRUBBER_STYLE';

export type ScrubberStyle = 'line' | 'segmented' | 'smooth';

const SCRUBBER_STYLES: ScrubberStyle[] = ['line', 'segmented', 'smooth'];

interface DevSettingsState {
	showPerformanceDebugger: boolean;
	scrubberStyle: ScrubberStyle;
	hydrated: boolean;
	setShowPerformanceDebugger: (value: boolean) => void;
	setScrubberStyle: (value: ScrubberStyle) => void;
	hydrate: () => void;
}

export const useDevSettingsStore = create<DevSettingsState>((set, _get) => ({
	showPerformanceDebugger: false,
	scrubberStyle: 'line',
	hydrated: false,

	setShowPerformanceDebugger: (value: boolean) => {
		set({ showPerformanceDebugger: value });
		storage.set(STORAGE_KEY, value ? '1' : '0');
	},

	setScrubberStyle: (value: ScrubberStyle) => {
		set({ scrubberStyle: value });
		storage.set(STORAGE_SCRUBBER_KEY, value);
	},

	hydrate: () => {
		try {
			const show = storage.getString(STORAGE_KEY) === '1';
			const rawStyle = storage.getString(STORAGE_SCRUBBER_KEY);
			const scrubberStyle = SCRUBBER_STYLES.includes(rawStyle as ScrubberStyle) ? (rawStyle as ScrubberStyle) : 'line';
			set({ showPerformanceDebugger: show, scrubberStyle, hydrated: true });
		} catch {
			set({ hydrated: true });
		}
	},
}));
