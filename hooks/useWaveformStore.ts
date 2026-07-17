import { create } from 'zustand';
import { storage } from '@/lib/storage';
import { isAvailable, YhwavAudioModule } from '@/modules/yhwav-audio';

const KEY_PREFIX = 'WAVEFORM_';

/** Resolution stored per track. Variants downsample from this for display. */
export const RAW_WAVEFORM_BUCKETS = 400;

const key = (songId: string) => `${KEY_PREFIX}${songId}`;

function readPersisted(songId: string): number[] | null {
	try {
		const raw = storage.getString(key(songId));
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed) && parsed.length > 0) return parsed as number[];
	} catch {}
	return null;
}

interface WaveformState {
	/** undefined = not looked up yet, null = looked up and absent, array = real peaks. */
	byId: Record<string, number[] | null | undefined>;
	/** Lazily loads a track's persisted waveform into memory (idempotent). */
	ensureLoaded: (songId: string) => void;
	/** Computes real peaks from a local file and persists them (no-op if already stored). */
	computeAndStore: (songId: string, localUri: string) => Promise<void>;
	remove: (songId: string) => void;
	removeMany: (songIds: string[]) => void;
}

export const useWaveformStore = create<WaveformState>((set, get) => ({
	byId: {},

	ensureLoaded: (songId: string) => {
		if (!songId || songId in get().byId) return;
		const peaks = readPersisted(songId);
		set((s) => ({ byId: { ...s.byId, [songId]: peaks } }));
	},

	computeAndStore: async (songId: string, localUri: string) => {
		if (!songId || !localUri) return;
		if (!isAvailable() || !YhwavAudioModule) return;
		// Already persisted — nothing to do.
		if (readPersisted(songId)) return;

		try {
			const peaks = await YhwavAudioModule.computeWaveform(localUri, RAW_WAVEFORM_BUCKETS);
			if (!Array.isArray(peaks) || peaks.length === 0) return;
			// Round to keep the persisted JSON small.
			const rounded = peaks.map((p) => Math.round(Math.min(1, Math.max(0, p)) * 1000) / 1000);
			storage.set(key(songId), JSON.stringify(rounded));
			set((s) => ({ byId: { ...s.byId, [songId]: rounded } }));
		} catch (error) {
			console.warn(`Waveform compute failed for ${songId}:`, error);
		}
	},

	remove: (songId: string) => {
		try {
			storage.remove(key(songId));
		} catch {}
		set((s) => {
			const next = { ...s.byId };
			delete next[songId];
			return { byId: next };
		});
	},

	removeMany: (songIds: string[]) => {
		for (const id of songIds) {
			try {
				storage.remove(key(id));
			} catch {}
		}
		set((s) => {
			const next = { ...s.byId };
			for (const id of songIds) delete next[id];
			return { byId: next };
		});
	},
}));
