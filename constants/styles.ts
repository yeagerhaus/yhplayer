import { StyleSheet } from 'react-native';

import type { BorderRadiusType, ButtonStyle, PaddingType } from '@/types';

export type ThemeColors = {
	background: string;
	text: string;
	textSecondary: string;
	textMuted: string;
	textInvert: string;
	brand: string;
	surface: string;
	surfaceSecondary: string;
	surfaceTertiary: string;
	surfaceElevated: string;
	border: string;
	borderSelected: string;
	borderSubtle: string;
	listDivider: string;
	inputBackground: string;
	inputBorder: string;
	danger: string;
	dangerSolid: string;
	success: string;
	link: string;
	icon: string;
	iconMuted: string;
	overlay: string;
	menuBackground: string;
	menuBorder: string;
	placeholder: string;
};

const Colors: { light: ThemeColors; dark: ThemeColors } = {
	light: {
		background: '#F0EDE8',
		text: '#0F1217',
		textSecondary: '#626875',
		textMuted: '#888888',
		textInvert: '#F0EDE8',
		brand: '#243762',
		surface: '#F0EDE8',
		surfaceSecondary: '#fafbfc',
		surfaceTertiary: '#e2e6ed',
		surfaceElevated: '#f5f5f5',
		border: '#e2e6ed',
		borderSelected: '#7f62f5',
		borderSubtle: '#d0d0d0',
		listDivider: '#ababab',
		inputBackground: '#f5f5f5',
		inputBorder: '#e2e6ed',
		danger: '#d93232',
		dangerSolid: '#ff3b30',
		success: '#1ecc64',
		link: '#5cbbff',
		icon: '#687076',
		iconMuted: '#a2a6ae',
		overlay: 'rgba(0, 0, 0, 0.5)',
		menuBackground: 'rgba(240, 240, 240, 0.95)',
		menuBorder: 'rgba(0, 0, 0, 0.1)',
		placeholder: 'rgba(0, 0, 0, 0.5)',
	},
	dark: {
		background: '#0F1217',
		text: '#F0EDE8',
		textSecondary: '#626875',
		textMuted: '#888888',
		textInvert: '#080808',
		brand: '#243762',
		surface: '#080808',
		surfaceSecondary: '#1c1c1e',
		surfaceTertiary: '#333333',
		surfaceElevated: '#1c1c1e',
		border: '#333333',
		borderSelected: '#7f62f5',
		borderSubtle: '#555555',
		listDivider: '#535353',
		inputBackground: '#111111',
		inputBorder: '#333333',
		danger: '#f85454',
		dangerSolid: '#ff3b30',
		success: '#1ecc64',
		link: '#8aceff',
		icon: '#9BA1A6',
		iconMuted: '#a2a6ae',
		overlay: 'rgba(0, 0, 0, 0.5)',
		menuBackground: 'rgba(40, 40, 40, 0.95)',
		menuBorder: 'rgba(255, 255, 255, 0.1)',
		placeholder: 'rgba(255, 255, 255, 0.5)',
	},
};

const DefaultSharedComponents = {
	borderRadiusXS: 4,
	borderRadiusSM: 8,
	borderRadiusMD: 10,
	borderRadiusXL: 100,
	fontWeight: 400,
	fontSize: 16,
	lineHeight: 1.5,
	letterSpacing: 0.4,
};

const DefaultTypography = StyleSheet.create({
	h1: {
		fontSize: 36,
		fontWeight: 700,
		lineHeight: 54,
	},
	h2: {
		fontSize: 24,
		fontWeight: 700,
		lineHeight: 36,
	},
	h3: {
		fontSize: 16,
		fontWeight: 700,
		lineHeight: 24,
	},
	h4: {
		fontSize: 12,
		fontWeight: 700,
		lineHeight: 18,
	},
	body: {
		fontSize: 16,
		fontWeight: 400,
		lineHeight: 24,
	},
	bodySM: {
		fontSize: 14,
		fontWeight: 400,
		lineHeight: 20,
	},
	bodyXS: {
		fontSize: 10,
		fontWeight: 400,
		lineHeight: 12,
	},
	label: {
		fontSize: 14,
		fontWeight: 700,
		lineHeight: 20,
		letterSpacing: 0.4,
	},
	link: {
		fontSize: 14,
		fontWeight: 700,
		lineHeight: 18,
		letterSpacing: 0.4,
	},
	linkSM: {
		fontSize: 13,
		fontWeight: 700,
		lineHeight: 16,
		letterSpacing: 0.4,
	},
});

const DefaultSizes = {
	gutterSize: 8,
	gutterSize2x: 16,
	gutterSize3x: 24,
	appNavWidth: 100,
};

const defaultButtonPadding: PaddingType = {
	top: 12,
	bottom: 12,
	left: 32,
	right: 32,
};

const defaultButtonBorderRadius: BorderRadiusType = {
	bottomLeft: 100,
	bottomRight: 100,
	topLeft: 100,
	topRight: 100,
};

export const defaultButtonStyles: ButtonStyle = {
	padding: defaultButtonPadding,
	borderRadius: defaultButtonBorderRadius,
	fontSize: 16,
	fontWeight: 700,
};

const DefaultStyles = StyleSheet.create({
	fontPrimary: {
		fontSize: DefaultSharedComponents.fontSize,
		fontWeight: DefaultSharedComponents.fontWeight as any,
		lineHeight: DefaultSharedComponents.lineHeight * DefaultSharedComponents.fontSize,
		letterSpacing: DefaultSharedComponents.letterSpacing,
	},
	center: {
		alignContent: 'center',
		alignItems: 'center',
		textAlign: 'center',
		justifyContent: 'center',
	},
	scrollContainer: {
		flexGrow: 1,
		flexDirection: 'column',
		paddingBottom: 50,
	},
	row: {
		flexDirection: 'row',
		alignItems: 'center',
	},
	section: {
		marginBottom: 30,
	},
	sectionHeader: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'center',
		marginBottom: 15,
	},
	sectionTitle: {
		fontSize: 18,
		fontWeight: '700',
		marginBottom: 10,
	},
	sectionDescription: {
		fontSize: 14,
		lineHeight: 20,
	},
	buttonRow: {
		flexDirection: 'row',
		gap: 10,
	},
	buttonDisabled: {
		opacity: 0.6,
	},
	inputLabel: {
		fontSize: 14,
		fontWeight: '600',
		marginBottom: 8,
	},
	listRowBorder: {
		borderBottomWidth: StyleSheet.hairlineWidth,
		paddingBottom: 14,
		paddingRight: 14,
	},
	menuItem: {
		paddingVertical: 14,
		paddingHorizontal: 16,
	},
	menuItemContent: {
		flexDirection: 'row',
		alignItems: 'center',
	},
});

export function createThemedStyles(colors: ThemeColors) {
	return StyleSheet.create({
		primaryButton: {
			paddingTop: defaultButtonPadding.top,
			paddingBottom: defaultButtonPadding.bottom,
			paddingLeft: defaultButtonPadding.left,
			paddingRight: defaultButtonPadding.right,
			borderRadius: DefaultSharedComponents.borderRadiusSM,
			fontSize: defaultButtonStyles.fontSize,
			fontWeight: defaultButtonStyles.fontWeight as any,
			backgroundColor: colors.brand,
			color: '#ffffff',
			alignItems: 'center',
		},
		secondaryButton: {
			paddingTop: defaultButtonPadding.top,
			paddingBottom: defaultButtonPadding.bottom,
			paddingLeft: defaultButtonPadding.left,
			paddingRight: defaultButtonPadding.right,
			borderRadius: DefaultSharedComponents.borderRadiusSM,
			fontSize: defaultButtonStyles.fontSize,
			fontWeight: defaultButtonStyles.fontWeight as any,
			backgroundColor: colors.surfaceSecondary,
			alignItems: 'center',
		},
		dangerButton: {
			paddingVertical: 15,
			paddingHorizontal: 20,
			borderRadius: DefaultSharedComponents.borderRadiusSM,
			alignItems: 'center',
			backgroundColor: colors.dangerSolid,
		},
		cancelButton: {
			paddingVertical: 12,
			paddingHorizontal: 20,
			borderRadius: DefaultSharedComponents.borderRadiusSM,
			alignItems: 'center',
			backgroundColor: colors.surfaceTertiary,
		},
		input: {
			backgroundColor: colors.inputBackground,
			borderRadius: DefaultSharedComponents.borderRadiusSM,
			padding: 12,
			fontSize: 16,
			borderWidth: 1,
			borderColor: colors.inputBorder,
			marginBottom: 15,
		},
		pinContainer: {
			backgroundColor: colors.inputBackground,
			padding: 20,
			borderRadius: DefaultSharedComponents.borderRadiusSM,
			borderWidth: 1,
			borderColor: colors.inputBorder,
			alignItems: 'center',
			marginBottom: 15,
		},
		pinCodeContainer: {
			padding: 20,
			borderRadius: DefaultSharedComponents.borderRadiusSM,
			borderWidth: 2,
			borderColor: colors.brand,
			marginVertical: 15,
			minWidth: 120,
			alignItems: 'center',
		},
		overlay: {
			flex: 1,
			backgroundColor: colors.overlay,
		},
		sheet: {
			backgroundColor: colors.surfaceElevated,
			borderTopLeftRadius: 16,
			borderTopRightRadius: 16,
			paddingBottom: 40,
			maxHeight: '70%',
		},
		menuContainer: {
			position: 'absolute',
			minWidth: 200,
			borderRadius: 12,
			backgroundColor: colors.menuBackground,
			shadowColor: '#000',
			shadowOffset: { width: 0, height: 4 },
			shadowOpacity: 0.3,
			shadowRadius: 8,
			elevation: 8,
			overflow: 'hidden',
		},
		menuItemBorder: {
			borderBottomWidth: StyleSheet.hairlineWidth,
			borderBottomColor: colors.menuBorder,
		},
	});
}

export { Colors, DefaultSharedComponents, DefaultTypography, DefaultSizes, DefaultStyles };
