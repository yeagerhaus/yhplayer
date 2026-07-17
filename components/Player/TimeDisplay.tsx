import React from 'react';
import { useAudioStore } from '@/hooks/useAudioStore';
import { usePlaybackProgressStore } from '@/hooks/usePlaybackProgressStore';
import { Div } from '../Div';
import { Text } from '../Text';

const formatTime = (seconds: number, includeHours: boolean) => {
	const totalSeconds = Math.floor(seconds);
	if (includeHours) {
		const hours = Math.floor(totalSeconds / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		const secs = totalSeconds % 60;
		return `${hours}:${minutes < 10 ? '0' : ''}${minutes}:${secs < 10 ? '0' : ''}${secs}`;
	}
	const minutes = Math.floor(totalSeconds / 60);
	const secs = totalSeconds % 60;
	return `${minutes}:${secs < 10 ? '0' : ''}${secs}`;
};

export const TimeDisplay = React.memo(() => {
	const position = usePlaybackProgressStore((state) => state.position);
	const duration = usePlaybackProgressStore((state) => state.duration);
	const currentSong = useAudioStore((state) => state.currentSong);

	const isPodcast = currentSong?.source === 'podcast';
	const useLongFormat = isPodcast && duration >= 3600;

	const currentTime = formatTime(position, useLongFormat);
	const remainingTime = `-${formatTime(Math.max(0, duration - position), useLongFormat)}`;

	return (
		<Div
			transparent
			style={{
				flexDirection: 'row',
				justifyContent: 'space-between',
				marginTop: 2,
				marginBottom: 10,
				backgroundColor: 'transparent',
			}}
		>
			<Text style={{ fontSize: 12, opacity: 0.6, color: '#fff' }}>{currentTime}</Text>
			<Text style={{ fontSize: 12, opacity: 0.6, color: '#fff' }}>{remainingTime}</Text>
		</Div>
	);
});
