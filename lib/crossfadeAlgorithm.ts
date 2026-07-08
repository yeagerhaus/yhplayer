import type { LoudnessData } from '@/types/song';

export type CrossfadeDurationConfig = {
	defaultDuration: number;
	minDuration: number;
	maxDuration: number;
};

/**
 * Plexamp-style adaptive crossfade length from outgoing + incoming loudness metadata.
 */
export function computeCrossfadeDuration(
	outgoing: LoudnessData | undefined,
	incoming: LoudnessData | undefined,
	config: CrossfadeDurationConfig,
): number {
	if (!outgoing || !incoming) return config.defaultDuration;

	const outLRA = outgoing.lra;
	const inLRA = incoming.lra;
	const avgLRA = (outLRA + inLRA) / 2;

	const outPeakFactor = outgoing.peak < 0.7 ? 1.3 : 1.0;

	const loudnessGap = Math.abs(outgoing.loudness - incoming.loudness);
	const gapFactor = 1.0 + Math.min(loudnessGap / 20, 0.5);

	const lraDuration = config.minDuration + (avgLRA / 20) * (config.maxDuration - config.minDuration);

	const duration = lraDuration * outPeakFactor * gapFactor;
	return Math.max(config.minDuration, Math.min(config.maxDuration, duration));
}

/**
 * Linear gain to apply to the incoming track at the START of the overlap so it enters matched to the
 * outgoing track's integrated loudness (the native ramp eases this back to 1.0 by the end). Returns 1
 * (no adjustment) when either track lacks loudness metadata.
 */
export function computeIncomingLoudnessTrim(outgoing: LoudnessData | undefined, incoming: LoudnessData | undefined): number {
	if (!outgoing || !incoming) return 1;
	// loudness is integrated LUFS (negative). If the incoming track is louder, trim below 1 to match.
	const diffDb = outgoing.loudness - incoming.loudness;
	const linear = 10 ** (diffDb / 20);
	return Math.max(0.25, Math.min(4, linear));
}
