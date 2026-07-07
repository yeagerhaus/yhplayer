import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useAppearanceStore } from '@/hooks/useAppearanceStore';
import { useColors } from '@/hooks/useColors';

export default function TabLayout() {
	const colors = useColors();
	const { showPodcastsTab, showMusicTab } = useAppearanceStore();

	return (
		<NativeTabs minimizeBehavior='onScrollDown' tintColor={colors.brand}>
			<NativeTabs.Trigger name='(library)' hidden={!showMusicTab}>
				<NativeTabs.Trigger.Icon
					sf={{ default: 'music.note.square.stack', selected: 'music.note.square.stack.fill' }}
					selectedColor={colors.brand}
				/>
				<NativeTabs.Trigger.Label>Library</NativeTabs.Trigger.Label>
			</NativeTabs.Trigger>
			<NativeTabs.Trigger name='(podcasts)' hidden={!showPodcastsTab}>
				<NativeTabs.Trigger.Icon
					sf={{ default: 'apple.podcasts.pages.fill', selected: 'apple.podcasts.pages.fill' }}
					selectedColor={colors.brand}
				/>
				<NativeTabs.Trigger.Label>Podcasts</NativeTabs.Trigger.Label>
			</NativeTabs.Trigger>
			<NativeTabs.Trigger name='(settings)'>
				<NativeTabs.Trigger.Icon sf={{ default: 'gearshape', selected: 'gearshape.fill' }} selectedColor={colors.brand} />
				<NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
			</NativeTabs.Trigger>
			{/* biome-ignore lint/a11y/useSemanticElements: NativeTabs.Trigger does not support semantic <search>; role=search is intentional for a11y */}
			<NativeTabs.Trigger name='search' role='search'>
				<NativeTabs.Trigger.Icon sf={{ default: 'magnifyingglass', selected: 'magnifyingglass' }} selectedColor={colors.brand} />
				<NativeTabs.Trigger.Label>Search</NativeTabs.Trigger.Label>
			</NativeTabs.Trigger>
		</NativeTabs>
	);
}
