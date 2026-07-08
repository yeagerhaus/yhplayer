import { fetch } from 'expo/fetch';
import { getIsOfflineMode } from '@/hooks/useOfflineModeStore';
import type { Album } from '@/types/album';
import type { Artist } from '@/types/artist';
import type { HomeHub } from '@/types/home';
import type { Playlist } from '@/types/playlist';
import type { LoudnessData, Song } from '@/types/song';
import { plexAuthService } from './plex-auth';
import { plexDiscoveryService } from './plex-discovery';
import { appendPlexIdentityQueryToUrl, buildPlexIdentityHeaders, encodePlexIdentityQueryString, getPlexAppVersion } from './plex-identity';

const OFFLINE_MODE_MESSAGE = 'Offline mode is on. Disable in Settings to fetch library data.';

// Retry configuration
const RETRY_CONFIG = {
	maxRetries: 3,
	baseDelay: 1000, // 1 second
	maxDelay: 10000, // 10 seconds
	backoffMultiplier: 2,
};

// Timeout configuration
const TIMEOUT_CONFIG = {
	connectTimeout: 15000, // 15 seconds
	requestTimeout: 30000, // 30 seconds
};

export interface PlexError extends Error {
	code?: string;
	status?: number;
	retryable?: boolean;
}

export interface PlexResponse<T = any> {
	data: T;
	status: number;
	headers: Record<string, string>;
}

/**
 * Creates a robust Plex client with SSL handling, retry logic, and JSON support
 */
export class PlexClient {
	private baseURL: string = '';
	private token: string | null = null;
	private musicSectionId: string | null = null;
	private initialized: boolean = false;
	private initPromise: Promise<void> | null = null;

	constructor(baseURL?: string) {
		if (baseURL) {
			this.baseURL = baseURL.replace(/\/$/, ''); // Remove trailing slash
		}
	}

	/**
	 * Initialize the client with authentication (cached to avoid repeated calls)
	 */
	async initialize(): Promise<void> {
		if (getIsOfflineMode()) {
			throw new Error(OFFLINE_MODE_MESSAGE);
		}
		// Return cached promise if already initializing
		if (this.initPromise) {
			return this.initPromise;
		}

		// If already initialized and server hasn't changed, skip
		if (this.initialized) {
			const selectedServer = plexAuthService.getSelectedServer();
			if (selectedServer && this.baseURL && this.token) {
				return;
			}
			// Server changed, need to re-initialize
			this.initialized = false;
		}

		this.initPromise = this._doInitialize();
		try {
			await this.initPromise;
			this.initialized = true;
		} finally {
			this.initPromise = null;
		}
	}

	/**
	 * Internal initialization logic
	 */
	private async _doInitialize(): Promise<void> {
		if (!plexAuthService.isAuthenticated()) {
			throw new Error('No Plex authentication available. Please sign in through Settings.');
		}

		const selectedServer = plexAuthService.getSelectedServer();
		if (!selectedServer) {
			throw new Error('No Plex server selected. Please select a server in Settings.');
		}

		if (!selectedServer.uri) {
			throw new Error(`Server "${selectedServer.name}" has no valid URI. Please refresh servers in Settings.`);
		}

		// Validate and clean the server URI
		let serverUri = selectedServer.uri.trim();

		// Remove any existing API paths and ensure we have just the base server URL
		serverUri = serverUri
			.replace(/\/playlists.*$/, '')
			.replace(/\/library.*$/, '')
			.replace(/\/status.*$/, '')
			.replace(/\/$/, '');

		// Validate URI format - must have protocol and hostname
		if (!serverUri.match(/^https?:\/\/.+/)) {
			// If URI is missing hostname, try to construct it from address and port
			if (selectedServer.address && selectedServer.port) {
				const protocol = selectedServer.local ? 'http' : 'https';
				serverUri = `${protocol}://${selectedServer.address}:${selectedServer.port}`;
			} else {
				throw new Error(
					`Invalid server URI format: "${selectedServer.uri}". Server: ${selectedServer.name}. Please refresh servers in Settings.`,
				);
			}
		}

		this.baseURL = serverUri;
		this.token = plexAuthService.getAccessToken() || '';

		// Verify the stored URI is reachable; if not, try alternative connections
		const reachable = await plexDiscoveryService.testServerConnection(selectedServer, this.token);
		if (reachable) {
			// testServerConnection may have updated the server URI to a working one
			this.baseURL = selectedServer.uri.replace(/\/$/, '');
		} else {
			console.warn('⚠️ No reachable connection found — using stored URI as fallback');
		}

		// Music section ID will be auto-discovered when needed
		this.musicSectionId = null;
	}

	/**
	 * Silently re-test the current connection and switch to a working URI if needed.
	 * Called when the app returns to the foreground so stale local/remote URIs are swapped out.
	 */
	async refreshConnectionIfNeeded(): Promise<void> {
		if (!this.initialized || !this.baseURL || !this.token) return;

		const token = this.token;
		const currentBase = this.baseURL;

		// Quick check: is the current baseURL still reachable?
		try {
			let testUrl = `${currentBase}/identity?X-Plex-Token=${encodeURIComponent(token)}`;
			testUrl = appendPlexIdentityQueryToUrl(testUrl, plexAuthService.getClientIdentifier());
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 3000);
			const response = await fetch(testUrl, {
				signal: controller.signal,
				headers: buildPlexIdentityHeaders(plexAuthService.getClientIdentifier()),
			});
			clearTimeout(timeoutId);
			if (response.ok) return; // Still connected
		} catch {
			// Fall through to reconnect
		}

		console.log('🔄 Connection lost, attempting to find a working URI...');

		const selectedServer = plexAuthService.getSelectedServer();
		if (!selectedServer) return;

		const reachable = await plexDiscoveryService.testServerConnection(selectedServer, token);
		if (reachable) {
			const newBase = selectedServer.uri.replace(/\/$/, '');
			if (newBase !== currentBase) {
				console.log(`🔄 Switching connection: ${currentBase} → ${newBase}`);
			}
			this.baseURL = newBase;
		}
	}

	/**
	 * Clear initialization cache (call when server changes)
	 */
	clearInitialization(): void {
		this.initialized = false;
		this.initPromise = null;
		this.baseURL = '';
		this.token = null;
		this.musicSectionId = null;
	}

	/**
	 * Auto-discover music section ID from library
	 */
	private async discoverMusicSection(): Promise<void> {
		const sections = await this.getLibrarySections();
		const musicSection = sections.find((section: any) => section.type === 'artist' || section.type === 'music');
		if (musicSection) {
			this.musicSectionId = musicSection.key;
		} else {
			throw new Error('No music section found in library');
		}
	}

	/**
	 * Fast-path URL builder for track formatting.
	 * Uses string concatenation instead of `new URL()` — avoids ~86k URL object
	 * constructions when formatting a 43k-track library.
	 */
	private buildTrackURL(path: string): string {
		const normalizedPath = path.startsWith('/') ? path : `/${path}`;
		const id = plexAuthService.getClientIdentifier();
		const identityQs = encodePlexIdentityQueryString(buildPlexIdentityHeaders(id));
		if (this.token) {
			return `${this.baseURL}${normalizedPath}?X-Plex-Token=${encodeURIComponent(this.token)}&${identityQs}`;
		}
		return `${this.baseURL}${normalizedPath}?${identityQs}`;
	}

	/**
	 * Build a Plex URL with authentication and parameters
	 */
	private buildURL(path: string, params: Record<string, string> = {}): string {
		// Validate baseURL before using it
		if (!this.baseURL || !this.baseURL.match(/^https?:\/\/.+/)) {
			throw new Error(`Invalid baseURL: "${this.baseURL}". Please ensure you are authenticated and have selected a valid server.`);
		}

		// Ensure path starts with /
		const normalizedPath = path.startsWith('/') ? path : `/${path}`;

		const url = new URL(`${this.baseURL}${normalizedPath}`);

		// Add authentication token
		if (this.token) {
			url.searchParams.set('X-Plex-Token', this.token);
		}

		const clientId = plexAuthService.getClientIdentifier();
		for (const [key, value] of Object.entries(buildPlexIdentityHeaders(clientId))) {
			url.searchParams.set(key, value);
		}

		// Add additional parameters
		for (const [key, value] of Object.entries(params)) {
			url.searchParams.set(key, value);
		}

		return url.toString();
	}

	/**
	 * Create an AbortController with timeout
	 */
	private createTimeoutController(timeout: number): AbortController {
		const controller = new AbortController();
		setTimeout(() => controller.abort(), timeout);
		return controller;
	}

	/**
	 * Sleep utility for retry delays
	 */
	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	/**
	 * Calculate retry delay with exponential backoff
	 */
	private calculateRetryDelay(attempt: number): number {
		const delay = Math.min(RETRY_CONFIG.baseDelay * RETRY_CONFIG.backoffMultiplier ** attempt, RETRY_CONFIG.maxDelay);
		// Add jitter to prevent thundering herd
		return delay + Math.random() * 1000;
	}

	/**
	 * Check if an error is retryable
	 */
	private isRetryableError(error: any): boolean {
		// Network errors, timeouts, and 5xx server errors are retryable
		if (error.name === 'AbortError' || error.message?.includes('timeout')) {
			return true;
		}
		if (error.message?.includes('Network request failed')) {
			return true;
		}
		if (error.status >= 500) {
			return true;
		}
		// SSL certificate errors are retryable
		if (error.message?.includes('certificate') || error.message?.includes('SSL') || error.message?.includes('TLS')) {
			return true;
		}
		return false;
	}

	/**
	 * Try HTTP fallback if HTTPS fails with SSL error
	 */
	private getFallbackUrl(originalUrl: string): string | null {
		if (originalUrl.startsWith('https://') && originalUrl.includes('.plex.direct')) {
			return originalUrl.replace('https://', 'http://');
		}
		return null;
	}

	/**
	 * Make a robust HTTP request with retry logic and SSL handling
	 */
	async request<T = any>(
		path: string,
		params: Record<string, string> = {},
		options: {
			method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
			headers?: Record<string, string>;
			timeout?: number;
			retries?: number;
		} = {},
	): Promise<PlexResponse<T>> {
		if (getIsOfflineMode()) {
			throw new Error(OFFLINE_MODE_MESSAGE);
		}
		const { method = 'GET', headers = {}, timeout = TIMEOUT_CONFIG.requestTimeout, retries = RETRY_CONFIG.maxRetries } = options;

		const url = this.buildURL(path, params);

		const clientId = plexAuthService.getClientIdentifier();
		const defaultHeaders = {
			Accept: 'application/json',
			'User-Agent': `Rite/${getPlexAppVersion()}`,
			...buildPlexIdentityHeaders(clientId),
			...headers,
		};

		let lastError: any;
		let triedHttpFallback = false;

		for (let attempt = 0; attempt <= retries; attempt++) {
			try {
				const controller = this.createTimeoutController(timeout);

				// For React Native, we need to handle SSL certificate issues differently
				// The issue is that Plex's dynamic DNS certificates don't match the hostname
				// Since CURL works with -k flag, we'll try the original URL first
				// and handle SSL errors gracefully with retry logic
				let requestUrl = url;
				const additionalHeaders = {};

				// Try HTTP fallback if this is a retry after SSL error
				if (attempt > 0 && lastError?.message?.includes('TLS') && !triedHttpFallback) {
					const fallbackUrl = this.getFallbackUrl(url);
					if (fallbackUrl) {
						requestUrl = fallbackUrl;
						triedHttpFallback = true;
					}
				}

				// Add SSL handling for React Native
				const fetchOptions: any = {
					method,
					headers: { ...defaultHeaders, ...additionalHeaders },
					signal: controller.signal,
				};

				const response = await fetch(requestUrl, fetchOptions);

				// Handle HTTP errors
				if (!response.ok) {
					const errorText = await response.text().catch(() => 'Unknown error');
					const error: PlexError = new Error(`[${requestUrl}] - ${response.status}: ${errorText}`);
					error.status = response.status;
					error.code = `HTTP_${response.status}`;
					error.retryable = response.status >= 500;

					// Don't retry on 4xx errors (except 408, 429)
					if (response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status)) {
						throw error;
					}

					lastError = error;
					if (attempt < retries && error.retryable) {
						await this.sleep(this.calculateRetryDelay(attempt));
						continue;
					}
					throw error;
				}

				// Parse response
				const contentType = response.headers.get('content-type') || '';
				let data: T;

				if (contentType.includes('application/json')) {
					data = await response.json();
				} else {
					// Fallback to text for non-JSON responses
					data = (await response.text()) as T;
				}

				// Extract response headers
				const responseHeaders: Record<string, string> = {};
				response.headers.forEach((value, key) => {
					responseHeaders[key] = value;
				});

				return {
					data,
					status: response.status,
					headers: responseHeaders,
				};
			} catch (error: any) {
				lastError = error;

				// Check if this is the last attempt
				if (attempt >= retries) {
					break;
				}

				// Check if error is retryable
				if (!this.isRetryableError(error)) {
					break;
				}

				// For SSL/TLS errors, provide helpful guidance
				if (error.message?.includes('TLS') || error.message?.includes('certificate') || error.message?.includes('SSL')) {
					console.log('🔧 SSL Certificate Issue Detected!');
					console.log('💡 Try these Plex server settings:');
					console.log('   1. Set "Custom certificate domain" to your hostname');
					console.log('   2. Uncheck "Strict TLS configuration"');
					console.log('   3. Or use "Custom certificate location" with a matching cert');
				}

				// Wait before retrying
				await this.sleep(this.calculateRetryDelay(attempt));
			}
		}

		// If we get here, all retries failed
		throw lastError || new Error('Request failed after all retries');
	}

	/**
	 * Test Plex server connectivity
	 */
	async testConnectivity(): Promise<boolean> {
		try {
			await this.initialize();

			// Try a simple status endpoint first
			const response = await this.request(
				'/status/sessions',
				{},
				{
					timeout: TIMEOUT_CONFIG.connectTimeout,
					retries: 1, // Only retry once for connectivity test
				},
			);

			return response.status === 200;
		} catch (error) {
			console.error('Plex connectivity test failed:', error);
			return false;
		}
	}

	/**
	 * Fetch all tracks from the music library (type 10)
	 */
	async fetchAllTracks(): Promise<Song[]> {
		await this.initialize();

		// Auto-discover music section if not set
		if (!this.musicSectionId) {
			await this.discoverMusicSection();
		}

		if (!this.musicSectionId) {
			throw new Error('Music section ID not found. Please ensure your library has a music section.');
		}

		// Optimize request: only fetch essential fields to reduce payload size
		// This significantly speeds up large library fetches
		const response = await this.request(`/library/sections/${this.musicSectionId}/all`, {
			type: '10', // 10 = track
			sort: 'titleSort:asc',
			includeFields:
				'title,ratingKey,thumb,art,duration,index,parentIndex,parentRatingKey,grandparentTitle,parentTitle,grandparentKey,parentKey,Media',
			// Loudness / ReplayGain live on Stream elements under Media → Part
			includeStreamDetails: '1',
		});

		const data = response.data as any;
		const rawTracks = data?.MediaContainer?.Metadata || [];
		const tracksArray = Array.isArray(rawTracks) ? rawTracks : [rawTracks];

		// Process in batches, yielding between chunks so the JS thread
		// can service UI events (scrolling, animations) during large fetches.
		const BATCH_SIZE = 5000;
		const results: Song[] = new Array(tracksArray.length);

		for (let i = 0; i < tracksArray.length; i += BATCH_SIZE) {
			const end = Math.min(i + BATCH_SIZE, tracksArray.length);
			for (let j = i; j < end; j++) {
				results[j] = this.formatTrack(tracksArray[j]);
			}
			// Yield to the event loop between batches
			if (end < tracksArray.length) {
				await new Promise<void>((r) => setTimeout(r, 0));
			}
		}

		return results;
	}

	/**
	 * Fetch recently played tracks (type 10, sorted by lastViewedAt desc)
	 */
	async fetchRecentlyPlayed(limit = 25): Promise<Song[]> {
		await this.initialize();

		if (!this.musicSectionId) {
			await this.discoverMusicSection();
		}

		if (!this.musicSectionId) {
			throw new Error('Music section ID not found. Please ensure your library has a music section.');
		}

		const response = await this.request(`/library/sections/${this.musicSectionId}/all`, {
			type: '10',
			sort: 'lastViewedAt:desc',
			'X-Plex-Container-Start': '0',
			'X-Plex-Container-Size': String(limit),
			includeStreamDetails: '1',
		});

		const data = response.data as any;
		const rawTracks = data?.MediaContainer?.Metadata || [];
		const tracksArray = Array.isArray(rawTracks) ? rawTracks : [rawTracks];
		return tracksArray.map((track) => this.formatTrack(track));
	}

	/**
	 * Fetch home hubs for the music section — "Mixes For You", radio stations,
	 * recently added, etc. (GET /hubs/sections/{sectionId}). Returns normalized
	 * hubs grouped by content type; hubs with no usable items are dropped.
	 */
	async fetchSectionHubs(count = 12): Promise<HomeHub[]> {
		await this.initialize();

		if (!this.musicSectionId) {
			await this.discoverMusicSection();
		}

		if (!this.musicSectionId) {
			throw new Error('Music section ID not found. Please ensure your library has a music section.');
		}

		const response = await this.request(`/hubs/sections/${this.musicSectionId}`, {
			includeMyMixes: '1',
			includeStations: '1',
			count: String(count),
		});

		const data = response.data as any;
		const rawHubs = data?.MediaContainer?.Hub;
		if (!rawHubs) return [];
		const hubList = Array.isArray(rawHubs) ? rawHubs : [rawHubs];

		const hubs: HomeHub[] = [];
		for (const hub of hubList) {
			const rawMeta = hub?.Metadata;
			if (!rawMeta) continue;
			const items = Array.isArray(rawMeta) ? rawMeta : [rawMeta];

			const tracks: Song[] = [];
			const albums: Album[] = [];
			const playlists: Playlist[] = [];

			for (const item of items) {
				try {
					switch (item?.type) {
						case 'track':
							tracks.push(this.formatTrack(item));
							break;
						case 'album':
							albums.push(this.formatAlbum(item));
							break;
						case 'playlist':
						case 'mix':
							playlists.push(this.formatPlaylist(item));
							break;
						default:
							// Mixes/stations sometimes arrive without a type but carry a playlist key.
							if (typeof item?.key === 'string' && (item.playlistType === 'audio' || item.key.includes('/playlists/'))) {
								playlists.push(this.formatPlaylist(item));
							}
							break;
					}
				} catch {
					// Skip malformed hub items rather than failing the whole hub.
				}
			}

			if (tracks.length === 0 && albums.length === 0 && playlists.length === 0) continue;

			hubs.push({
				id: hub.hubIdentifier || hub.key || hub.title || `hub-${hubs.length}`,
				title: hub.title || '',
				identifier: hub.hubIdentifier || '',
				style: hub.style,
				type: hub.type,
				tracks,
				albums,
				playlists,
			});
		}

		return hubs;
	}

	/**
	 * Fetch all artists from the music library (type 8)
	 */
	async fetchAllArtists(): Promise<Artist[]> {
		await this.initialize();

		// Auto-discover music section if not set
		if (!this.musicSectionId) {
			await this.discoverMusicSection();
		}

		if (!this.musicSectionId) {
			throw new Error('Music section ID not found. Please ensure your library has a music section.');
		}

		const response = await this.request(`/library/sections/${this.musicSectionId}/all`, {
			type: '8', // 8 = artist
			sort: 'titleSort:asc',
		});

		const data = response.data as any;
		const raw = data?.MediaContainer?.Metadata || [];
		const rawArray = Array.isArray(raw) ? raw : [raw];
		return rawArray.map((item) => this.formatArtist(item));
	}

	/**
	 * Fetch all albums from the music library (type 9)
	 */
	async fetchAllAlbums(): Promise<Album[]> {
		await this.initialize();

		// Auto-discover music section if not set
		if (!this.musicSectionId) {
			await this.discoverMusicSection();
		}

		if (!this.musicSectionId) {
			throw new Error('Music section ID not found. Please ensure your library has a music section.');
		}

		const response = await this.request(`/library/sections/${this.musicSectionId}/all`, {
			type: '9', // 9 = album
			sort: 'titleSort:asc',
		});

		const data = response.data as any;
		const raw = data?.MediaContainer?.Metadata || [];
		const rawArray = Array.isArray(raw) ? raw : [raw];
		return rawArray.map((item) => this.formatAlbum(item));
	}

	private parseLoudnessData(media: any): LoudnessData | undefined {
		const part = media?.Part?.[0];
		const raw = part?.Stream;
		if (raw == null) return undefined;
		const streams = Array.isArray(raw) ? raw : [raw];
		const audio = streams.find(
			(s: any) =>
				s &&
				(s.streamType === 2 ||
					s.streamType === '2' ||
					(s.loudness != null && s.loudness !== '') ||
					(s.lra != null && s.lra !== '')),
		);
		if (!audio) return undefined;

		const num = (v: unknown): number | undefined => {
			if (v == null || v === '') return undefined;
			const x = typeof v === 'string' ? Number.parseFloat(v) : Number(v);
			return Number.isFinite(x) ? x : undefined;
		};

		const loudness = num(audio.loudness);
		const gain = num(audio.gain);
		const peak = num(audio.peak);
		const lra = num(audio.lra);
		const albumGain = num(audio.albumGain);
		const albumPeak = num(audio.albumPeak);
		const albumRange = num(audio.albumRange);

		if (loudness == null && gain == null && peak == null && lra == null) {
			return undefined;
		}

		return {
			loudness: loudness ?? 0,
			gain: gain ?? 0,
			peak: peak ?? 0,
			lra: lra ?? 0,
			albumGain: albumGain ?? 0,
			albumPeak: albumPeak ?? 0,
			albumRange: albumRange ?? 0,
		};
	}

	/**
	 * Format a Plex track into our Song type
	 */
	private formatTrack(track: any, playlistIndex?: number): Song {
		if (!track || !track.ratingKey) {
			throw new Error('Invalid track data');
		}

		const media = track.Media?.[0];
		const part = media?.Part?.[0];
		const duration = parseInt(track.duration || part?.duration || '0', 10);

		// Build stream URL (fast path — no URL parsing overhead)
		const streamUrl = part?.key ? this.buildTrackURL(part.key) : '';

		// Build artwork URL (prefer thumb, fallback to art)
		const artworkUrl = track.thumb ? this.buildTrackURL(track.thumb) : track.art ? this.buildTrackURL(track.art) : undefined;

		const title = track.title || 'Unknown Title';
		const artist = track.grandparentTitle || 'Unknown Artist';
		const album = track.parentTitle || '';
		const loudnessData = this.parseLoudnessData(media);

		return {
			id: track.ratingKey,
			title,
			artist,
			album,
			albumId: track.parentRatingKey || '',
			artworkUrl,
			artwork: '',
			streamUrl,
			uri: streamUrl,
			duration,
			trackNumber: parseInt(track.index || '0', 10),
			discNumber: parseInt(track.parentIndex || '0', 10),
			playlistItemId: track.playlistItemID ? String(track.playlistItemID) : undefined,
			playlistIndex,
			artistKey: track.grandparentKey || '',
			titleLower: title.toLowerCase(),
			artistLower: artist.toLowerCase(),
			albumLower: album.toLowerCase(),
			...(loudnessData ? { loudnessData } : {}),
		};
	}

	/**
	 * Format a Plex artist into our Artist type
	 */
	private formatArtist(raw: any): Artist {
		return {
			key: raw.ratingKey,
			name: raw.title || 'Unknown Artist',
			thumb: raw.thumb ? this.buildURL(raw.thumb) : undefined,
			art: raw.art ? this.buildURL(raw.art) : undefined,
			summary: raw.summary,
			genres: (raw.Genre || []).map((g: any) => g.tag),
			country: raw.Country?.[0]?.tag,
			addedAt: raw.addedAt ? parseInt(raw.addedAt) : undefined,
			viewCount: raw.viewCount ? parseInt(raw.viewCount) : undefined,
		};
	}

	/**
	 * Format a Plex album into our Album type
	 */
	private formatAlbum(raw: any): Album {
		const thumb = raw.thumb ? this.buildURL(raw.thumb) : undefined;
		return {
			id: raw.ratingKey,
			title: raw.title || '',
			artist: raw.parentTitle || '',
			artistKey: raw.parentRatingKey || '',
			thumb,
			artwork: thumb || '',
			year: raw.year ? parseInt(raw.year) : undefined,
			addedAt: raw.addedAt ? parseInt(raw.addedAt) : undefined,
			guid: raw.guid || undefined,
			studio: raw.studio || undefined,
			leafCount: raw.leafCount ? parseInt(raw.leafCount) : undefined,
			originallyAvailableAt: raw.originallyAvailableAt,
		};
	}

	/**
	 * Fetch ultrablur colors from Plex for a given artwork thumb path.
	 * Returns an array of hex color strings, or null on failure.
	 */
	async fetchUltraBlurColors(thumbUrl: string): Promise<string[] | null> {
		await this.initialize();

		// Extract just the path portion from a full authenticated URL
		// e.g. "https://server:32400/library/metadata/123/thumb/456?X-Plex-Token=..." → "/library/metadata/123/thumb/456"
		let thumbPath: string;
		try {
			const parsed = new URL(thumbUrl);
			thumbPath = parsed.pathname;
		} catch {
			// Already a plain path
			thumbPath = thumbUrl;
		}

		try {
			const response = await this.request<any>('/services/ultrablur/colors', { url: thumbPath }, { timeout: 5000, retries: 1 });

			const data = response.data;

			// Response shape: { MediaContainer: { UltraBlurColors: [{ topLeft, topRight, bottomRight, bottomLeft }] } }
			const entry = data?.MediaContainer?.UltraBlurColors?.[0];
			if (!entry) return null;

			const colors: string[] = [];
			for (const key of ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'] as const) {
				const hex = entry[key];
				if (typeof hex === 'string' && hex.length === 6) {
					colors.push(`#${hex}`);
				}
			}

			return colors.length > 0 ? colors : null;
		} catch (_err) {
			return null;
		}
	}

	/**
	 * Get library sections
	 */
	async getLibrarySections(): Promise<any[]> {
		await this.initialize();

		const response = await this.request('/library/sections');
		const data = response.data as any;
		return data?.MediaContainer?.Directory || [];
	}

	/**
	 * Search the library
	 */
	async search(query: string, type?: string): Promise<any[]> {
		await this.initialize();

		const params: Record<string, string> = { query };
		if (type) {
			params.type = type;
		}

		const response = await this.request('/search', params);
		const data = response.data as any;
		return data?.MediaContainer?.Metadata || [];
	}

	/**
	 * Fetch all playlists
	 */
	async fetchAllPlaylists(): Promise<Playlist[]> {
		await this.initialize();

		const response = await this.request('/playlists');
		const data = response.data as any;
		const rawPlaylists = data?.MediaContainer?.Metadata || [];

		const playlistsArray = Array.isArray(rawPlaylists) ? rawPlaylists : [rawPlaylists];
		return playlistsArray.map((playlist) => this.formatPlaylist(playlist));
	}

	/**
	 * Fetch a specific playlist by ID
	 */
	async fetchPlaylist(playlistId: string): Promise<Playlist | null> {
		await this.initialize();

		try {
			const response = await this.request(`/playlists/${playlistId}`);
			const data = response.data as any;
			const playlist = data?.MediaContainer?.Metadata?.[0];

			if (!playlist) {
				return null;
			}

			return this.formatPlaylist(playlist);
		} catch (error) {
			console.error('Failed to fetch playlist:', error);
			return null;
		}
	}

	/**
	 * Plex artist radio: first station playlist for this artist (GET .../metadata/{id}?includeStations=1).
	 */
	async fetchArtistRadioPlaylist(artistRatingKey: string): Promise<Playlist | null> {
		await this.initialize();

		try {
			const response = await this.request(`/library/metadata/${artistRatingKey}`, {
				includeStations: '1',
			});
			const raw = this.extractFirstStationPlaylist(response.data);
			return raw ? this.formatPlaylist(raw) : null;
		} catch (error) {
			console.error('Failed to fetch artist radio playlist:', error);
			return null;
		}
	}

	/**
	 * Artist radio tracks: station playlist items, or empty if none.
	 */
	async fetchArtistRadioTracks(artistRatingKey: string): Promise<Song[]> {
		const playlist = await this.fetchArtistRadioPlaylist(artistRatingKey);
		if (!playlist?.key) return [];
		return this.fetchPlaylistTracks(playlist.key);
	}

	/**
	 * Parse includeStations=1 response — first audio playlist under Stations (plexapi rtag Stations).
	 */
	private extractFirstStationPlaylist(data: any): any | null {
		const container = data?.MediaContainer;
		if (!container) return null;

		const metadata = container.Metadata;
		const artist = Array.isArray(metadata) ? metadata[0] : metadata;
		if (artist) {
			const stations = artist.Station ?? artist.Stations ?? artist.station;
			if (stations) {
				const list = Array.isArray(stations) ? stations : [stations];
				const playlist =
					list.find(
						(s: any) =>
							s &&
							(s.playlistType === 'audio' ||
								s.type === 'playlist' ||
								(typeof s.key === 'string' && s.key.includes('/playlists/'))),
					) ?? list[0];
				if (playlist?.key) return playlist;
			}
		}

		// Some PMS builds expose station rows as Hub
		const hubs = container.Hub;
		if (hubs) {
			const hubList = Array.isArray(hubs) ? hubs : [hubs];
			for (const hub of hubList) {
				const hubMeta = hub?.Metadata;
				if (!hubMeta) continue;
				const items = Array.isArray(hubMeta) ? hubMeta : [hubMeta];
				const pl = items.find(
					(m: any) =>
						m &&
						(m.type === 'playlist' ||
							m.playlistType === 'audio' ||
							(typeof m.key === 'string' && m.key.includes('/playlists/'))),
				);
				if (pl?.key) return pl;
			}
		}

		return null;
	}

	/**
	 * Fetch tracks from a specific playlist
	 */
	async fetchPlaylistTracks(playlistId: string): Promise<Song[]> {
		await this.initialize();

		try {
			const response = await this.request(`${playlistId}`, {
				includeStreamDetails: '1',
			});
			const data = response.data as any;
			const rawTracks = data?.MediaContainer?.Metadata || [];

			const tracksArray = Array.isArray(rawTracks) ? rawTracks : [rawTracks];
			return tracksArray.map((track, index) => this.formatTrack(track, index));
		} catch (error) {
			console.error('Failed to fetch playlist tracks:', error);
			return [];
		}
	}

	/**
	 * Build a Plex library URI for use in playlist operations
	 */
	private buildLibraryURI(ratingKeys: string[]): string {
		const server = plexAuthService.getSelectedServer();
		if (!server?.serverId) {
			throw new Error('No server selected or missing serverId');
		}
		return `server://${server.serverId}/com.plexapp.plugins.library/library/metadata/${ratingKeys.join(',')}`;
	}

	/**
	 * Create a new playlist
	 */
	async createPlaylist(title: string, ratingKeys?: string[]): Promise<Playlist | null> {
		await this.initialize();

		const params: Record<string, string> = {
			title,
			type: 'audio',
			smart: '0',
			uri: ratingKeys?.length ? this.buildLibraryURI(ratingKeys) : '',
		};

		const response = await this.request('/playlists', params, { method: 'POST' });
		const data = response.data as any;
		const playlist = data?.MediaContainer?.Metadata?.[0];
		return playlist ? this.formatPlaylist(playlist) : null;
	}

	/**
	 * Update playlist metadata (title, summary)
	 */
	async updatePlaylistMetadata(playlistId: string, fields: { title?: string; summary?: string }): Promise<void> {
		await this.initialize();

		const params: Record<string, string> = {};
		if (fields.title !== undefined) params.title = fields.title;
		if (fields.summary !== undefined) params.summary = fields.summary;

		await this.request(`/playlists/${playlistId}`, params, { method: 'PUT' });
	}

	/**
	 * Delete a playlist
	 */
	async deletePlaylist(playlistId: string): Promise<void> {
		await this.initialize();
		await this.request(`/playlists/${playlistId}`, {}, { method: 'DELETE' });
	}

	/**
	 * Add items to a playlist
	 */
	async addToPlaylist(playlistId: string, ratingKeys: string[]): Promise<void> {
		await this.initialize();
		const uri = this.buildLibraryURI(ratingKeys);
		await this.request(`/playlists/${playlistId}/items`, { uri }, { method: 'PUT' });
	}

	/**
	 * Remove an item from a playlist
	 */
	async removeFromPlaylist(playlistId: string, playlistItemId: string): Promise<void> {
		await this.initialize();
		await this.request(`/playlists/${playlistId}/items/${playlistItemId}`, {}, { method: 'DELETE' });
	}

	/**
	 * Move a playlist item to a new position
	 */
	async movePlaylistItem(playlistId: string, playlistItemId: string, afterPlaylistItemId?: string): Promise<void> {
		await this.initialize();
		const params: Record<string, string> = {};
		if (afterPlaylistItemId) {
			params.after = afterPlaylistItemId;
		}
		await this.request(`/playlists/${playlistId}/items/${playlistItemId}/move`, params, { method: 'PUT' });
	}

	/**
	 * Format a Plex playlist into our Playlist type
	 */
	/**
	 * Mark a track as played (scrobble) — updates lastViewedAt and viewCount on Plex
	 */
	async scrobble(ratingKey: string): Promise<void> {
		await this.initialize();
		await this.request(
			'/:/scrobble',
			{
				identifier: 'com.plexapp.plugins.library',
				key: ratingKey,
			},
			{ retries: 0, timeout: 10000 },
		);
	}

	private formatPlaylist(playlist: any): Playlist {
		// Build artwork URL
		const artworkUrl = playlist.thumb ? this.buildURL(playlist.thumb) : undefined;

		return {
			id: playlist.ratingKey,
			title: playlist.title,
			summary: playlist.summary,
			playlistType: playlist.playlistType as 'audio' | 'video' | 'photo',
			artworkUrl,
			artwork: '', // Will be populated by image loading
			duration: parseInt(playlist.duration || '0', 10),
			leafCount: parseInt(playlist.leafCount || '0', 10),
			createdAt: playlist.addedAt,
			updatedAt: playlist.updatedAt,
			lastViewedAt: playlist.lastViewedAt ? parseInt(playlist.lastViewedAt) : undefined,
			smart: playlist.smart === '1',
			composite: playlist.composite,
			ratingKey: playlist.ratingKey,
			key: playlist.key,
			guid: playlist.guid,
		};
	}
	/**
	 * Returns the current connection info for building URLs outside the client.
	 * Returns null if the client hasn't been initialized yet.
	 */
	getConnectionInfo(): { baseURL: string; token: string } | null {
		if (!this.baseURL || !this.token) return null;
		return { baseURL: this.baseURL, token: this.token };
	}
}

// Create singleton instance (baseURL will be set during initialization)
export const plexClient = new PlexClient();

// Export convenience functions for backward compatibility
export const testPlexServer = () => plexClient.testConnectivity();
export const fetchAllTracks = () => plexClient.fetchAllTracks();
export const fetchRecentlyPlayed = (limit?: number) => plexClient.fetchRecentlyPlayed(limit);
export const fetchSectionHubs = (count?: number) => plexClient.fetchSectionHubs(count);
export const fetchAllArtists = () => plexClient.fetchAllArtists();
export const fetchAllAlbums = () => plexClient.fetchAllAlbums();
export const fetchAllPlaylists = () => plexClient.fetchAllPlaylists();
export const fetchPlaylist = (playlistId: string) => plexClient.fetchPlaylist(playlistId);
export const fetchPlaylistTracks = (playlistId: string) => plexClient.fetchPlaylistTracks(playlistId);
export const fetchArtistRadioPlaylist = (artistRatingKey: string) => plexClient.fetchArtistRadioPlaylist(artistRatingKey);
export const fetchArtistRadioTracks = (artistRatingKey: string) => plexClient.fetchArtistRadioTracks(artistRatingKey);
export const fetchUltraBlurColors = (thumbUrl: string) => plexClient.fetchUltraBlurColors(thumbUrl);
export const buildPlexURL = async (path: string, params: Record<string, string> = {}) => {
	await plexClient.initialize();
	return (plexClient as any).buildURL(path, params);
};
export const createPlaylist = (title: string, ratingKeys?: string[]) => plexClient.createPlaylist(title, ratingKeys);
export const updatePlaylistMetadata = (playlistId: string, fields: { title?: string; summary?: string }) =>
	plexClient.updatePlaylistMetadata(playlistId, fields);
export const deletePlaylist = (playlistId: string) => plexClient.deletePlaylist(playlistId);
export const addToPlaylist = (playlistId: string, ratingKeys: string[]) => plexClient.addToPlaylist(playlistId, ratingKeys);
export const removeFromPlaylist = (playlistId: string, playlistItemId: string) => plexClient.removeFromPlaylist(playlistId, playlistItemId);
export const movePlaylistItem = (playlistId: string, playlistItemId: string, afterPlaylistItemId?: string) =>
	plexClient.movePlaylistItem(playlistId, playlistItemId, afterPlaylistItemId);
export const scrobble = (ratingKey: string) => plexClient.scrobble(ratingKey);
