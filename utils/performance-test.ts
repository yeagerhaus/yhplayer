/**
 * Performance testing utilities
 * Run these tests to identify bottlenecks
 */

import { useAudioStore } from '@/hooks/useAudioStore';
import { useLibraryStore } from '@/hooks/useLibraryStore';
import { performanceMonitor } from './performance';

/**
 * Generate mock library data for testing
 */
export function generateMockLibrary(trackCount: number) {
	const tracks = Array.from({ length: trackCount }, (_, i) => ({
		id: `track-${i}`,
		title: `Song ${i}`,
		artist: `Artist ${Math.floor(i / 10)}`,
		album: `Album ${Math.floor(i / 20)}`,
		artworkUrl: `https://example.com/artwork-${i}.jpg`,
		artwork: '',
		streamUrl: `https://example.com/stream-${i}.mp3`,
		uri: `https://example.com/stream-${i}.mp3`,
		duration: 180000 + Math.random() * 120000,
		trackNumber: (i % 20) + 1,
		discNumber: Math.floor(i / 20) + 1,
		playlistIndex: undefined,
		artistKey: `artist-${Math.floor(i / 10)}`,
	}));

	return tracks;
}

/**
 * Test library loading performance
 */
export async function testLibraryLoading(trackCount: number = 10000) {
	console.log(`🧪 Testing library loading with ${trackCount} tracks...`);

	const mockTracks = generateMockLibrary(trackCount);

	await performanceMonitor.trackAsync(
		'library-load',
		async () => {
			useLibraryStore.getState().setTracks(mockTracks);
			// Wait for processing to complete
			await new Promise((resolve) => setTimeout(resolve, 2000));
		},
		{ trackCount },
	);

	const metrics = performanceMonitor.getMetricsByName('library-load');
	if (metrics.length > 0) {
		// console.log(`✅ Library load test completed: ${metrics[0].duration.toFixed(2)}ms`);
	}
}

/**
 * Test track switching performance
 */
export async function testTrackSwitching(trackCount: number = 100) {
	console.log(`🧪 Testing track switching with ${trackCount} switches...`);

	const mockTracks = generateMockLibrary(1000);
	useLibraryStore.getState().setTracks(mockTracks);

	// Set up initial queue
	const { playSound } = useAudioStore.getState();
	await playSound(mockTracks[0], mockTracks);

	// Test rapid switching
	const { skipToNext } = useAudioStore.getState();

	for (let i = 0; i < trackCount; i++) {
		await performanceMonitor.trackAsync(`track-switch-${i}`, async () => {
			await skipToNext();
		});
	}

	const allMetrics = performanceMonitor.getMetrics();
	const metrics = allMetrics.filter((m) => m.name.startsWith('track-switch-'));
	const avgDuration = metrics.reduce((sum, m) => sum + m.duration, 0) / metrics.length;
	const maxDuration = Math.max(...metrics.map((m) => m.duration));

	// console.log(`✅ Track switching test completed:`);
	console.log(`   Average: ${avgDuration.toFixed(2)}ms`);
	console.log(`   Max: ${maxDuration.toFixed(2)}ms`);
	console.log(`   Total: ${metrics.reduce((sum, m) => sum + m.duration, 0).toFixed(2)}ms`);
}

/**
 * Test search performance
 */
export function testSearchPerformance(query: string) {
	console.log(`🧪 Testing search with query: "${query}"...`);

	const { tracks } = useLibraryStore.getState();

	const start = performance.now();

	// Simulate search logic
	const normalizedQuery = query.toLowerCase().trim();
	const results: any[] = [];

	for (const song of tracks.slice(0, 1000)) {
		const titleMatch = song.title.toLowerCase().includes(normalizedQuery);
		const artistMatch = song.artist.toLowerCase().includes(normalizedQuery);
		const albumMatch = song.album.toLowerCase().includes(normalizedQuery);

		if (titleMatch || artistMatch || albumMatch) {
			results.push(song);
		}
	}

	const duration = performance.now() - start;

	// console.log(`✅ Search test completed:`);
	console.log(`   Duration: ${duration.toFixed(2)}ms`);
	console.log(`   Results: ${results.length}`);
	console.log(`   Tracks searched: ${Math.min(1000, tracks.length)}`);
}

/**
 * Test FlatList rendering performance
 */
export function testFlatListRendering(itemCount: number = 1000) {
	console.log(`🧪 Testing FlatList rendering with ${itemCount} items...`);

	const _mockTracks = generateMockLibrary(itemCount);
	const start = performance.now();

	// Simulate rendering (this is just a rough estimate)
	// In real testing, you'd measure actual render times
	const renderTime = itemCount * 0.1; // Estimated 0.1ms per item

	const _duration = performance.now() - start;

	// console.log(`✅ FlatList rendering test:`);
	console.log(`   Estimated render time: ${renderTime.toFixed(2)}ms`);
	console.log(`   Items: ${itemCount}`);
}

/**
 * Run all performance tests
 */
export async function runAllPerformanceTests() {
	console.log('🚀 Running all performance tests...\n');

	try {
		await testLibraryLoading(5000);
		console.log('');
		await testTrackSwitching(50);
		console.log('');
		testSearchPerformance('test');
		console.log('');
		testFlatListRendering(1000);
		console.log('');

		performanceMonitor.logReport();
	} catch (error) {
		console.error('❌ Performance test failed:', error);
	}
}

/**
 * Expose performance monitor to global scope for debugging
 */
if (__DEV__) {
	(global as any).performanceMonitor = performanceMonitor;
	(global as any).runPerformanceTests = runAllPerformanceTests;
	(global as any).testLibraryLoading = testLibraryLoading;
	(global as any).testTrackSwitching = testTrackSwitching;
	(global as any).testSearchPerformance = testSearchPerformance;

	// Helper functions for analysis
	(global as any).exportPerformanceData = () => {
		console.log('📊 Performance Summary:');
		console.log(performanceMonitor.generateSummary());
		console.log('\n📋 Full JSON Data:');
		console.log(performanceMonitor.exportMetrics());
		return performanceMonitor.exportMetrics();
	};

	(global as any).getPerformanceSummary = () => {
		return performanceMonitor.generateSummary();
	};
}
