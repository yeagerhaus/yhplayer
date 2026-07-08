import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Switch, TextInput } from 'react-native';
import { Div, Text } from '@/components';
import { Main } from '@/components/Main';
import { DefaultStyles } from '@/constants/styles';
import { DEFAULT_BRAND_COLOR, useAppearanceStore } from '@/hooks/useAppearanceStore';
import { useColors } from '@/hooks/useColors';
import { hexWithOpacity } from '@/utils/styles';

const HEX_REGEX = /^#?([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

function normalizeHex(input: string): string | null {
	const m = input.trim().match(HEX_REGEX);
	if (!m) return null;
	let hex = m[1];
	if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
	return `#${hex}`;
}

function SwitchRow({
	label,
	description,
	value,
	onValueChange,
}: {
	label: string;
	description?: string;
	value: boolean;
	onValueChange: (v: boolean) => void;
}) {
	const colors = useColors();
	return (
		<Div transparent style={styles.switchRow}>
			<Div transparent style={{ flex: 1, marginRight: 12 }}>
				<Text type='body'>{label}</Text>
				{description && (
					<Text type='bodyXS' colorVariant='muted' style={{ marginTop: 2 }}>
						{description}
					</Text>
				)}
			</Div>
			<Switch
				value={value}
				onValueChange={onValueChange}
				trackColor={{ false: colors.surfaceTertiary, true: hexWithOpacity(colors.brand, 0.5) }}
				thumbColor={value ? colors.brand : colors.textMuted}
			/>
		</Div>
	);
}

export default function AppearanceScreen() {
	const {
		showPodcastsTab,
		setShowPodcastsTab,
		showMusicTab,
		setShowMusicTab,
		brandColor,
		setBrandColor,
		useBlurInsteadOfGlass,
		setUseBlurInsteadOfGlass,
	} = useAppearanceStore();
	const colors = useColors();
	const effectiveBrand = brandColor ?? DEFAULT_BRAND_COLOR;
	const [hexInput, setHexInput] = useState(effectiveBrand);

	useEffect(() => {
		setHexInput(brandColor ?? DEFAULT_BRAND_COLOR);
	}, [brandColor]);

	const handleHexSubmit = () => {
		const normalized = normalizeHex(hexInput);
		if (normalized) {
			setBrandColor(normalized);
			setHexInput(normalized);
		} else {
			setHexInput(effectiveBrand);
		}
	};

	const handleResetBrand = () => {
		setBrandColor(null);
		setHexInput(DEFAULT_BRAND_COLOR);
	};

	return (
		<Main style={{ paddingHorizontal: 16 }}>
			<Div transparent>
				<Text type='h1' style={{ marginBottom: 16 }}>
					Appearance
				</Text>
			</Div>

			<Div transparent style={DefaultStyles.section}>
				<Text type='h3' style={DefaultStyles.sectionTitle}>
					Brand color
				</Text>
				<Div transparent style={styles.brandRow}>
					<Pressable
						onPress={() => {}}
						style={[styles.swatch, { backgroundColor: effectiveBrand }]}
						accessibilityLabel='Brand color preview'
					/>
					<TextInput
						style={[
							styles.hexInput,
							{ color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBackground },
						]}
						value={hexInput}
						onChangeText={setHexInput}
						onBlur={handleHexSubmit}
						onSubmitEditing={handleHexSubmit}
						placeholder={DEFAULT_BRAND_COLOR}
						placeholderTextColor={colors.textMuted}
						autoCapitalize='none'
						autoCorrect={false}
						maxLength={9}
						selectTextOnFocus
					/>
					<Pressable
						onPress={handleResetBrand}
						style={[styles.defaultButton, { backgroundColor: colors.surfaceTertiary }]}
						accessibilityLabel='Reset to default brand color'
					>
						<Text type='bodySM' style={{ color: colors.text }}>
							Default
						</Text>
					</Pressable>
				</Div>
				{Platform.OS === 'web' && (
					<Div transparent style={styles.webColorRow}>
						<Text type='bodyXS' colorVariant='muted' style={{ marginRight: 8 }}>
							Pick color:
						</Text>
						<input
							type='color'
							value={effectiveBrand}
							onChange={(e) => {
								const v = e.target.value;
								setHexInput(v);
								setBrandColor(v);
							}}
							style={{ width: 40, height: 32, padding: 0, border: 'none', cursor: 'pointer', borderRadius: 6 }}
						/>
					</Div>
				)}
			</Div>

			{/* <Div transparent style={DefaultStyles.section}>
				<Text type='h3' style={DefaultStyles.sectionTitle}>
					Liquid Glass
				</Text>

				<SwitchRow
					label='Frosted glass layout'
					description='Replace liquid glass (mini player, navigation buttons) with frosted glass blur.'
					value={useBlurInsteadOfGlass}
					onValueChange={setUseBlurInsteadOfGlass}
				/>
			</Div> */}

			<Div transparent style={DefaultStyles.section}>
				<Text type='h3' style={DefaultStyles.sectionTitle}>
					Tabs
				</Text>

				<SwitchRow
					label='Show Music Tab'
					description='Toggle the Music tab in the bottom navigation bar.'
					value={showMusicTab}
					onValueChange={setShowMusicTab}
				/>

				<SwitchRow
					label='Show Podcasts Tab'
					description='Toggle the Podcasts tab in the bottom navigation bar.'
					value={showPodcastsTab}
					onValueChange={setShowPodcastsTab}
				/>
			</Div>
		</Main>
	);
}

const styles = StyleSheet.create({
	switchRow: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		paddingVertical: 8,
	},
	brandRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 12,
		paddingVertical: 8,
	},
	swatch: {
		width: 36,
		height: 36,
		borderRadius: 8,
		borderWidth: 1,
		borderColor: 'rgba(0,0,0,0.15)',
	},
	hexInput: {
		flex: 1,
		height: 40,
		borderWidth: 1,
		borderRadius: 8,
		paddingHorizontal: 12,
		fontSize: 14,
	},
	defaultButton: {
		paddingHorizontal: 14,
		height: 40,
		borderRadius: 8,
		justifyContent: 'center',
		alignItems: 'center',
	},
	webColorRow: {
		flexDirection: 'row',
		alignItems: 'center',
		paddingVertical: 4,
	},
});
