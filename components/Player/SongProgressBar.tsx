import { configureReanimatedLogger, ReanimatedLogLevel } from 'react-native-reanimated';
import { useDevSettingsStore } from '@/hooks/useDevSettingsStore';
import { BarScrubber } from './BarScrubber';
import { useScrubber } from './useScrubber';
import { WaveformScrubber } from './WaveformScrubber';

configureReanimatedLogger({
	level: ReanimatedLogLevel.warn,
	strict: false,
});

export function SongProgressBar() {
	const style = useDevSettingsStore((state) => state.scrubberStyle);
	const scrubber = useScrubber();

	if (style === 'segmented') return <WaveformScrubber variant='segmented' {...scrubber} />;
	if (style === 'smooth') return <WaveformScrubber variant='smooth' {...scrubber} />;
	return <BarScrubber {...scrubber} />;
}
