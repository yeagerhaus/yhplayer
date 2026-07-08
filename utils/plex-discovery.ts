import { fetch } from 'expo/fetch';

export interface PlexConnection {
	uri: string;
	address: string;
	port: number;
	local: boolean;
}

export interface PlexServer {
	id: string;
	name: string;
	uri: string;
	serverId: string;
	local: boolean;
	address: string;
	port: number;
	connections: PlexConnection[];
}

export interface PlexDiscoveryResult {
	servers: PlexServer[];
	recommendedServer?: PlexServer;
	error?: string;
}

class PlexDiscoveryService {
	/**
	 * Discover available Plex servers using the Plex.tv API
	 */
	async discoverServers(plexToken: string): Promise<PlexDiscoveryResult> {
		try {
			console.log('🔍 Discovering Plex servers...');

			// Request JSON response explicitly (Plex API supports JSON with Accept header)
			const url = `https://plex.tv/api/resources?includeHttps=1&X-Plex-Token=${encodeURIComponent(plexToken)}`;
			const response = await fetch(url, {
				headers: {
					'X-Plex-Token': plexToken,
					Accept: 'application/json',
				},
			});

			if (!response.ok) {
				const errorText = await response.text().catch(() => 'Unknown error');
				console.error(`❌ Server discovery failed: ${response.status} - ${errorText}`);
				return {
					servers: [],
					error: `Failed to discover servers: ${response.status} ${response.statusText}`,
				};
			}

			// Check content type
			const contentType = response.headers.get('content-type') || '';
			console.log(`   Response Content-Type: ${contentType}`);

			// Get response as text first to check format
			const responseText = await response.text();

			// The /api/resources endpoint doesn't support JSON, it only returns XML
			// So we need to parse XML for this specific endpoint
			if (contentType.includes('xml') || responseText.trim().startsWith('<')) {
				console.log("   ⚠️ /api/resources returned XML (this endpoint doesn't support JSON)");
				return this.parseResourcesXML(responseText, plexToken);
			}

			// Parse JSON response (for other endpoints that support it)
			const data = JSON.parse(responseText);
			// console.log(`   ✅ Successfully parsed JSON response`);

			// Handle array response (Plex returns array of resources)
			const resources = Array.isArray(data) ? data : data.MediaContainer?.Device || [];
			console.log(`   Found ${resources.length} resources`);

			const servers: PlexServer[] = [];

			for (const resource of resources) {
				// Check if this resource provides server functionality
				const provides = resource.provides || resource.capabilities || [];
				const providesArray = Array.isArray(provides) ? provides : provides.split(',');

				if (providesArray.includes('server') || resource.server) {
					console.log(`   📡 Processing server: ${resource.name}`);

					// Extract connection info - Plex returns array of connections
					const connections = resource.Connection || resource.connections || [];
					const connectionsArray = Array.isArray(connections) ? connections : [connections];

					console.log(`      Found ${connectionsArray.length} connection(s)`);

					// Collect all valid connections
					const allConnections: PlexConnection[] = [];

					for (const conn of connectionsArray) {
						if (!conn) continue;

						const connUri = conn.uri as string | undefined;
						const connAddress = conn.address as string | undefined;
						const connPort = parseInt(conn.port || '32400', 10);
						const connLocal = conn.local === true || conn.local === '1' || conn.local === 1;

						console.log(
							`      Connection: uri=${connUri || 'none'}, address=${connAddress || 'none'}, port=${connPort}, local=${connLocal}`,
						);

						if (!connAddress) continue;

						let uri = connUri || '';
						if (!uri) {
							const protocol = connLocal ? 'http' : 'https';
							uri = `${protocol}://${connAddress}:${connPort}`;
						}

						if (!uri.match(/^https?:\/\/.+/)) continue;

						allConnections.push({ uri, address: connAddress, port: connPort, local: connLocal });
					}

					if (allConnections.length === 0) {
						console.warn(`   ⚠️ Skipping server ${resource.name} - no valid connections found`);
						continue;
					}

					// Test connections: try local first, then remote
					const sorted = [...allConnections].sort((a, b) => (a.local === b.local ? 0 : a.local ? -1 : 1));
					let best = sorted[0];
					let found = false;

					for (const conn of sorted) {
						const reachable = await this.testConnectionUri(conn.uri, plexToken);
						if (reachable) {
							best = conn;
							found = true;
							// console.log(`      ✅ Reachable: ${conn.uri}`);
							break;
						}
						console.log(`      ❌ Unreachable: ${conn.uri}`);
					}

					// Fallback: try plain http://address:port if *.plex.direct URIs failed
					if (!found) {
						const triedUris = new Set(sorted.map((c) => c.uri));
						for (const conn of sorted) {
							if (!conn.address) continue;
							const directUri = `http://${conn.address}:${conn.port}`;
							if (triedUris.has(directUri)) continue;
							console.log(`      🔗 Trying direct HTTP: ${directUri}`);
							if (await this.testConnectionUri(directUri, plexToken)) {
								best = { uri: directUri, address: conn.address, port: conn.port, local: true };
								// console.log(`      ✅ Reachable via direct HTTP: ${directUri}`);
								break;
							}
						}
					}

					const server: PlexServer = {
						id: resource.clientIdentifier || resource.machineIdentifier,
						name: resource.name,
						uri: best.uri,
						serverId: resource.clientIdentifier || resource.machineIdentifier,
						local: best.local,
						address: best.address,
						port: best.port,
						connections: allConnections,
					};

					// console.log(`   ✅ Added server: ${server.name} - ${server.uri}`);
					servers.push(server);
				}
			}

			// Recommended server is just the first one (connections already tested above)
			const recommendedServer = servers[0];

			// console.log(`✅ Found ${servers.length} servers`);
			return {
				servers,
				recommendedServer,
			};
		} catch (error) {
			console.error('❌ Server discovery failed:', error);
			return {
				servers: [],
				error: error instanceof Error ? error.message : 'Unknown error during server discovery',
			};
		}
	}

	/**
	 * Parse XML response from /api/resources endpoint
	 * This endpoint doesn't support JSON, so we must parse XML
	 */
	private async parseResourcesXML(xmlText: string, plexToken: string): Promise<PlexDiscoveryResult> {
		try {
			console.log('   📄 Parsing XML response...');
			const servers: PlexServer[] = [];

			// Parse XML response - find all Device elements
			const deviceMatches = Array.from(xmlText.matchAll(/<Device[^>]*>([\s\S]*?)<\/Device>/g));
			console.log(`   Found ${deviceMatches.length} Device elements`);

			for (const match of deviceMatches) {
				const deviceXml = match[0];
				const providesMatch = deviceXml.match(/provides="([^"]+)"/);
				const provides = providesMatch ? providesMatch[1].split(',') : [];

				if (provides.includes('server')) {
					const nameMatch = deviceXml.match(/name="([^"]+)"/);
					const idMatch = deviceXml.match(/clientIdentifier="([^"]+)"/);

					if (!nameMatch || !idMatch) {
						console.warn('   ⚠️ Skipping server - missing name or ID');
						continue;
					}

					console.log(`   📡 Found server: ${nameMatch[1]} (${idMatch[1]})`);

					// Find ALL Connection elements (Plex returns multiple - local, remote, etc.)
					const connectionMatches = Array.from(deviceXml.matchAll(/<Connection[^>]*\/>/g));
					console.log(`      Found ${connectionMatches.length} Connection elements`);

					// Collect all valid connections
					const allConnections: PlexConnection[] = [];

					for (const connMatch of connectionMatches) {
						const connXml = connMatch[0];
						const uriMatch = connXml.match(/uri="([^"]+)"/);
						const addrMatch = connXml.match(/address="([^"]+)"/);
						const portMatch = connXml.match(/port="([^"]+)"/);
						const localMatch = connXml.match(/local="([^"]+)"/);

						const connAddress = addrMatch ? addrMatch[1] : undefined;
						const connPort = portMatch ? parseInt(portMatch[1], 10) : 32400;
						const connLocal = localMatch ? localMatch[1] === '1' : false;

						console.log(
							`      Connection: uri=${uriMatch?.[1] || 'none'}, address=${connAddress || 'none'}, port=${connPort}, local=${connLocal}`,
						);

						if (!connAddress) continue;

						let connUri = uriMatch ? uriMatch[1] : '';
						if (!connUri) {
							const protocol = connLocal ? 'http' : 'https';
							connUri = `${protocol}://${connAddress}:${connPort}`;
						}

						if (!connUri.match(/^https?:\/\/.+/)) continue;

						allConnections.push({ uri: connUri, address: connAddress, port: connPort, local: connLocal });
					}

					if (allConnections.length === 0) {
						console.warn(`   ⚠️ Skipping server ${nameMatch[1]} - no valid connections found`);
						continue;
					}

					// Test connections: try local first, then remote
					const sorted = [...allConnections].sort((a, b) => (a.local === b.local ? 0 : a.local ? -1 : 1));
					let best = sorted[0];
					let found = false;

					for (const conn of sorted) {
						const reachable = await this.testConnectionUri(conn.uri, plexToken);
						if (reachable) {
							best = conn;
							found = true;
							// console.log(`      ✅ Reachable: ${conn.uri}`);
							break;
						}
						console.log(`      ❌ Unreachable: ${conn.uri}`);
					}

					// Fallback: try plain http://address:port if *.plex.direct URIs failed
					if (!found) {
						const triedUris = new Set(sorted.map((c) => c.uri));
						for (const conn of sorted) {
							if (!conn.address) continue;
							const directUri = `http://${conn.address}:${conn.port}`;
							if (triedUris.has(directUri)) continue;
							console.log(`      🔗 Trying direct HTTP: ${directUri}`);
							if (await this.testConnectionUri(directUri, plexToken)) {
								best = { uri: directUri, address: conn.address, port: conn.port, local: true };
								// console.log(`      ✅ Reachable via direct HTTP: ${directUri}`);
								break;
							}
						}
					}

					const server: PlexServer = {
						id: idMatch[1],
						name: nameMatch[1],
						uri: best.uri,
						serverId: idMatch[1],
						local: best.local,
						address: best.address,
						port: best.port,
						connections: allConnections,
					};

					// console.log(`   ✅ Added server: ${server.name} - ${server.uri}`);
					servers.push(server);
				}
			}

			// Recommended server is just the first one (connections already tested above)
			const recommendedServer = servers[0];

			// console.log(`✅ Found ${servers.length} servers`);
			return {
				servers,
				recommendedServer,
			};
		} catch (error) {
			console.error('❌ XML parsing failed:', error);
			return {
				servers: [],
				error: error instanceof Error ? error.message : 'Unknown error during XML parsing',
			};
		}
	}

	/**
	 * Quick connectivity test for a single URI (short timeout)
	 */
	private async testConnectionUri(uri: string, plexToken?: string): Promise<boolean> {
		try {
			const testUrl = new URL(`${uri}/identity`);
			if (plexToken) {
				testUrl.searchParams.set('X-Plex-Token', plexToken);
			}

			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 3000);

			const response = await fetch(testUrl.toString(), {
				headers: { Accept: 'application/json' },
				signal: controller.signal,
			});

			clearTimeout(timeoutId);
			return response.ok;
		} catch {
			return false;
		}
	}

	/**
	 * Test connection to a specific Plex server (tries all stored connections)
	 */
	async testServerConnection(server: PlexServer, plexToken?: string): Promise<boolean> {
		console.log(`🔗 Testing connection to ${server.name}...`);

		// Try the primary URI first
		if (await this.testConnectionUri(server.uri, plexToken)) {
			// console.log(`✅ Server ${server.name}: Connected via ${server.uri}`);
			return true;
		}

		// Primary failed — try all stored connections
		if (server.connections?.length) {
			for (const conn of server.connections) {
				if (conn.uri === server.uri) continue; // already tried
				if (await this.testConnectionUri(conn.uri, plexToken)) {
					// Update server to use the working connection
					// console.log(`✅ Server ${server.name}: Connected via fallback ${conn.uri}`);
					server.uri = conn.uri;
					server.address = conn.address;
					server.port = conn.port;
					server.local = conn.local;
					return true;
				}
			}

			// Last resort: try plain http://address:port for local connections
			// (*.plex.direct DNS may not resolve for new/local-only servers)
			const triedUris = new Set([server.uri, ...server.connections.map((c) => c.uri)]);
			for (const conn of server.connections) {
				if (!conn.address) continue;
				const directUri = `http://${conn.address}:${conn.port}`;
				if (triedUris.has(directUri)) continue;
				console.log(`🔗 Trying direct HTTP fallback: ${directUri}`);
				if (await this.testConnectionUri(directUri, plexToken)) {
					// console.log(`✅ Server ${server.name}: Connected via direct HTTP ${directUri}`);
					server.uri = directUri;
					server.address = conn.address;
					server.port = conn.port;
					server.local = true;
					return true;
				}
			}
		}

		console.error(`❌ Connection test failed for ${server.name} (all connections exhausted)`);
		return false;
	}

	/**
	 * Clear any cached discovery data
	 */
	async clearCache(): Promise<void> {
		// No caching implemented yet, but keeping for future use
		console.log('🗑️ Cleared discovery cache');
	}

	/**
	 * Update server configuration (placeholder for future use)
	 */
	async updateServerConfiguration(server: PlexServer): Promise<void> {
		// No configuration updates needed yet
		console.log(`⚙️ Updated configuration for ${server.name}`);
	}
}

export const plexDiscoveryService = new PlexDiscoveryService();
