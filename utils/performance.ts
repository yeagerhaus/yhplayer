/**
 * Performance monitoring utilities
 * Helps identify performance bottlenecks and track metrics
 */

interface PerformanceMetric {
	name: string;
	duration: number;
	timestamp: number;
	metadata?: Record<string, any>;
}

class PerformanceMonitor {
	private metrics: PerformanceMetric[] = [];
	private enabled: boolean = __DEV__;

	/**
	 * Track a performance metric
	 */
	track(name: string, fn: () => void | Promise<void>, metadata?: Record<string, any>): void | Promise<void> {
		if (!this.enabled) return fn();

		const start = performance.now();
		const timestamp = Date.now();
		const result = fn();

		if (result instanceof Promise) {
			return result
				.then((value) => {
					const duration = performance.now() - start;
					this.recordMetric(name, duration, timestamp, metadata);
					return value;
				})
				.catch((error) => {
					const duration = performance.now() - start;
					this.recordMetric(name, duration, timestamp, { ...metadata, error: error.message });
					throw error;
				});
		} else {
			const duration = performance.now() - start;
			this.recordMetric(name, duration, timestamp, metadata);
			return result;
		}
	}

	/**
	 * Track UI responsiveness (frame drops)
	 */
	trackUIRender(componentName: string, renderFn: () => void): void {
		if (!this.enabled) {
			renderFn();
			return;
		}

		const start = performance.now();
		renderFn();
		const duration = performance.now() - start;

		if (duration > 16) {
			// Slower than 60fps
			this.recordMetric(`ui-render-${componentName}`, duration, Date.now(), {
				slow: true,
				fps: Math.round(1000 / duration),
			});
		}
	}

	/**
	 * Track an async operation
	 */
	async trackAsync<T>(name: string, fn: () => Promise<T>, metadata?: Record<string, any>): Promise<T> {
		if (!this.enabled) return fn();

		const start = performance.now();
		const timestamp = Date.now();

		try {
			const result = await fn();
			const duration = performance.now() - start;
			this.recordMetric(name, duration, timestamp, metadata);
			return result;
		} catch (error: any) {
			const duration = performance.now() - start;
			this.recordMetric(name, duration, timestamp, { ...metadata, error: error.message });
			throw error;
		}
	}

	/**
	 * Start a performance timer
	 */
	startTimer(name: string): (metadata?: Record<string, any>) => void {
		if (!this.enabled) return () => {};

		const start = performance.now();
		const timestamp = Date.now();

		return (metadata?: Record<string, any>) => {
			const duration = performance.now() - start;
			this.recordMetric(name, duration, timestamp, metadata);
		};
	}

	/**
	 * Record a metric
	 */
	private recordMetric(name: string, duration: number, timestamp: number, metadata?: Record<string, any>): void {
		const metric: PerformanceMetric = {
			name,
			duration,
			timestamp,
			metadata,
		};

		this.metrics.push(metric);

		// Log slow operations
		// if (duration > 100) {
		// 	console.warn(`⚠️ Slow operation: ${name} took ${duration.toFixed(2)}ms`, metadata || '');
		// } else if (duration > 50) {
		// 	console.log(`⏱️ ${name}: ${duration.toFixed(2)}ms`, metadata || '');
		// }

		// Keep only last 1000 metrics to prevent memory issues
		if (this.metrics.length > 1000) {
			this.metrics.shift();
		}
	}

	/**
	 * Get all metrics
	 */
	getMetrics(): PerformanceMetric[] {
		return [...this.metrics];
	}

	/**
	 * Get metrics by name
	 */
	getMetricsByName(name: string): PerformanceMetric[] {
		return this.metrics.filter((m) => m.name === name);
	}

	/**
	 * Get average duration for a metric
	 */
	getAverageDuration(name: string): number {
		const metrics = this.getMetricsByName(name);
		if (metrics.length === 0) return 0;
		const sum = metrics.reduce((acc, m) => acc + m.duration, 0);
		return sum / metrics.length;
	}

	/**
	 * Get slowest operations
	 */
	getSlowestOperations(limit: number = 10): PerformanceMetric[] {
		return [...this.metrics].sort((a, b) => b.duration - a.duration).slice(0, limit);
	}

	/**
	 * Clear all metrics
	 */
	clear(): void {
		this.metrics = [];
	}

	/**
	 * Generate performance report
	 */
	generateReport(): string {
		const slowest = this.getSlowestOperations(20);
		const report = ['📊 Performance Report', '='.repeat(50)];

		// Group by name and show stats
		const grouped = new Map<string, PerformanceMetric[]>();
		this.metrics.forEach((m) => {
			const existing = grouped.get(m.name) || [];
			existing.push(m);
			grouped.set(m.name, existing);
		});

		report.push('\n📈 Operation Statistics:');
		grouped.forEach((metrics, name) => {
			const avg = metrics.reduce((sum, m) => sum + m.duration, 0) / metrics.length;
			const max = Math.max(...metrics.map((m) => m.duration));
			const min = Math.min(...metrics.map((m) => m.duration));
			report.push(`  ${name}:`);
			report.push(`    Count: ${metrics.length}`);
			report.push(`    Avg: ${avg.toFixed(2)}ms`);
			report.push(`    Min: ${min.toFixed(2)}ms`);
			report.push(`    Max: ${max.toFixed(2)}ms`);
		});

		report.push('\n🐌 Slowest Operations:');
		slowest.forEach((m, i) => {
			report.push(`  ${i + 1}. ${m.name}: ${m.duration.toFixed(2)}ms`);
			if (m.metadata) {
				report.push(`     Metadata: ${JSON.stringify(m.metadata)}`);
			}
		});

		return report.join('\n');
	}

	/**
	 * Log performance report
	 */
	logReport(): void {
		if (this.enabled) {
			console.log(this.generateReport());
		}
	}

	/**
	 * Export metrics as JSON for analysis
	 */
	exportMetrics(): string {
		return JSON.stringify(
			{
				metrics: this.metrics,
				summary: {
					totalOperations: this.metrics.length,
					slowest: this.getSlowestOperations(20).map((m) => ({
						name: m.name,
						duration: m.duration,
						metadata: m.metadata,
					})),
					averages: this.getAverageDurations(),
				},
				timestamp: new Date().toISOString(),
			},
			null,
			2,
		);
	}

	/**
	 * Get average durations for all tracked operations
	 */
	getAverageDurations(): Record<string, number> {
		const grouped = new Map<string, PerformanceMetric[]>();
		this.metrics.forEach((m) => {
			const existing = grouped.get(m.name) || [];
			existing.push(m);
			grouped.set(m.name, existing);
		});

		const averages: Record<string, number> = {};
		grouped.forEach((metrics, name) => {
			averages[name] = metrics.reduce((sum, m) => sum + m.duration, 0) / metrics.length;
		});

		return averages;
	}

	/**
	 * Generate a concise summary for sharing
	 */
	generateSummary(): string {
		const slowest = this.getSlowestOperations(10);
		const averages = this.getAverageDurations();
		const summary = ['📊 Performance Summary', '='.repeat(50)];

		summary.push(`\nTotal Operations: ${this.metrics.length}`);
		summary.push(
			`Time Range: ${new Date(this.metrics[0]?.timestamp || Date.now()).toLocaleTimeString()} - ${new Date(this.metrics[this.metrics.length - 1]?.timestamp || Date.now()).toLocaleTimeString()}`,
		);

		summary.push('\n📈 Average Durations:');
		Object.entries(averages)
			.sort((a, b) => b[1] - a[1])
			.slice(0, 10)
			.forEach(([name, avg]) => {
				summary.push(`  ${name}: ${avg.toFixed(2)}ms`);
			});

		summary.push('\n🐌 Slowest Operations:');
		slowest.forEach((m, i) => {
			summary.push(`  ${i + 1}. ${m.name}: ${m.duration.toFixed(2)}ms`);
		});

		// Performance insights
		summary.push('\n💡 Insights:');
		if (averages.playSound > 200) {
			summary.push('  ⚠️ playSound is slow - check network/artwork extraction');
		}
		if (averages.skipToNext > 100) {
			summary.push('  ⚠️ skipToNext is slow - verify fast path is being used');
		}
		if (averages['library-indexing'] > 5000) {
			summary.push('  ⚠️ Library indexing is slow - consider optimizing batch processing');
		}

		return summary.join('\n');
	}

	/**
	 * Copy metrics to clipboard (for sharing)
	 */
	async copyToClipboard(): Promise<void> {
		if (typeof navigator !== 'undefined' && navigator.clipboard) {
			await navigator.clipboard.writeText(this.exportMetrics());
			// console.log('✅ Metrics copied to clipboard!');
		} else {
			console.log('📋 Metrics JSON:\n', this.exportMetrics());
		}
	}
}

// Singleton instance
export const performanceMonitor = new PerformanceMonitor();

/**
 * Convenience function to track performance
 */
export function trackPerformance<T>(name: string, fn: () => T | Promise<T>, metadata?: Record<string, any>): T | Promise<T> {
	return performanceMonitor.track(name, fn as () => void | Promise<void>, metadata) as T | Promise<T>;
}

/**
 * React hook to track component render performance
 */
export function usePerformanceTracking(componentName: string) {
	const React = require('react');
	const { useEffect, useRef } = React;

	const renderStart = useRef(performance.now());
	const renderCount = useRef(0);

	useEffect(() => {
		if (!__DEV__) return;

		const duration = performance.now() - renderStart.current;
		renderCount.current += 1;

		if (duration > 16) {
			// Slower than 60fps
			console.warn(`⚠️ Slow render: ${componentName} (${renderCount.current}) took ${duration.toFixed(2)}ms`);
		}
	});
}
