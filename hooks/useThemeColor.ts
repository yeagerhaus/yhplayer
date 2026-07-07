import { useColorScheme } from 'react-native';

import { Colors, type ThemeColors } from '@/constants/styles';

export function useThemeColor(props: { light?: string; dark?: string }, colorName: keyof ThemeColors) {
	const theme = useColorScheme() === 'light' ? 'light' : 'dark';
	const colorFromProps = props[theme];

	if (colorFromProps) {
		return colorFromProps;
	}
	return Colors[theme][colorName];
}
