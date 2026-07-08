import { requireOptionalNativeModule } from 'expo';

export interface Track {
	id: string;
	url: string;
	/** Direct Plex file URL when `url` is a transcode URL (native fallback if transcode is truncated). */
	directUrl?: string;
	title?: string;
	artist?: string;
	artwork?: string;
	duration?: number;
	/** Gapless handoff into this track even when Sweet Fades is enabled (e.g. podcasts). */
	crossfadeDisabled?: boolean;
}

export interface CrossfadeConfig {
	enabled: boolean;
	defaultDuration: number;
	minDuration: number;
	maxDuration: number;
	fadeInOnManualSkip: boolean;
	manualSkipFadeDuration: number;
}

export interface PlaybackState {
	state: string;
	position: number;
	duration: number;
	buffered?: number;
}

type YhwavAudioModuleType = {
	setupPlayer: (options?: Record<string, unknown>) => Promise<void>;
	updateOptions: (options?: Record<string, unknown>) => Promise<void>;
	add: (tracks: Track[], insertAfterIndex?: number) => Promise<void>;
	reset: () => Promise<void>;
	remove: (indices: number[]) => Promise<void>;
	removeUpcomingTracks: () => Promise<void>;
	move: (fromIndex: number, toIndex: number) => Promise<void>;
	skip: (index: number, startPaused?: boolean, startAtSeconds?: number) => Promise<void>;
	play: () => Promise<void>;
	pause: () => Promise<void>;
	seekTo: (position: number) => Promise<void>;
	setVolume: (value: number) => Promise<void>;
	setRate: (value: number) => Promise<void>;
	setRepeatMode: (mode: number) => Promise<void>;
	setEqualizerBands: (bands: Array<{ frequency: number; gain: number }>) => Promise<void>;
	setEqualizerEnabled: (enabled: boolean) => Promise<void>;
	setOutputGain: (gainDb: number) => Promise<void>;
	setNormalizationEnabled: (enabled: boolean) => Promise<void>;
	setMonoAudioEnabled: (enabled: boolean) => Promise<void>;
	setCrossfadeConfig: (config: CrossfadeConfig) => Promise<void>;
	setNextCrossfadeDuration: (seconds: number) => Promise<void>;
	getPlaybackState: () => PlaybackState;
	getActiveTrackIndex: () => number;
	getQueue: () => Track[];
	prewarmURL: (url: string, trackId: string) => Promise<void>;
	buildSearchIndex: (tracks: Array<{ id: string; title: string; artist: string; album: string }>) => Promise<void>;
	searchTracks: (query: string, limit: number) => Promise<Array<{ id: string; score: number }>>;
	addListener: (event: string, callback: (payload: unknown) => void) => { remove: () => void };
	removeListeners: (count: number) => void;
};

export default requireOptionalNativeModule<YhwavAudioModuleType>('YhwavAudio');
