import { useEffect, useMemo } from 'react';
import { useWaveformStore } from '@/hooks/useWaveformStore';

/**
 * Returns `buckets` normalized peaks (0..1) for a track. Prefers real waveform data
 * (persisted at download time) and falls back to a deterministic placeholder derived
 * from the track id so a given song always renders the same shape.
 *
 * @param smooth when true, applies a moving-average pass for a flowing silhouette.
 */
export function useTrackWaveform(songId: string | undefined, buckets: number, smooth = false): number[] {
	const ensureLoaded = useWaveformStore((state) => state.ensureLoaded);
	const raw = useWaveformStore((state) => (songId ? state.byId[songId] : null));

	useEffect(() => {
		if (songId) ensureLoaded(songId);
	}, [songId, ensureLoaded]);

	return useMemo(() => {
		const base = raw && raw.length > 0 ? resample(raw, buckets) : generateSeededPeaks(songId ?? 'default', buckets);
		const shaped = smooth ? movingAverage(base, 2) : base;
		// Perceptual curve so quiet passages stay visible. No floor here — a visible baseline
		// (if any) is controlled per-variant via minHeight so silence can collapse to nothing.
		return shaped.map((v) => v ** 0.7);
	}, [raw, buckets, songId, smooth]);
}

/** Resample an arbitrary-length peak array to `target` buckets by averaging groups. */
function resample(peaks: number[], target: number): number[] {
	if (peaks.length === target) return peaks;
	const out = new Array<number>(target);
	const ratio = peaks.length / target;
	for (let i = 0; i < target; i++) {
		const start = Math.floor(i * ratio);
		const end = Math.max(start + 1, Math.floor((i + 1) * ratio));
		let sum = 0;
		let count = 0;
		for (let j = start; j < end && j < peaks.length; j++) {
			sum += peaks[j];
			count++;
		}
		out[i] = count > 0 ? sum / count : 0;
	}
	return out;
}

function movingAverage(peaks: number[], radius: number): number[] {
	if (radius <= 0) return peaks;
	const out = new Array<number>(peaks.length);
	for (let i = 0; i < peaks.length; i++) {
		let sum = 0;
		let count = 0;
		for (let j = i - radius; j <= i + radius; j++) {
			if (j >= 0 && j < peaks.length) {
				sum += peaks[j];
				count++;
			}
		}
		out[i] = sum / count;
	}
	return out;
}

/** Deterministic placeholder peaks (0..1) from a seed string via mulberry32. */
function generateSeededPeaks(seed: string, count: number): number[] {
	let h = 2166136261;
	for (let i = 0; i < seed.length; i++) {
		h ^= seed.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	const rand = () => {
		h |= 0;
		h = (h + 0x6d2b79f5) | 0;
		let t = Math.imul(h ^ (h >>> 15), 1 | h);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};

	const peaks: number[] = [];
	for (let i = 0; i < count; i++) {
		const value = 0.25 + rand() * 0.55 + rand() * 0.2;
		peaks.push(Math.min(1, value));
	}
	return peaks;
}
