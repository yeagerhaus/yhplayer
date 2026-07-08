import Slider from '@react-native-community/slider';
import { useCallback, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Switch, TouchableOpacity, View } from 'react-native';
import { Div, Text } from '@/components';
import { Main } from '@/components/Main';
import { DefaultStyles } from '@/constants/styles';
import { useColors, useThemedStyles } from '@/hooks/useColors';
import {
	CROSSFADE_CURVE_LABELS,
	CROSSFADE_CURVES,
	EQ_PRESETS,
	formatBitrateChoiceLabel,
	formatFrequency,
	STREAMING_BITRATE_KBPS_OPTIONS,
	usePlaybackSettingsStore,
} from '@/hooks/usePlaybackSettingsStore';
import { hexWithOpacity } from '@/utils/styles';

const EQ_TRACK_LENGTH = 150;
const EQ_SLIDER_THICKNESS = 34;

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

function EQBandSlider({
	frequency,
	gain,
	onValueChange,
	onSlidingStart,
	onSlidingComplete,
}: {
	frequency: number;
	gain: number;
	onValueChange: (v: number) => void;
	onSlidingStart?: () => void;
	onSlidingComplete?: (v: number) => void;
}) {
	const colors = useColors();
	return (
		<View style={styles.bandColumn}>
			<Text type='bodyXS' colorVariant='muted' style={styles.bandGainLabel}>
				{gain > 0 ? `+${gain.toFixed(0)}` : gain.toFixed(0)}
			</Text>
			<View style={styles.sliderWrapper}>
				<Slider
					style={styles.rotatedSlider}
					minimumValue={-12}
					maximumValue={12}
					step={1}
					value={gain}
					onValueChange={onValueChange}
					onSlidingStart={onSlidingStart}
					onSlidingComplete={onSlidingComplete}
					minimumTrackTintColor={colors.brand}
					maximumTrackTintColor={colors.surfaceTertiary}
					thumbTintColor={colors.brand}
				/>
			</View>
			<Text type='bodyXS' colorVariant='muted' style={styles.bandFreqLabel}>
				{formatFrequency(frequency)}
			</Text>
		</View>
	);
}

function BitrateChoiceRow({
	label,
	description,
	value,
	onSelect,
}: {
	label: string;
	description?: string;
	value: number | null;
	onSelect: (v: number | null) => void;
}) {
	return (
		<Div transparent style={{ marginBottom: 18 }}>
			<Text type='label' colorVariant='muted'>
				{label}
			</Text>
			{description ? (
				<Text type='bodyXS' colorVariant='muted' style={{ marginTop: 4 }}>
					{description}
				</Text>
			) : null}
			<Div transparent style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
				{STREAMING_BITRATE_KBPS_OPTIONS.map((opt) => (
					<PresetChip
						key={opt === null ? 'original' : String(opt)}
						name={formatBitrateChoiceLabel(opt)}
						selected={value === opt}
						onPress={() => onSelect(opt)}
					/>
				))}
			</Div>
		</Div>
	);
}

function PresetChip({ name, selected, onPress }: { name: string; selected: boolean; onPress: () => void }) {
	const colors = useColors();
	return (
		<TouchableOpacity
			style={[
				styles.presetChip,
				selected
					? { backgroundColor: colors.brand, borderColor: colors.brand }
					: { backgroundColor: colors.surfaceTertiary, borderColor: colors.borderSubtle },
			]}
			onPress={onPress}
		>
			<Text type='linkSM' style={{ color: selected ? '#ffffff' : colors.textMuted }}>
				{name}
			</Text>
		</TouchableOpacity>
	);
}

export default function PlaybackScreen() {
	const colors = useColors();
	const themed = useThemedStyles();
	const {
		equalizerEnabled,
		equalizerBands,
		selectedPreset,
		outputGainDb,
		normalizationEnabled,
		monoAudioEnabled,
		streamingBitrateWifi,
		streamingBitrateCellular,
		streamingTranscodeCapKbps,
		setEqualizerEnabled,
		setBandGain,
		setPreset,
		resetEQ,
		setOutputGain,
		setNormalizationEnabled,
		setMonoAudioEnabled,
		setStreamingBitrateWifi,
		setStreamingBitrateCellular,
		setStreamingTranscodeCapKbps,
		crossfadeEnabled,
		crossfadeDurationSec,
		crossfadeAdaptiveEnabled,
		crossfadeCurve,
		setCrossfadeEnabled,
		setCrossfadeDurationSec,
		setCrossfadeAdaptiveEnabled,
		setCrossfadeCurve,
	} = usePlaybackSettingsStore();

	const [scrollEnabled, setScrollEnabled] = useState(true);
	const gainTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const handleGainChange = useCallback(
		(value: number) => {
			if (gainTimerRef.current) clearTimeout(gainTimerRef.current);
			gainTimerRef.current = setTimeout(() => setOutputGain(value), 50);
		},
		[setOutputGain],
	);

	const handleBandSlidingStart = useCallback(() => setScrollEnabled(false), []);
	const handleBandSlidingComplete = useCallback(() => setScrollEnabled(true), []);

	const bandChangeHandlers = useRef<((v: number) => void)[]>([]);
	if (bandChangeHandlers.current.length !== equalizerBands.length) {
		bandChangeHandlers.current = equalizerBands.map((_, i) => (v: number) => setBandGain(i, v));
	}

	return (
		<Main style={{ paddingHorizontal: 16 }}>
			<ScrollView showsVerticalScrollIndicator={false} scrollEnabled={scrollEnabled} contentContainerStyle={{ paddingBottom: 40 }}>
				<Div transparent>
					<Text type='h1' style={{ marginBottom: 16 }}>
						Playback
					</Text>
				</Div>

				{/* Streaming & download quality */}
				<Div transparent style={DefaultStyles.section}>
					<Text type='h3' style={DefaultStyles.sectionTitle}>
						Streaming and downloads
					</Text>
					<Text style={[DefaultStyles.sectionDescription, { marginBottom: 8 }]}>
						Remote Plex music uses a max audio bitrate (kbps). We pick Wi‑Fi vs cellular from your connection; Original sends
						the file unchanged. Downloads always save the original file.
					</Text>

					<BitrateChoiceRow
						label='Wi‑Fi streaming'
						description='Used when you are on Wi‑Fi or Ethernet.'
						value={streamingBitrateWifi}
						onSelect={setStreamingBitrateWifi}
					/>
					<BitrateChoiceRow
						label='Cellular streaming'
						description='Used on mobile data.'
						value={streamingBitrateCellular}
						onSelect={setStreamingBitrateCellular}
					/>
					<BitrateChoiceRow
						label='Conversion cap'
						description='Optional ceiling when Plex transcodes (lower of this and your connection limit). Original leaves only Wi‑Fi/cellular in effect.'
						value={streamingTranscodeCapKbps}
						onSelect={setStreamingTranscodeCapKbps}
					/>
				</Div>

				{/* Equalizer Section */}
				<Div transparent style={DefaultStyles.section}>
					<Text type='h3' style={DefaultStyles.sectionTitle}>
						Equalizer
					</Text>

					<SwitchRow label='Enable Equalizer' value={equalizerEnabled} onValueChange={setEqualizerEnabled} />

					{equalizerEnabled && (
						<Div transparent style={{ marginTop: 16 }}>
							{/* Presets */}
							<Text type='label' colorVariant='muted' style={{ marginBottom: 8 }}>
								Presets
							</Text>
							<ScrollView
								horizontal
								showsHorizontalScrollIndicator={false}
								style={{ marginBottom: 16 }}
								contentContainerStyle={{ gap: 8 }}
							>
								{Object.keys(EQ_PRESETS).map((name) => (
									<PresetChip key={name} name={name} selected={selectedPreset === name} onPress={() => setPreset(name)} />
								))}
							</ScrollView>

							{/* EQ Band Sliders */}
							<View style={styles.bandsContainer}>
								<Div transparent style={styles.bandScaleLabels}>
									<Text type='bodyXS' colorVariant='muted'>
										+12
									</Text>
									<Text type='bodyXS' colorVariant='muted'>
										0
									</Text>
									<Text type='bodyXS' colorVariant='muted'>
										-12
									</Text>
								</Div>
								{equalizerBands.map((band, i) => (
									<EQBandSlider
										key={band.frequency}
										frequency={band.frequency}
										gain={band.gain}
										onValueChange={bandChangeHandlers.current[i]}
										onSlidingStart={handleBandSlidingStart}
										onSlidingComplete={handleBandSlidingComplete}
									/>
								))}
							</View>

							<TouchableOpacity style={[themed.cancelButton, { marginTop: 12 }]} onPress={resetEQ}>
								<Text type='h3'>Reset to Flat</Text>
							</TouchableOpacity>
						</Div>
					)}
				</Div>

				{/* Output Gain Section */}
				<Div transparent style={DefaultStyles.section}>
					<Text type='h3' style={DefaultStyles.sectionTitle}>
						Output Gain
					</Text>
					<Text style={[DefaultStyles.sectionDescription, { marginBottom: 12 }]}>Boost or cut the overall output level.</Text>
					<Div transparent style={styles.gainRow}>
						<Text type='bodyXS' colorVariant='muted'>
							-10 dB
						</Text>
						<Div transparent style={{ flex: 1, marginHorizontal: 8 }}>
							<Slider
								minimumValue={-10}
								maximumValue={10}
								step={0.5}
								value={outputGainDb}
								onValueChange={handleGainChange}
								minimumTrackTintColor={colors.brand}
								maximumTrackTintColor={colors.surfaceTertiary}
								thumbTintColor={colors.brand}
							/>
						</Div>
						<Text type='bodyXS' colorVariant='muted'>
							+10 dB
						</Text>
					</Div>
					<Div transparent style={{ alignItems: 'center', marginTop: 4 }}>
						<TouchableOpacity onPress={() => setOutputGain(0)}>
							<Text type='link' colorVariant='brand'>
								{outputGainDb > 0 ? `+${outputGainDb.toFixed(1)}` : outputGainDb.toFixed(1)} dB
								{outputGainDb !== 0 ? ' (tap to reset)' : ''}
							</Text>
						</TouchableOpacity>
					</Div>
				</Div>

				{/* Audio Processing Section */}
				<Div transparent style={DefaultStyles.section}>
					<Text type='h3' style={DefaultStyles.sectionTitle}>
						Audio Processing
					</Text>

					<SwitchRow
						label='Normalization'
						description='Prevents clipping and distortion when EQ or gain boosts the signal above 0 dBFS.'
						value={normalizationEnabled}
						onValueChange={setNormalizationEnabled}
					/>

					<View style={[styles.divider, { backgroundColor: colors.surfaceTertiary }]} />

					<SwitchRow
						label='Mono Audio'
						description='Mixes left and right channels together. Useful for single-earbud listening.'
						value={monoAudioEnabled}
						onValueChange={setMonoAudioEnabled}
					/>
				</Div>

				{/* Sweet Fades */}
				<Div transparent style={DefaultStyles.section}>
					<Text type='h3' style={DefaultStyles.sectionTitle}>
						Sweet Fades
					</Text>
					<Text style={[DefaultStyles.sectionDescription, { marginBottom: 12 }]}>
						Crossfade between tracks. With Adaptive on, overlap length uses Plex loudness data when available; otherwise it uses
						the duration below.
					</Text>

					<SwitchRow
						label='Sweet Fades'
						description='Blend the end of one track into the start of the next.'
						value={crossfadeEnabled}
						onValueChange={setCrossfadeEnabled}
					/>

					{crossfadeEnabled && (
						<>
							<View style={[styles.divider, { backgroundColor: colors.surfaceTertiary }]} />
							<SwitchRow
								label='Adaptive'
								description='Use per-track loudness from your Plex library when both tracks have it.'
								value={crossfadeAdaptiveEnabled}
								onValueChange={setCrossfadeAdaptiveEnabled}
							/>
							<Text type='label' colorVariant='muted' style={{ marginTop: 12, marginBottom: 8 }}>
								{crossfadeAdaptiveEnabled ? 'Fallback duration (seconds)' : 'Crossfade duration (seconds)'}
							</Text>
							<Div transparent style={styles.gainRow}>
								<Text type='bodyXS' colorVariant='muted'>
									1
								</Text>
								<Div transparent style={{ flex: 1, marginHorizontal: 8 }}>
									<Slider
										minimumValue={1}
										maximumValue={12}
										step={0.5}
										value={crossfadeDurationSec}
										onValueChange={setCrossfadeDurationSec}
										minimumTrackTintColor={colors.brand}
										maximumTrackTintColor={colors.surfaceTertiary}
										thumbTintColor={colors.brand}
									/>
								</Div>
								<Text type='bodyXS' colorVariant='muted'>
									12
								</Text>
							</Div>
							<Div transparent style={{ alignItems: 'center', marginTop: 4 }}>
								<Text type='body' colorVariant='muted'>
									{crossfadeDurationSec.toFixed(1)} s
								</Text>
							</Div>

							<View style={[styles.divider, { backgroundColor: colors.surfaceTertiary }]} />
							<Text type='label' colorVariant='muted' style={{ marginBottom: 4 }}>
								Fade curve
							</Text>
							<Text type='bodyXS' colorVariant='muted' style={{ marginBottom: 10 }}>
								Shape of the volume blend. Equal power keeps a steady level; S-curve is smoothest; logarithmic separates
								busy tracks.
							</Text>
							<Div transparent style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
								{CROSSFADE_CURVES.map((curve) => (
									<PresetChip
										key={curve}
										name={CROSSFADE_CURVE_LABELS[curve]}
										selected={crossfadeCurve === curve}
										onPress={() => setCrossfadeCurve(curve)}
									/>
								))}
							</Div>
						</>
					)}
				</Div>
			</ScrollView>
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
	bandsContainer: {
		flexDirection: 'row',
		alignItems: 'stretch',
		justifyContent: 'space-between',
		height: EQ_TRACK_LENGTH + 28,
		paddingLeft: 28,
	},
	bandScaleLabels: {
		position: 'absolute',
		left: 0,
		top: 0,
		bottom: 20,
		justifyContent: 'space-between',
		width: 24,
	},
	bandColumn: {
		flex: 1,
		alignItems: 'center',
		justifyContent: 'space-between',
	},
	bandGainLabel: {
		textAlign: 'center',
		height: 14,
	},
	bandFreqLabel: {
		textAlign: 'center',
		height: 14,
	},
	sliderWrapper: {
		width: EQ_SLIDER_THICKNESS,
		height: EQ_TRACK_LENGTH,
		justifyContent: 'center',
		alignItems: 'center',
	},
	rotatedSlider: {
		width: EQ_TRACK_LENGTH,
		height: EQ_SLIDER_THICKNESS,
		transform: [{ rotate: '-90deg' }],
	},
	presetChip: {
		paddingHorizontal: 14,
		paddingVertical: 7,
		borderRadius: 100,
		borderWidth: 1,
	},
	gainRow: {
		flexDirection: 'row',
		alignItems: 'center',
	},
	divider: {
		height: StyleSheet.hairlineWidth,
		marginVertical: 4,
	},
});
