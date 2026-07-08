import type { Song } from '@/types';

/** Origin (scheme + host[:port]) from a Plex stream URL; works before plexClient.initialize(). */
export function plexOriginFromDirectUrl(directUrl: string): string | null {
	try {
		const u = new URL(directUrl);
		if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
		if (!u.host) return null;
		return `${u.protocol}//${u.host}`;
	} catch {
		return null;
	}
}

export function plexTokenFromUrl(directUrl: string): string | null {
	try {
		return new URL(directUrl).searchParams.get('X-Plex-Token');
	} catch {
		return null;
	}
}

/**
 * Build a Plex universal transcode URL so the server sends a smaller
 * MP3 instead of the original lossless file.
 *
 * `sessionId` must be unique per concurrent request. The universal transcoder keys sessions by
 * client, so parallel `start.mp3` requests that share a session cause Plex to kill each other's
 * transcode mid-stream (truncated files / NSURLError -1017). Pass a distinct id per parallel
 * download to keep them independent.
 */
export function buildPlexTranscodeUrl(ratingKey: string, maxBitrate: number, referenceUrl: string, sessionId?: string): string | null {
	const { plexClient } = require('@/utils/plex-client');
	const { plexAuthService } = require('@/utils/plex-auth');
	const { encodePlexIdentityQueryString, buildPlexIdentityHeaders } = require('@/utils/plex-identity');

	const conn = plexClient.getConnectionInfo();
	const baseURL = conn?.baseURL ?? plexOriginFromDirectUrl(referenceUrl);
	const token = conn?.token ?? plexAuthService.getAccessToken() ?? plexTokenFromUrl(referenceUrl) ?? '';
	if (!baseURL || !token) return null;

	const clientId = plexAuthService.getClientIdentifier();
	const identityQs = encodePlexIdentityQueryString(buildPlexIdentityHeaders(clientId));

	const sessionQs = sessionId
		? `&session=${encodeURIComponent(sessionId)}&X-Plex-Session-Identifier=${encodeURIComponent(sessionId)}`
		: '';

	return (
		`${baseURL}/music/:/transcode/universal/start.mp3` +
		`?path=${encodeURIComponent(`/library/metadata/${ratingKey}`)}` +
		`&mediaIndex=0&partIndex=0` +
		`&protocol=http` +
		`&directPlay=0&directStream=1` +
		`&maxAudioBitrate=${maxBitrate}` +
		sessionQs +
		`&X-Plex-Token=${encodeURIComponent(token)}` +
		`&${identityQs}`
	);
}

/**
 * Apply max audio bitrate for remote Plex music (transcode URL or direct + query).
 * Podcasts and non-Plex URLs are unchanged.
 */
export function buildPlexStreamUrl(
	song: Pick<Song, 'id' | 'source' | 'uri'>,
	referenceUrl: string,
	maxBitrate: number | null,
	sessionId?: string,
): { url: string; directUrl?: string } {
	if (song.source === 'podcast' || !referenceUrl.includes('X-Plex-Token')) {
		return { url: referenceUrl };
	}
	if (maxBitrate === null) {
		return { url: referenceUrl };
	}

	const transcodeUrl = buildPlexTranscodeUrl(song.id, maxBitrate, referenceUrl, sessionId);
	if (transcodeUrl) {
		const raw = typeof song.uri === 'string' ? song.uri.trim() : '';
		if (raw.length > 0 && raw.includes('X-Plex-Token')) {
			return { url: transcodeUrl, directUrl: raw };
		}
		return { url: transcodeUrl };
	}

	return { url: `${referenceUrl}&maxAudioBitrate=${maxBitrate}` };
}
