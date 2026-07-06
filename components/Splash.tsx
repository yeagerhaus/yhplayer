import * as ExpoSplashScreen from 'expo-splash-screen';
import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, useColorScheme } from 'react-native';
import { useLibraryStore } from '@/hooks/useLibraryStore';

const lightSplash = require('../assets/images/lightSplash.png');
const darkSplash = require('../assets/images/darkSplash.png');

/** Backing color while the image opacity fades in (matches splash PNG backgrounds). */
const SPLASH_BACKDROP = {
	light: '#F0EDE8',
	dark: '#0F1217',
} as const;

const FADE_OUT_MS = 500;

export function SplashOverlay() {
	const hasInitialized = useLibraryStore((s) => s.hasInitialized);
	const colorScheme = useColorScheme();
	const isDark = colorScheme === 'dark';

	const exitOpacity = useRef(new Animated.Value(1)).current;
	const [visible, setVisible] = useState(true);

	useEffect(() => {
		ExpoSplashScreen.hideAsync().catch(() => {});
	}, []);

	useEffect(() => {
		if (!hasInitialized) return;
		Animated.timing(exitOpacity, {
			toValue: 0,
			duration: FADE_OUT_MS,
			useNativeDriver: true,
		}).start(() => setVisible(false));
	}, [hasInitialized, exitOpacity]);

	if (!visible) return null;

	const backdrop = isDark ? SPLASH_BACKDROP.dark : SPLASH_BACKDROP.light;

	return (
		<Animated.View style={[styles.overlay, { opacity: exitOpacity, backgroundColor: backdrop }]}>
			<Animated.Image source={isDark ? darkSplash : lightSplash} style={[styles.image]} resizeMode='cover' />
		</Animated.View>
	);
}

const styles = StyleSheet.create({
	overlay: {
		...StyleSheet.absoluteFill,
		zIndex: 9999,
	},
	image: {
		...StyleSheet.absoluteFill,
		width: undefined,
		height: undefined,
	},
});
