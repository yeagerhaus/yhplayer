import 'dotenv/config';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConfigContext, ExpoConfig } from '@expo/config';

function getBaseVersion(): string {
	const pkgPath = join(process.cwd(), 'package.json');
	const raw = readFileSync(pkgPath, 'utf-8');
	const pkg = JSON.parse(raw) as { version?: string };
	const v = pkg.version ?? '0.1';
	const segments = v.split('.');
	// Use first two segments (major.minor); if only one, use as-is and append 0
	const base = segments.length >= 2 ? `${segments[0]}.${segments[1]}` : `${v}.0`;
	return base;
}

function getCommitCount(): string {
	try {
		return execSync('git rev-list --count HEAD', { encoding: 'utf-8' }).trim();
	} catch {
		return '0';
	}
}

export default ({ config }: ConfigContext): ExpoConfig => {
	const baseVersion = getBaseVersion();
	const commitCount = getCommitCount();
	const version = `${baseVersion}.${commitCount}`;

	return {
		...config,
		name: 'Rite',
		slug: 'rite',
		version,
		orientation: 'portrait',
		icon: './assets/images/riteIcon.png',
		scheme: 'myapp',
		userInterfaceStyle: 'automatic',
		backgroundColor: '#080808',
		ios: {
			supportsTablet: true,
			bundleIdentifier: 'com.yhprod.rite',
			backgroundColor: '#080808',
			buildNumber: commitCount,
			infoPlist: {
				UIBackgroundModes: ['fetch', 'audio'],
			},
		},
		android: {
			...(typeof config.android === 'object' && config.android ? config.android : {}),
			versionCode: Number.parseInt(commitCount, 10),
		},
		web: {
			bundler: 'metro',
			output: 'static',
			favicon: './assets/images/favicon.png',
		},
		plugins: [
			'expo-router',
			[
				'expo-splash-screen',
				{
					image: './assets/images/lightSplash.png',
					resizeMode: 'cover',
					backgroundColor: '#ECECEA',
					dark: {
						image: './assets/images/darkSplash.png',
						backgroundColor: '#0A0A12',
					},
					preventAutoHide: true,
				},
			],
			'expo-web-browser',
			'expo-notifications',
			'expo-image',
			'expo-status-bar',
			'expo-font',
		],
		experiments: {
			typedRoutes: true,
		},
		extra: {
			...config.extra,
		},
	};
};
