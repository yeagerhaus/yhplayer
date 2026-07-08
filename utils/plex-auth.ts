import { fetch } from 'expo/fetch';
import * as Device from 'expo-device';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { storage } from '@/lib/storage';
import { type PlexServer, plexDiscoveryService } from './plex-discovery';
import { buildPlexIdentityHeaders } from './plex-identity';

export interface PlexAuthState {
	isAuthenticated: boolean;
	username?: string;
	email?: string;
	avatarUrl?: string;
	servers: PlexServer[];
	selectedServer?: PlexServer;
	accessToken?: string;
}

export interface PlexLoginResult {
	success: boolean;
	authState?: PlexAuthState;
	error?: string;
}

export interface PlexPinResult {
	success: boolean;
	pinId?: number;
	pinCode?: string;
	error?: string;
}

export interface PlexPinStatus {
	authToken?: string;
	expiresAt?: string;
	code?: string;
}

export class PlexAuthService {
	private static instance: PlexAuthService;
	private authState: PlexAuthState = {
		isAuthenticated: false,
		servers: [],
	};
	private clientIdentifier: string | null = null;

	private constructor() {
		this.clientIdentifier = this.getOrCreateClientIdentifierFromStorage();
	}

	static getInstance(): PlexAuthService {
		if (!PlexAuthService.instance) {
			PlexAuthService.instance = new PlexAuthService();
		}
		return PlexAuthService.instance;
	}

	/**
	 * Get or create a unique client identifier for this device (async version)
	 */
	private getOrCreateClientIdentifierFromStorage(): string {
		const storageKey = 'plex_client_identifier';
		try {
			const stored = storage.getString(storageKey);
			if (stored) {
				return stored;
			}

			const platform = Platform.OS;
			const _deviceId = Device.modelId || 'unknown';
			const timestamp = Date.now();
			const random = Math.random().toString(36).substring(2, 10);
			const identifier = `rite-${platform}-${timestamp}-${random}`;

			storage.set(storageKey, identifier);
			return identifier;
		} catch (error) {
			console.error('Failed to get/create client identifier:', error);
			return `rite-${Platform.OS}-${Date.now()}`;
		}
	}

	/**
	 * Stable Plex client id for this install (persisted). Use for all Plex API and PMS requests.
	 */
	getClientIdentifier(): string {
		const id = this.getOrCreateClientIdentifierFromStorage();
		this.clientIdentifier = id;
		return id;
	}

	/**
	 * Request a PIN from Plex API for OAuth authentication
	 * Uses the /api/v2/pins endpoint (doesn't require JWT/key registration)
	 */
	async requestPlexPin(): Promise<PlexPinResult> {
		try {
			console.log('🔐 Requesting Plex PIN...');

			const response = await fetch('https://plex.tv/api/v2/pins', {
				method: 'POST',
				headers: {
					...buildPlexIdentityHeaders(this.getClientIdentifier()),
					Accept: 'application/json',
				},
			});

			if (!response.ok) {
				const errorText = await response.text().catch(() => 'Unknown error');
				console.error(`❌ PIN request failed: ${response.status} - ${errorText}`);

				return {
					success: false,
					error: `Failed to request PIN: ${response.status} ${errorText}`,
				};
			}

			// v2 API returns JSON
			const data = await response.json();
			const pinId = data.id;
			const pinCode = data.code;

			if (!pinId || !pinCode) {
				throw new Error('Invalid response format from Plex API');
			}

			// console.log(`✅ PIN requested: ${pinCode} (ID: ${pinId})`);

			return {
				success: true,
				pinId,
				pinCode,
			};
		} catch (error: any) {
			console.error('❌ Failed to request PIN:', error);
			return {
				success: false,
				error: `Failed to request PIN: ${error.message}`,
			};
		}
	}

	/**
	 * Check PIN status and get auth token if authorized
	 * Uses the older /api/pins endpoint which doesn't require JWT/key registration
	 */
	async pollPinStatus(pinId: number): Promise<PlexPinStatus | null> {
		try {
			const response = await fetch(`https://plex.tv/api/v2/pins/${pinId}`, {
				method: 'GET',
				headers: {
					...buildPlexIdentityHeaders(this.getClientIdentifier()),
					Accept: 'application/json',
				},
			});

			if (!response.ok) {
				return null;
			}

			// v2 API returns JSON
			const data = await response.json();

			// Only return if we have an auth token (PIN was authorized)
			if (data.authToken) {
				return {
					authToken: data.authToken,
					expiresAt: data.expiresAt,
					code: data.code,
				};
			}

			return null;
		} catch (error) {
			console.error('Failed to poll PIN status:', error);
			return null;
		}
	}

	/**
	 * Open Plex activation page in browser
	 */
	async openPlexActivation(pinCode: string): Promise<void> {
		const activationUrl = `https://plex.tv/link/?pin=${pinCode}`;
		await WebBrowser.openBrowserAsync(activationUrl);
	}

	/**
	 * Login with PIN-based OAuth flow
	 */
	async loginWithPin(onPinReceived?: (pinCode: string) => void, onStatusUpdate?: (status: string) => void): Promise<PlexLoginResult> {
		try {
			onStatusUpdate?.('Requesting PIN...');
			const pinResult = await this.requestPlexPin();

			if (!pinResult.success || !pinResult.pinId || !pinResult.pinCode) {
				return {
					success: false,
					error: pinResult.error || 'Failed to request PIN',
				};
			}

			onPinReceived?.(pinResult.pinCode);
			onStatusUpdate?.('Opening browser for authorization...');

			// Open browser for user to authorize
			await this.openPlexActivation(pinResult.pinCode);

			onStatusUpdate?.('Waiting for authorization...');

			// Poll for authorization (up to 5 minutes)
			const maxAttempts = 150; // 5 minutes at 2 seconds per attempt
			const pollInterval = 2000; // 2 seconds

			for (let attempt = 0; attempt < maxAttempts; attempt++) {
				await new Promise((resolve) => setTimeout(resolve, pollInterval));

				const pinStatus = await this.pollPinStatus(pinResult.pinId);
				if (pinStatus?.authToken) {
					onStatusUpdate?.('Authorization successful! Connecting...');
					// Use the token to complete login
					return await this.loginWithToken(pinStatus.authToken);
				}

				// Update status every 10 seconds
				if (attempt % 5 === 0) {
					const remainingSeconds = Math.floor((maxAttempts - attempt) * (pollInterval / 1000));
					onStatusUpdate?.(`Waiting for authorization... (${remainingSeconds}s remaining)`);
				}
			}

			return {
				success: false,
				error: 'PIN authorization timed out. Please try again.',
			};
		} catch (error: any) {
			console.error('❌ PIN login failed:', error);
			return {
				success: false,
				error: `PIN login failed: ${error.message}`,
			};
		}
	}

	/**
	 * Login with Plex token and discover servers
	 */
	async loginWithToken(plexToken: string): Promise<PlexLoginResult> {
		try {
			console.log('🔐 Logging in with Plex token...');

			// First, verify the token by getting user info
			const userInfo = await this.getUserInfo(plexToken);
			if (!userInfo) {
				return {
					success: false,
					error: 'Invalid Plex token. Please check your token and try again.',
				};
			}

			// Discover available servers
			const discoveryResult = await plexDiscoveryService.discoverServers(plexToken);
			if (!discoveryResult.servers.length) {
				return {
					success: false,
					error: discoveryResult.error || 'No Plex servers found. Please check your server is running and accessible.',
				};
			}

			// Test connection to recommended server (with authentication)
			const recommendedServer = discoveryResult.recommendedServer;
			if (recommendedServer) {
				const isConnected = await plexDiscoveryService.testServerConnection(recommendedServer, plexToken);
				if (!isConnected) {
					console.warn('⚠️ Recommended server connection failed, trying other servers...');

					// Try other servers
					for (const server of discoveryResult.servers) {
						if (server.id !== recommendedServer.id) {
							const connected = await plexDiscoveryService.testServerConnection(server, plexToken);
							if (connected) {
								recommendedServer.id = server.id;
								recommendedServer.uri = server.uri;
								recommendedServer.serverId = server.serverId;
								break;
							}
						}
					}
				}
			}

			// Update auth state
			this.authState = {
				isAuthenticated: true,
				username: userInfo.username,
				email: userInfo.email,
				avatarUrl: userInfo.avatarUrl,
				servers: discoveryResult.servers,
				selectedServer: recommendedServer,
				accessToken: plexToken,
			};

			// Save to storage
			this.saveAuthState();

			// console.log('✅ Login successful!');
			console.log(`   User: ${userInfo.username}`);
			console.log(`   Servers: ${discoveryResult.servers.length}`);
			console.log(`   Selected: ${recommendedServer?.name || 'None'}`);

			return {
				success: true,
				authState: this.authState,
			};
		} catch (error: any) {
			console.error('❌ Login failed:', error);
			return {
				success: false,
				error: `Login failed: ${error.message}`,
			};
		}
	}

	/**
	 * Get user information from Plex API (username, email, avatar)
	 */
	private async getUserInfo(plexToken: string): Promise<{ username: string; email: string; avatarUrl?: string } | null> {
		try {
			const response = await fetch('https://plex.tv/api/v2/user', {
				method: 'GET',
				headers: {
					'X-Plex-Token': plexToken,
					Accept: 'application/json',
				},
			});

			if (!response.ok) {
				return null;
			}

			const data = await response.json();
			let avatarUrl: string | undefined = data.thumb;

			// /api/v2/user may not include thumb; /api/v2/home/user does
			if (!avatarUrl) {
				const homeRes = await fetch('https://plex.tv/api/v2/home/user', {
					method: 'GET',
					headers: {
						'X-Plex-Token': plexToken,
						Accept: 'application/json',
					},
				});
				if (homeRes.ok) {
					const homeData = await homeRes.json();
					avatarUrl = homeData.thumb;
				}
			}

			return {
				username: data.username,
				email: data.email,
				avatarUrl: avatarUrl ?? undefined,
			};
		} catch (error) {
			console.error('Failed to get user info:', error);
			return null;
		}
	}

	/**
	 * Select a different server
	 */
	async selectServer(serverId: string): Promise<boolean> {
		const server = this.authState.servers.find((s) => s.id === serverId);
		if (!server) {
			console.error('Server not found:', serverId);
			return false;
		}

		// Test connection to the new server (with authentication)
		const isConnected = await plexDiscoveryService.testServerConnection(server, this.authState.accessToken);
		if (!isConnected) {
			console.error('Failed to connect to selected server');
			return false;
		}

		// Update selected server
		this.authState.selectedServer = server;
		this.saveAuthState();

		// console.log(`✅ Selected server: ${server.name}`);
		return true;
	}

	/**
	 * Refresh server list
	 */
	async refreshServers(): Promise<boolean> {
		if (!this.authState.accessToken) {
			return false;
		}

		try {
			const discoveryResult = await plexDiscoveryService.discoverServers(this.authState.accessToken);
			if (discoveryResult.servers.length > 0) {
				this.authState.servers = discoveryResult.servers;

				// Update selected server to refreshed version (with connections), or pick a new one
				if (this.authState.selectedServer) {
					const refreshed = discoveryResult.servers.find((s) => s.id === this.authState.selectedServer?.id);
					this.authState.selectedServer = refreshed || discoveryResult.recommendedServer;
				}

				this.saveAuthState();
				return true;
			}
			return false;
		} catch (error) {
			console.error('Failed to refresh servers:', error);
			return false;
		}
	}

	/**
	 * Get current authentication state
	 */
	getAuthState(): PlexAuthState {
		return { ...this.authState };
	}

	/**
	 * Check if user is authenticated
	 */
	isAuthenticated(): boolean {
		return this.authState.isAuthenticated;
	}

	/**
	 * Get selected server
	 */
	getSelectedServer(): PlexServer | undefined {
		return this.authState.selectedServer;
	}

	/**
	 * Get access token
	 */
	getAccessToken(): string | undefined {
		return this.authState.accessToken;
	}

	/**
	 * Logout and clear authentication state
	 */
	async logout(): Promise<void> {
		this.authState = {
			isAuthenticated: false,
			servers: [],
		};

		storage.remove('plex_auth_state');
		storage.remove('plex_servers_cache');

		await plexDiscoveryService.clearCache();

		// console.log('✅ Logged out successfully');
	}

	/**
	 * Load authentication state from storage
	 */
	async loadAuthState(): Promise<boolean> {
		try {
			const stored = storage.getString('plex_auth_state');
			if (stored) {
				const data = JSON.parse(stored);
				this.authState = data;

				// Verify the stored state is still valid
				if (this.authState.accessToken) {
					const userInfo = await this.getUserInfo(this.authState.accessToken);
					if (userInfo) {
						// Refresh username, email, avatar from API (e.g. avatar not in old stored state)
						this.authState.username = userInfo.username;
						this.authState.email = userInfo.email;
						if (userInfo.avatarUrl) this.authState.avatarUrl = userInfo.avatarUrl;
						this.saveAuthState();

						// console.log('✅ Loaded authentication state from storage');

						// If persisted server is missing connections (old format), refresh before proceeding
						if (this.authState.selectedServer && !this.authState.selectedServer.connections?.length) {
							console.log('🔄 Refreshing servers to populate connections...');
							try {
								await this.refreshServers();
							} catch (err) {
								console.warn('Server refresh failed:', err);
							}
						}

						return true;
					} else {
						// Token is invalid, clear state
						await this.logout();
					}
				}
			}
		} catch (error) {
			console.error('Failed to load auth state:', error);
		}
		return false;
	}

	/**
	 * Save authentication state to storage
	 */
	private saveAuthState(): void {
		try {
			storage.set('plex_auth_state', JSON.stringify(this.authState));
		} catch (error) {
			console.error('Failed to save auth state:', error);
		}
	}

	/**
	 * Update server configuration when a new server is selected
	 */
	async updateServerConfiguration(): Promise<void> {
		if (this.authState.selectedServer) {
			await plexDiscoveryService.updateServerConfiguration(this.authState.selectedServer);
		}
	}
}

// Export singleton instance
export const plexAuthService = PlexAuthService.getInstance();
