/**
 * Player: yhwav-audio native module (AVAudioEngine, gapless + optional Sweet Fades crossfade).
 * Exposes Event/State/RepeatMode etc. and the same API shape for useAudioStore and components.
 */

import React from 'react';
import { isAvailable, YhwavAudioModule } from '@/modules/yhwav-audio';

export const Event = {
	PlaybackProgressUpdated: 'playback-progress-updated',
	PlaybackQueueEnded: 'playback-queue-ended',
	PlaybackActiveTrackChanged: 'playback-active-track-changed',
	PlaybackError: 'playback-error',
	RemotePlay: 'remote-play',
	RemotePause: 'remote-pause',
	RemoteNext: 'remote-next',
	RemotePrevious: 'remote-previous',
	RemoteSeek: 'remote-seek',
} as const;

export const State = {
	None: 'none',
	Ready: 'ready',
	Playing: 'playing',
	Paused: 'paused',
	Stopped: 'stopped',
	Loading: 'loading',
	Connecting: 'loading',
	Buffering: 'buffering',
	Error: 'error',
	Ended: 'ended',
} as const;

export const RepeatMode = {
	Off: 0,
	Track: 1,
	Queue: 2,
} as const;

export const Capability = {
	Play: 'Play',
	Pause: 'Pause',
	SkipToNext: 'SkipToNext',
	SkipToPrevious: 'SkipToPrevious',
	SeekTo: 'SeekTo',
} as const;

export const IOSCategory = {
	Playback: 'playback',
} as const;

export const IOSCategoryMode = {
	Default: 'default',
} as const;

function getPlayer() {
	if (!isAvailable() || !YhwavAudioModule) return null;
	return YhwavAudioModule;
}

// Track shape: { id, url, title, artist, artwork, duration }
type TrackLike = {
	id: string;
	url: string;
	directUrl?: string;
	title?: string;
	artist?: string;
	artwork?: string;
	duration?: number;
	crossfadeDisabled?: boolean;
};

export type CrossfadeConfigNative = {
	enabled: boolean;
	defaultDuration: number;
	minDuration: number;
	maxDuration: number;
	fadeInOnManualSkip: boolean;
	manualSkipFadeDuration: number;
	/** 0 equal-power, 1 linear, 2 logarithmic, 3 S-curve. */
	curve: 0 | 1 | 2 | 3;
	lowpassTail: boolean;
};

const TrackPlayer = {
	async setupPlayer(options: Record<string, unknown>) {
		const p = getPlayer();
		if (p?.setupPlayer) await p.setupPlayer(options);
	},

	async updateOptions(options: Record<string, unknown>) {
		const p = getPlayer();
		if (p?.updateOptions) await p.updateOptions(options);
	},

	async add(tracks: TrackLike | TrackLike[], index?: number) {
		const p = getPlayer();
		if (!p) return;
		const list = Array.isArray(tracks) ? tracks : [tracks];
		// insertAfterIndex = insert after that index (so index 0 → insert after -1 / at start)
		const insertAfter = index != null && index > 0 ? index - 1 : undefined;
		await p.add(list, insertAfter);
	},

	async reset() {
		const p = getPlayer();
		if (p?.reset) await p.reset();
	},

	async remove(indexOrIndices: number | number[]) {
		const p = getPlayer();
		if (!p) return;
		const indices = Array.isArray(indexOrIndices) ? indexOrIndices : [indexOrIndices];
		await p.remove(indices);
	},

	async removeUpcomingTracks() {
		const p = getPlayer();
		if (p?.removeUpcomingTracks) await p.removeUpcomingTracks();
	},

	async move(fromIndex: number, toIndex: number) {
		const p = getPlayer();
		if (p?.move) await p.move(fromIndex, toIndex);
	},

	async skip(index: number, options?: { startPaused?: boolean; startAtSeconds?: number }) {
		const p = getPlayer();
		if (p?.skip) await p.skip(index, options?.startPaused ?? false, options?.startAtSeconds ?? 0);
	},

	async play() {
		const p = getPlayer();
		if (p?.play) await p.play();
	},

	async pause() {
		const p = getPlayer();
		if (p?.pause) await p.pause();
	},

	async seekTo(position: number) {
		const p = getPlayer();
		if (p?.seekTo) await p.seekTo(position);
	},

	async setVolume(volume: number) {
		const p = getPlayer();
		if (p?.setVolume) await p.setVolume(volume);
	},

	async setRate(rate: number) {
		const p = getPlayer();
		if (p?.setRate) await p.setRate(rate);
	},

	async setRepeatMode(mode: number) {
		const p = getPlayer();
		if (p?.setRepeatMode) await p.setRepeatMode(mode);
	},

	async setEqualizerBands(bands: Array<{ frequency: number; gain: number }>) {
		const p = getPlayer();
		if (p?.setEqualizerBands) await p.setEqualizerBands(bands);
	},

	async setEqualizerEnabled(enabled: boolean) {
		const p = getPlayer();
		if (p?.setEqualizerEnabled) await p.setEqualizerEnabled(enabled);
	},

	async setOutputGain(gainDb: number) {
		const p = getPlayer();
		if (p?.setOutputGain) await p.setOutputGain(gainDb);
	},

	async setNormalizationEnabled(enabled: boolean) {
		const p = getPlayer();
		if (p?.setNormalizationEnabled) await p.setNormalizationEnabled(enabled);
	},

	async setMonoAudioEnabled(enabled: boolean) {
		const p = getPlayer();
		if (p?.setMonoAudioEnabled) await p.setMonoAudioEnabled(enabled);
	},

	async setCrossfadeConfig(config: CrossfadeConfigNative) {
		const p = getPlayer();
		if (p?.setCrossfadeConfig) await p.setCrossfadeConfig(config);
	},

	async setNextCrossfadeDuration(seconds: number) {
		const p = getPlayer();
		if (p?.setNextCrossfadeDuration) await p.setNextCrossfadeDuration(seconds);
	},

	async setNextCrossfadeTrim(trim: number) {
		const p = getPlayer();
		if (p?.setNextCrossfadeTrim) await p.setNextCrossfadeTrim(trim);
	},

	async getPlaybackState() {
		const p = getPlayer();
		if (!p) return { state: State.Stopped, position: 0, duration: 0, buffered: undefined };
		const s = p.getPlaybackState();
		return { state: s.state, position: s.position, duration: s.duration, buffered: s.buffered };
	},

	async getActiveTrackIndex(): Promise<number | undefined> {
		const p = getPlayer();
		if (!p) return undefined;
		const idx = p.getActiveTrackIndex();
		return idx >= 0 ? idx : undefined;
	},

	async getQueue() {
		const p = getPlayer();
		if (!p) return [];
		return p.getQueue();
	},
};

const NATIVE_EVENT_TO_EVENT: Record<string, string> = {
	PlaybackProgressUpdated: Event.PlaybackProgressUpdated,
	PlaybackQueueEnded: Event.PlaybackQueueEnded,
	PlaybackActiveTrackChanged: Event.PlaybackActiveTrackChanged,
	PlaybackError: Event.PlaybackError,
	RemotePlay: Event.RemotePlay,
	RemotePause: Event.RemotePause,
	RemoteNext: Event.RemoteNext,
	RemotePrevious: Event.RemotePrevious,
	RemoteSeek: Event.RemoteSeek,
};

export function usePlaybackState(): { state: string } {
	const [playbackState, setPlaybackState] = React.useState<{ state: string }>({ state: State.None });

	React.useEffect(() => {
		const mod = YhwavAudioModule;
		if (!isAvailable() || mod == null) return;
		const update = () => {
			const s = mod.getPlaybackState();
			setPlaybackState((prev) => (prev.state !== s.state ? { state: s.state } : prev));
		};
		update();
		const sub = mod.addListener('PlaybackProgressUpdated', update);
		return () => sub.remove();
	}, []);

	return playbackState;
}

type EventType = (typeof Event)[keyof typeof Event];
type EventCallback = (event: { type: string; position?: number; duration?: number; index?: number; previousTrackEndedAt?: number }) => void;

export function useTrackPlayerEvents(events: EventType[], callback: EventCallback) {
	const callbackRef = React.useRef(callback);
	callbackRef.current = callback;

	React.useEffect(() => {
		if (!isAvailable() || !YhwavAudioModule) return;
		const subscriptions: { remove: () => void }[] = [];
		for (const eventName of events) {
			const nativeName = Object.keys(NATIVE_EVENT_TO_EVENT).find((k) => NATIVE_EVENT_TO_EVENT[k] === eventName);
			if (!nativeName) continue;
			const sub = YhwavAudioModule.addListener(nativeName, (payload: unknown) => {
				const p = payload as Record<string, unknown>;
				const toNum = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
				const idx = p?.track ?? p?.index;
				callbackRef.current({
					type: eventName,
					position: toNum(p?.position),
					duration: toNum(p?.duration),
					index: typeof idx === 'number' ? idx : undefined,
					previousTrackEndedAt: toNum(p?.previousTrackEndedAt),
				});
			});
			subscriptions.push(sub);
		}
		return () => subscriptions.forEach((s) => s.remove());
	}, [events.join(',')]);
}

export default TrackPlayer;
