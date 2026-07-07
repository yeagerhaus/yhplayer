import { useMemo } from 'react';
import { useColorScheme } from 'react-native';

import { Colors, createThemedStyles, type ThemeColors } from '@/constants/styles';
import { useAppearanceStore } from '@/hooks/useAppearanceStore';

export function useColors(): ThemeColors {
	const colorScheme = useColorScheme() === 'light' ? 'light' : 'dark';
	const brandColor = useAppearanceStore((s) => s.brandColor);
	const base = Colors[colorScheme];
	if (brandColor) {
		return { ...base, brand: brandColor, borderSelected: brandColor };
	}
	return base;
}

export function useThemedStyles() {
	const colors = useColors();
	return useMemo(() => createThemedStyles(colors), [colors]);
}
