import Constants from 'expo-constants';
import { SymbolView } from 'expo-symbols';
import { StyleSheet, Switch } from 'react-native';
import { Div, Text } from '@/components';
import { ContextMenu } from '@/components/ContextMenu';
import { Main } from '@/components/Main';
import { PerformanceDebugger } from '@/components/PerformanceDebugger';
import { DefaultStyles } from '@/constants/styles';
import { useColors } from '@/hooks/useColors';
import { type ScrubberStyle, useDevSettingsStore } from '@/hooks/useDevSettingsStore';
import { hexWithOpacity } from '@/utils/styles';

const SCRUBBER_OPTIONS: { value: ScrubberStyle; label: string }[] = [
	{ value: 'line', label: 'Line' },
	{ value: 'segmented', label: 'Segmented' },
	{ value: 'smooth', label: 'Smooth' },
];

export default function DeveloperScreen() {
	const colors = useColors();
	const showPerformanceDebugger = useDevSettingsStore((state) => state.showPerformanceDebugger);
	const setShowPerformanceDebugger = useDevSettingsStore((state) => state.setShowPerformanceDebugger);
	const scrubberStyle = useDevSettingsStore((state) => state.scrubberStyle);
	const setScrubberStyle = useDevSettingsStore((state) => state.setScrubberStyle);
	const version = Constants.expoConfig?.version ?? '—';

	const scrubberLabel = SCRUBBER_OPTIONS.find((o) => o.value === scrubberStyle)?.label ?? 'Line';

	return (
		<Main style={{ paddingHorizontal: 16 }}>
			<Div transparent>
				<Text type='h1' style={{ marginBottom: 16 }}>
					Developer
				</Text>
				<Text type='body' style={styles.version}>
					App version: {version}
				</Text>
			</Div>

			<Div style={[DefaultStyles.section, styles.section]} transparent>
				<Div style={styles.switchRow} transparent>
					<Text type='body'>Show performance debugger</Text>
					<Switch
						value={showPerformanceDebugger}
						onValueChange={setShowPerformanceDebugger}
						trackColor={{ false: colors.surfaceTertiary, true: hexWithOpacity(colors.brand, 0.5) }}
						thumbColor={showPerformanceDebugger ? colors.brand : colors.textMuted}
					/>
				</Div>

				<ContextMenu
					items={SCRUBBER_OPTIONS.map((option) => ({
						label: option.label,
						systemImage: option.value === scrubberStyle ? 'checkmark' : undefined,
						onPress: () => setScrubberStyle(option.value),
					}))}
				>
					<Div style={styles.switchRow} transparent>
						<Text type='body'>Scrubber style</Text>
						<Div style={styles.valueRow} transparent>
							<Text type='body' style={{ color: colors.textMuted }}>
								{scrubberLabel}
							</Text>
							<SymbolView name='chevron.up.chevron.down' size={14} tintColor={colors.textMuted} />
						</Div>
					</Div>
				</ContextMenu>
			</Div>

			{showPerformanceDebugger && <PerformanceDebugger />}
		</Main>
	);
}

const styles = StyleSheet.create({
	section: {
		marginTop: 8,
	},
	switchRow: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		paddingVertical: 8,
	},
	valueRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 6,
	},
	version: {
		marginBottom: 8,
	},
});
