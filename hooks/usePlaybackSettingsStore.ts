import { create } from 'zustand';
import type { NetworkPlaybackRoute } from '@/lib/networkPlaybackRoute';
import TrackPlayer from '@/lib/playerAdapter';
import { storage } from '@/lib/storage';

const STORAGE_EQ_ENABLED = 'PLAYBACK_EQ_ENABLED';
const STORAGE_EQ_BANDS = 'PLAYBACK_EQ_BANDS';
const STORAGE_EQ_PRESET = 'PLAYBACK_EQ_PRESET';
const STORAGE_OUTPUT_GAIN = 'PLAYBACK_OUTPUT_GAIN';
const STORAGE_NORMALIZATION = 'PLAYBACK_NORMALIZATION';
const STORAGE_MONO_AUDIO = 'PLAYBACK_MONO_AUDIO';
const STORAGE_LEGACY_STREAMING_QUALITY = 'PLAYBACK_STREAMING_QUALITY';
const STORAGE_STREAM_BITRATE_WIFI = 'PLAYBACK_STREAM_BITRATE_WIFI';
const STORAGE_STREAM_BITRATE_CELLULAR = 'PLAYBACK_STREAM_BITRATE_CELLULAR';
const STORAGE_STREAM_TRANSCODE_CAP = 'PLAYBACK_STREAM_TRANSCODE_CAP';
const STORAGE_DOWNLOAD_BITRATE = 'PLAYBACK_DOWNLOAD_BITRATE';
const STORAGE_CROSSFADE_ENABLED = 'PLAYBACK_CROSSFADE_ENABLED';
const STORAGE_CROSSFADE_DURATION = 'PLAYBACK_CROSSFADE_DURATION';
const STORAGE_CROSSFADE_ADAPTIVE = 'PLAYBACK_CROSSFADE_ADAPTIVE';
const STORAGE_CROSSFADE_CURVE = 'PLAYBACK_CROSSFADE_CURVE';

/** Crossfade volume-ramp shape. Order matches the native `CrossfadeCurve` enum. */
export const CROSSFADE_CURVES = ['equalPower', 'linear', 'logarithmic', 'sCurve'] as const;
export type CrossfadeCurve = (typeof CROSSFADE_CURVES)[number];

export const CROSSFADE_CURVE_LABELS: Record<CrossfadeCurve, string> = {
	equalPower: 'Equal power',
	linear: 'Linear',
	logarithmic: 'Logarithmic',
	sCurve: 'S-curve',
};

function crossfadeCurveToNative(curve: CrossfadeCurve): 0 | 1 | 2 | 3 {
	const idx = CROSSFADE_CURVES.indexOf(curve);
	return (idx >= 0 ? idx : 0) as 0 | 1 | 2 | 3;
}

/** null = Original (no bitrate cap). */
export const STREAMING_BITRATE_KBPS_OPTIONS = [null, 320, 192, 128, 96] as const;
export type StreamingBitrateKbpsChoice = (typeof STREAMING_BITRATE_KBPS_OPTIONS)[number];

function encodeBitrateStorage(v: number | null): string {
	return v === null ? 'original' : String(v);
}

function decodeBitrateStorage(raw: string | undefined): number | null {
	if (raw == null || raw === '' || raw === 'original') return null;
	const n = Number.parseInt(raw, 10);
	return Number.isFinite(n) ? n : null;
}

/** Max bitrate for playback from Wi‑Fi / cellular limits and optional transcode ceiling. */
export function getStreamingPlaybackBitrateKbps(
	streamingBitrateWifi: number | null,
	streamingBitrateCellular: number | null,
	streamingTranscodeCapKbps: number | null,
	route: NetworkPlaybackRoute,
): number | null {
	const base = route === 'cellular' ? streamingBitrateCellular : streamingBitrateWifi;
	if (base === null) return null;
	if (streamingTranscodeCapKbps === null) return base;
	return Math.min(base, streamingTranscodeCapKbps);
}

export function formatBitrateChoiceLabel(choice: number | null): string {
	return choice === null ? 'Original' : `${choice} kbps`;
}

export interface EQBand {
	frequency: number;
	gain: number;
}

const DEFAULT_BANDS: EQBand[] = [
	{ frequency: 31, gain: 0 },
	{ frequency: 62, gain: 0 },
	{ frequency: 125, gain: 0 },
	{ frequency: 250, gain: 0 },
	{ frequency: 500, gain: 0 },
	{ frequency: 1000, gain: 0 },
	{ frequency: 2000, gain: 0 },
	{ frequency: 4000, gain: 0 },
	{ frequency: 8000, gain: 0 },
	{ frequency: 16000, gain: 0 },
];

export const EQ_PRESETS: Record<string, number[]> = {
	Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
	Rock: [4, 3, 1, -1, -2, 1, 3, 4, 4, 3],
	Pop: [-1, 1, 3, 4, 3, 0, -1, -1, 1, 2],
	Jazz: [3, 2, 0, 2, -2, -2, 0, 2, 3, 3],
	Classical: [4, 3, 2, 1, -1, -1, 0, 2, 3, 4],
	'Bass Boost': [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
	'Treble Boost': [0, 0, 0, 0, 0, 1, 2, 4, 5, 6],
	'Vocal Boost': [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1],
};

export function formatFrequency(hz: number): string {
	return hz >= 1000 ? `${hz / 1000}k` : `${hz}`;
}

interface PlaybackSettingsState {
	hydrated: boolean;
	equalizerEnabled: boolean;
	equalizerBands: EQBand[];
	selectedPreset: string | null;
	outputGainDb: number;
	normalizationEnabled: boolean;
	monoAudioEnabled: boolean;
	streamingBitrateWifi: number | null;
	streamingBitrateCellular: number | null;
	/** Optional ceiling on top of Wi‑Fi/cellular when Plex transcodes (null = no extra cap). */
	streamingTranscodeCapKbps: number | null;
	downloadBitrateKbps: number | null;

	crossfadeEnabled: boolean;
	/** Fixed overlap seconds when adaptive is off; also caps range for adaptive heuristic. */
	crossfadeDurationSec: number;
	crossfadeAdaptiveEnabled: boolean;
	crossfadeCurve: CrossfadeCurve;

	hydrate: () => void;
	syncNativeCrossfade: () => void;
	setEqualizerEnabled: (enabled: boolean) => void;
	setBandGain: (index: number, gain: number) => void;
	setAllBands: (gains: number[]) => void;
	setPreset: (name: string) => void;
	resetEQ: () => void;
	setOutputGain: (db: number) => void;
	setNormalizationEnabled: (enabled: boolean) => void;
	setMonoAudioEnabled: (enabled: boolean) => void;
	setStreamingBitrateWifi: (kbps: number | null) => void;
	setStreamingBitrateCellular: (kbps: number | null) => void;
	setStreamingTranscodeCapKbps: (kbps: number | null) => void;
	setDownloadBitrateKbps: (kbps: number | null) => void;
	setCrossfadeEnabled: (enabled: boolean) => void;
	setCrossfadeDurationSec: (seconds: number) => void;
	setCrossfadeAdaptiveEnabled: (enabled: boolean) => void;
	setCrossfadeCurve: (curve: CrossfadeCurve) => void;
}

function applyBandsToNative(bands: EQBand[]) {
	TrackPlayer.setEqualizerBands(bands).catch(() => {});
}

function pushCrossfadeConfigToNative(enabled: boolean, defaultDuration: number, curve: CrossfadeCurve, minDuration = 1, maxDuration = 12) {
	TrackPlayer.setCrossfadeConfig({
		enabled,
		defaultDuration,
		minDuration,
		maxDuration,
		fadeInOnManualSkip: true,
		manualSkipFadeDuration: 0.5,
		curve: crossfadeCurveToNative(curve),
		lowpassTail: true,
	}).catch(() => {});
}

export const usePlaybackSettingsStore = create<PlaybackSettingsState>((set, get) => ({
	hydrated: false,
	equalizerEnabled: false,
	equalizerBands: DEFAULT_BANDS,
	selectedPreset: null,
	outputGainDb: 0,
	normalizationEnabled: false,
	monoAudioEnabled: false,
	streamingBitrateWifi: 128,
	streamingBitrateCellular: 128,
	streamingTranscodeCapKbps: null,
	downloadBitrateKbps: 128,
	crossfadeEnabled: false,
	crossfadeDurationSec: 4,
	crossfadeAdaptiveEnabled: true,
	crossfadeCurve: 'equalPower',

	syncNativeCrossfade: () => {
		const { crossfadeEnabled, crossfadeDurationSec, crossfadeCurve } = get();
		pushCrossfadeConfigToNative(crossfadeEnabled, crossfadeDurationSec, crossfadeCurve);
	},

	hydrate: () => {
		try {
			const eqEnabledRaw = storage.getString(STORAGE_EQ_ENABLED);
			const bandsRaw = storage.getString(STORAGE_EQ_BANDS);
			const presetRaw = storage.getString(STORAGE_EQ_PRESET);
			const gainRaw = storage.getString(STORAGE_OUTPUT_GAIN);
			const normRaw = storage.getString(STORAGE_NORMALIZATION);
			const monoRaw = storage.getString(STORAGE_MONO_AUDIO);
			const crossfadeEnRaw = storage.getString(STORAGE_CROSSFADE_ENABLED);
			const crossfadeDurRaw = storage.getString(STORAGE_CROSSFADE_DURATION);
			const crossfadeAdRaw = storage.getString(STORAGE_CROSSFADE_ADAPTIVE);
			const crossfadeCurveRaw = storage.getString(STORAGE_CROSSFADE_CURVE);

			const eqEnabled = eqEnabledRaw === '1';
			const bands = bandsRaw ? JSON.parse(bandsRaw) : DEFAULT_BANDS;
			const preset = presetRaw || null;
			const gainDb = gainRaw ? Number.parseFloat(gainRaw) : 0;
			const normalization = normRaw === '1';
			const mono = monoRaw === '1';
			const crossfadeEnabled = crossfadeEnRaw === '1';
			const crossfadeDurationSec = crossfadeDurRaw ? Number.parseFloat(crossfadeDurRaw) : 4;
			const crossfadeAdaptiveEnabled = crossfadeAdRaw !== '0';
			const crossfadeCurve: CrossfadeCurve = CROSSFADE_CURVES.includes(crossfadeCurveRaw as CrossfadeCurve)
				? (crossfadeCurveRaw as CrossfadeCurve)
				: 'equalPower';

			let streamingBitrateWifi: number | null;
			let streamingBitrateCellular: number | null;
			let streamingTranscodeCapKbps: number | null;
			let downloadBitrateKbps: number | null;

			if (!storage.contains(STORAGE_STREAM_BITRATE_WIFI)) {
				const legacy = storage.getString(STORAGE_LEGACY_STREAMING_QUALITY);
				if (legacy === 'original') {
					streamingBitrateWifi = null;
					streamingBitrateCellular = null;
				} else if (legacy === 'high') {
					streamingBitrateWifi = 320;
					streamingBitrateCellular = 320;
				} else if (legacy === 'medium') {
					streamingBitrateWifi = 192;
					streamingBitrateCellular = 192;
				} else if (legacy === 'low') {
					streamingBitrateWifi = 96;
					streamingBitrateCellular = 96;
				} else {
					streamingBitrateWifi = 128;
					streamingBitrateCellular = 128;
				}
				streamingTranscodeCapKbps = null;
				downloadBitrateKbps = 128;
				storage.set(STORAGE_STREAM_BITRATE_WIFI, encodeBitrateStorage(streamingBitrateWifi));
				storage.set(STORAGE_STREAM_BITRATE_CELLULAR, encodeBitrateStorage(streamingBitrateCellular));
				storage.set(STORAGE_STREAM_TRANSCODE_CAP, encodeBitrateStorage(null));
				storage.set(STORAGE_DOWNLOAD_BITRATE, encodeBitrateStorage(128));
			} else {
				streamingBitrateWifi = decodeBitrateStorage(storage.getString(STORAGE_STREAM_BITRATE_WIFI));
				streamingBitrateCellular = storage.contains(STORAGE_STREAM_BITRATE_CELLULAR)
					? decodeBitrateStorage(storage.getString(STORAGE_STREAM_BITRATE_CELLULAR))
					: streamingBitrateWifi;
				if (!storage.contains(STORAGE_STREAM_BITRATE_CELLULAR)) {
					storage.set(STORAGE_STREAM_BITRATE_CELLULAR, encodeBitrateStorage(streamingBitrateCellular));
				}
				streamingTranscodeCapKbps = storage.contains(STORAGE_STREAM_TRANSCODE_CAP)
					? decodeBitrateStorage(storage.getString(STORAGE_STREAM_TRANSCODE_CAP))
					: null;
				if (!storage.contains(STORAGE_STREAM_TRANSCODE_CAP)) {
					storage.set(STORAGE_STREAM_TRANSCODE_CAP, encodeBitrateStorage(null));
				}
				if (!storage.contains(STORAGE_DOWNLOAD_BITRATE)) {
					downloadBitrateKbps = 128;
					storage.set(STORAGE_DOWNLOAD_BITRATE, encodeBitrateStorage(128));
				} else {
					downloadBitrateKbps = decodeBitrateStorage(storage.getString(STORAGE_DOWNLOAD_BITRATE));
				}
			}

			set({
				hydrated: true,
				equalizerEnabled: eqEnabled,
				equalizerBands: bands,
				selectedPreset: preset,
				outputGainDb: gainDb,
				normalizationEnabled: normalization,
				monoAudioEnabled: mono,
				streamingBitrateWifi,
				streamingBitrateCellular,
				streamingTranscodeCapKbps,
				downloadBitrateKbps,
				crossfadeEnabled,
				crossfadeDurationSec: Number.isFinite(crossfadeDurationSec) ? crossfadeDurationSec : 4,
				crossfadeAdaptiveEnabled,
				crossfadeCurve,
			});

			pushCrossfadeConfigToNative(crossfadeEnabled, Number.isFinite(crossfadeDurationSec) ? crossfadeDurationSec : 4, crossfadeCurve);

			TrackPlayer.setEqualizerEnabled(eqEnabled).catch(() => {});
			applyBandsToNative(bands);
			TrackPlayer.setOutputGain(gainDb).catch(() => {});
			TrackPlayer.setNormalizationEnabled(normalization).catch(() => {});
			TrackPlayer.setMonoAudioEnabled(mono).catch(() => {});
		} catch {
			set({ hydrated: true });
		}
	},

	setEqualizerEnabled: (enabled: boolean) => {
		set({ equalizerEnabled: enabled });
		TrackPlayer.setEqualizerEnabled(enabled).catch(() => {});
		storage.set(STORAGE_EQ_ENABLED, enabled ? '1' : '0');
	},

	setBandGain: (index: number, gain: number) => {
		const bands = [...get().equalizerBands];
		if (index < 0 || index >= bands.length) return;
		bands[index] = { ...bands[index], gain: Math.max(-12, Math.min(12, gain)) };
		set({ equalizerBands: bands, selectedPreset: null });
		applyBandsToNative(bands);
		storage.set(STORAGE_EQ_BANDS, JSON.stringify(bands));
		storage.remove(STORAGE_EQ_PRESET);
	},

	setAllBands: (gains: number[]) => {
		const bands = get().equalizerBands.map((b, i) => ({
			...b,
			gain: Math.max(-12, Math.min(12, gains[i] ?? 0)),
		}));
		set({ equalizerBands: bands });
		applyBandsToNative(bands);
		storage.set(STORAGE_EQ_BANDS, JSON.stringify(bands));
	},

	setPreset: (name: string) => {
		const gains = EQ_PRESETS[name];
		if (!gains) return;
		const bands = DEFAULT_BANDS.map((b, i) => ({ ...b, gain: gains[i] ?? 0 }));
		set({ equalizerBands: bands, selectedPreset: name });
		applyBandsToNative(bands);
		storage.set(STORAGE_EQ_BANDS, JSON.stringify(bands));
		storage.set(STORAGE_EQ_PRESET, name);
	},

	resetEQ: () => {
		set({ equalizerBands: DEFAULT_BANDS, selectedPreset: 'Flat' });
		applyBandsToNative(DEFAULT_BANDS);
		storage.set(STORAGE_EQ_BANDS, JSON.stringify(DEFAULT_BANDS));
		storage.set(STORAGE_EQ_PRESET, 'Flat');
	},

	setOutputGain: (db: number) => {
		const clamped = Math.max(-10, Math.min(10, Math.round(db * 10) / 10));
		set({ outputGainDb: clamped });
		TrackPlayer.setOutputGain(clamped).catch(() => {});
		storage.set(STORAGE_OUTPUT_GAIN, String(clamped));
	},

	setNormalizationEnabled: (enabled: boolean) => {
		set({ normalizationEnabled: enabled });
		TrackPlayer.setNormalizationEnabled(enabled).catch(() => {});
		storage.set(STORAGE_NORMALIZATION, enabled ? '1' : '0');
	},

	setMonoAudioEnabled: (enabled: boolean) => {
		set({ monoAudioEnabled: enabled });
		TrackPlayer.setMonoAudioEnabled(enabled).catch(() => {});
		storage.set(STORAGE_MONO_AUDIO, enabled ? '1' : '0');
	},

	setStreamingBitrateWifi: (kbps: number | null) => {
		set({ streamingBitrateWifi: kbps });
		storage.set(STORAGE_STREAM_BITRATE_WIFI, encodeBitrateStorage(kbps));
	},

	setStreamingBitrateCellular: (kbps: number | null) => {
		set({ streamingBitrateCellular: kbps });
		storage.set(STORAGE_STREAM_BITRATE_CELLULAR, encodeBitrateStorage(kbps));
	},

	setStreamingTranscodeCapKbps: (kbps: number | null) => {
		set({ streamingTranscodeCapKbps: kbps });
		storage.set(STORAGE_STREAM_TRANSCODE_CAP, encodeBitrateStorage(kbps));
	},

	setDownloadBitrateKbps: (kbps: number | null) => {
		set({ downloadBitrateKbps: kbps });
		storage.set(STORAGE_DOWNLOAD_BITRATE, encodeBitrateStorage(kbps));
	},

	setCrossfadeEnabled: (enabled: boolean) => {
		set({ crossfadeEnabled: enabled });
		storage.set(STORAGE_CROSSFADE_ENABLED, enabled ? '1' : '0');
		pushCrossfadeConfigToNative(enabled, get().crossfadeDurationSec, get().crossfadeCurve);
	},

	setCrossfadeDurationSec: (seconds: number) => {
		const clamped = Math.max(1, Math.min(12, Math.round(seconds * 10) / 10));
		set({ crossfadeDurationSec: clamped });
		storage.set(STORAGE_CROSSFADE_DURATION, String(clamped));
		pushCrossfadeConfigToNative(get().crossfadeEnabled, clamped, get().crossfadeCurve);
	},

	setCrossfadeAdaptiveEnabled: (enabled: boolean) => {
		set({ crossfadeAdaptiveEnabled: enabled });
		storage.set(STORAGE_CROSSFADE_ADAPTIVE, enabled ? '1' : '0');
	},

	setCrossfadeCurve: (curve: CrossfadeCurve) => {
		set({ crossfadeCurve: curve });
		storage.set(STORAGE_CROSSFADE_CURVE, curve);
		pushCrossfadeConfigToNative(get().crossfadeEnabled, get().crossfadeDurationSec, curve);
	},
}));
