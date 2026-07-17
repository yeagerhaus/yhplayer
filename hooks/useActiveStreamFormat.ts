import * as Network from 'expo-network';
import { useEffect, useMemo, useState } from 'react';
import { useAudioStore } from '@/hooks/useAudioStore';
import { useMusicDownloadsStore } from '@/hooks/useMusicDownloadsStore';
import { getStreamingPlaybackBitrateKbps, usePlaybackSettingsStore } from '@/hooks/usePlaybackSettingsStore';
import { getCachedNetworkPlaybackRoute, type NetworkPlaybackRoute } from '@/lib/networkPlaybackRoute';

export interface ActiveStreamFormat {
	/** Codec/container label, e.g. "MP3", "FLAC", "AAC". */
	codec: string;
	/** Effective bitrate in kbps, or null when playing the original (uncapped) file. */
	bitrateKbps: number | null;
	/** True when the audio is coming from a local download instead of the network. */
	isLocal: boolean;
	/** Compact label suitable for display, e.g. "MP3 · 128 kbps" or "FLAC · Lossless". */
	label: string;
}

const LOSSLESS_CODECS = new Set(['FLAC', 'ALAC', 'WAV', 'AIFF']);

function codecFromUri(uri: string | undefined | null): string | null {
	if (!uri) return null;
	let path = uri;
	try {
		path = new URL(uri).pathname;
	} catch {
		// Not a full URL (e.g. a file path) — fall back to the raw string.
	}
	const dot = path.lastIndexOf('.');
	if (dot === -1) return null;
	const ext = path.slice(dot + 1).toLowerCase();
	switch (ext) {
		case 'mp3':
			return 'MP3';
		case 'flac':
			return 'FLAC';
		case 'alac':
			return 'ALAC';
		case 'm4a':
		case 'aac':
		case 'mp4':
			return 'AAC';
		case 'ogg':
		case 'oga':
			return 'Vorbis';
		case 'opus':
			return 'Opus';
		case 'wav':
			return 'WAV';
		case 'aiff':
		case 'aif':
			return 'AIFF';
		default:
			return null;
	}
}

/**
 * Best-effort description of what we're actually playing right now, derived from the same
 * decision logic as `songToTrack`: local download → the downloaded file's container; a Plex
 * remote stream with a bitrate cap → an MP3 transcode at that bitrate; otherwise the original file.
 *
 * This is inferred on the JS side (the native engine doesn't report the negotiated codec back),
 * so it tracks the streaming settings and network route rather than the decoded sample format.
 */
export function useActiveStreamFormat(): ActiveStreamFormat | null {
	const currentSong = useAudioStore((s) => s.currentSong);
	const streamingBitrateWifi = usePlaybackSettingsStore((s) => s.streamingBitrateWifi);
	const streamingBitrateCellular = usePlaybackSettingsStore((s) => s.streamingBitrateCellular);
	const streamingTranscodeCapKbps = usePlaybackSettingsStore((s) => s.streamingTranscodeCapKbps);
	const downloads = useMusicDownloadsStore((s) => s.downloads);

	const [route, setRoute] = useState<NetworkPlaybackRoute>(getCachedNetworkPlaybackRoute());

	useEffect(() => {
		let mounted = true;
		Network.getNetworkStateAsync()
			.then((s) => {
				if (!mounted) return;
				if (s.isConnected === false) return setRoute('unknown');
				if (s.type === Network.NetworkStateType.CELLULAR) return setRoute('cellular');
				if (s.type === Network.NetworkStateType.WIFI || s.type === Network.NetworkStateType.ETHERNET) return setRoute('wifi');
				setRoute('unknown');
			})
			.catch(() => {});
		const sub = Network.addNetworkStateListener((event) => {
			if (event.type === Network.NetworkStateType.CELLULAR) setRoute('cellular');
			else if (event.type === Network.NetworkStateType.WIFI || event.type === Network.NetworkStateType.ETHERNET) setRoute('wifi');
			else setRoute('unknown');
		});
		return () => {
			mounted = false;
			sub.remove();
		};
	}, []);

	return useMemo<ActiveStreamFormat | null>(() => {
		if (!currentSong) return null;

		const localUri = currentSong.localUri || downloads[currentSong.id]?.localUri;
		if (localUri) {
			const codec = codecFromUri(localUri) ?? 'Audio';
			const label = LOSSLESS_CODECS.has(codec) ? `${codec} · Lossless` : `${codec} · Downloaded`;
			return { codec, bitrateKbps: null, isLocal: true, label };
		}

		// Podcasts stream directly; report the container without a bitrate cap.
		if (currentSong.source === 'podcast') {
			const codec = codecFromUri(currentSong.uri) ?? 'Stream';
			return { codec, bitrateKbps: null, isLocal: false, label: codec };
		}

		const bitrate = getStreamingPlaybackBitrateKbps(streamingBitrateWifi, streamingBitrateCellular, streamingTranscodeCapKbps, route);

		// A cap means Plex transcodes to MP3 at that ceiling (see buildPlexStreamUrl / start.mp3).
		if (bitrate !== null) {
			return { codec: 'MP3', bitrateKbps: bitrate, isLocal: false, label: `MP3 · ${bitrate} kbps` };
		}

		// Uncapped → direct play of the original file. Codec inferred from the source URL when possible.
		const codec = codecFromUri(currentSong.uri);
		if (codec) {
			const label = LOSSLESS_CODECS.has(codec) ? `${codec} · Lossless` : `${codec} · Original`;
			return { codec, bitrateKbps: null, isLocal: false, label };
		}
		return { codec: 'Original', bitrateKbps: null, isLocal: false, label: 'Original' };
	}, [currentSong, downloads, streamingBitrateWifi, streamingBitrateCellular, streamingTranscodeCapKbps, route]);
}
