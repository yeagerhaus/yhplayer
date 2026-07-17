import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { Div, DynamicItem, ForYouCard, HeroCard, HomeSection, Main, Text } from '@/components';
import { useColors } from '@/hooks/useColors';
import { useHomeFeed } from '@/hooks/useHomeFeed';
import { useLibraryStore } from '@/hooks/useLibraryStore';
import { useOfflineFilteredLibrary } from '@/hooks/useOfflineFilteredLibrary';
import type { HomeFeedItem } from '@/types';
import { clearCacheAndReload } from '@/utils/cache';

const ITEM_SIZE = 190;
const SECTION_LIMIT = 15;

const SECTIONS = [
	{ title: 'Playlists', icon: 'music.note.list', route: '/(tabs)/(library)/(playlists)' },
	{ title: 'Artists', icon: 'person.2.fill', route: '/(tabs)/(library)/(artists)' },
	{ title: 'Albums', icon: 'square.stack.3d.up.fill', route: '/(tabs)/(library)/(albums)' },
	{ title: 'Songs', icon: 'music.note', route: '/(tabs)/(library)/songs' },
] as const;

export default function LibraryScreen() {
	const colors = useColors();
	const router = useRouter();
	const { tracks, albums, recentlyPlayed, playlists } = useOfflineFilteredLibrary();
	const hasInitialized = useLibraryStore((s) => s.hasInitialized);
	const trackCount = tracks.length;
	const [refreshing, setRefreshing] = useState(false);
	const isLoading = !hasInitialized;
	const isEmpty = hasInitialized && trackCount === 0;

	const recentlyAdded = useMemo(
		() =>
			[...albums]
				.filter((a) => a.addedAt != null)
				.sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0))
				.slice(0, SECTION_LIMIT),
		[albums],
	);

	const recentPlaylists = useMemo(
		() =>
			[...playlists]
				.filter((p) => p.playlistType === 'audio' && p.artworkUrl != null)
				.sort((a, b) => (b.lastViewedAt ?? 0) - (a.lastViewedAt ?? 0))
				.slice(0, SECTION_LIMIT),
		[playlists],
	);

	const limitedRecentlyPlayed = useMemo(() => recentlyPlayed.slice(0, SECTION_LIMIT), [recentlyPlayed]);

	const homeFeed = useHomeFeed();
	const heroItem = homeFeed[0];
	const forYouItems = useMemo(() => homeFeed.slice(1), [homeFeed]);

	const onRefresh = useCallback(async () => {
		setRefreshing(true);
		await clearCacheAndReload();
		setRefreshing(false);
	}, []);

	const renderForYou = useCallback((item: HomeFeedItem) => <ForYouCard item={item} size={ITEM_SIZE} />, []);

	const renderRecentlyPlayed = useCallback(
		(item: (typeof limitedRecentlyPlayed)[0]) => (
			<DynamicItem type='largeSong' item={item} queue={limitedRecentlyPlayed} size={ITEM_SIZE} editorial />
		),
		[limitedRecentlyPlayed],
	);

	const renderRecentlyAdded = useCallback(
		(item: (typeof recentlyAdded)[0]) => (
			<DynamicItem
				type='album'
				item={{ id: item.id, album: item.title, artwork: item.artwork, artist: item.artist }}
				size={ITEM_SIZE}
				editorial
			/>
		),
		[recentlyAdded],
	);

	const renderRecentPlaylists = useCallback(
		(item: (typeof recentPlaylists)[0]) => (
			<DynamicItem
				type='playlist'
				item={{
					id: item.key ?? item.id,
					title: item.title,
					artwork: item.artworkUrl ?? '',
					count: item.leafCount ?? 0,
				}}
				size={ITEM_SIZE}
				editorial
			/>
		),
		[recentPlaylists],
	);

	return (
		<Main refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}>
			{isEmpty ? (
				<Div transparent style={styles.emptyState}>
					<Text type='bodySM' style={styles.emptyText}>
						No library data available
					</Text>
					<Text type='body' style={styles.emptySubtext}>
						Pull to refresh or check your server connection
					</Text>
				</Div>
			) : (
				<Div transparent display='flex' flex={1} gap={16} style={{ paddingBottom: 40 }}>
					{heroItem && <HeroCard item={heroItem} />}

					{(forYouItems.length > 0 || isLoading) && (
						<HomeSection
							title='For You'
							data={forYouItems}
							keyExtractor={(item) => item.id}
							renderItem={renderForYou}
							isLoading={isLoading}
							itemSize={ITEM_SIZE}
						/>
					)}

					<HomeSection
						title='Recently Played'
						data={limitedRecentlyPlayed}
						keyExtractor={(item) => item.id}
						renderItem={renderRecentlyPlayed}
						isLoading={isLoading}
						itemSize={ITEM_SIZE}
						onSeeAll={() => router.push('/(tabs)/(library)/songs' as any)}
					/>

					<HomeSection
						title='Recently Added'
						data={recentlyAdded}
						keyExtractor={(item) => item.id}
						renderItem={renderRecentlyAdded}
						isLoading={isLoading}
						itemSize={ITEM_SIZE}
						onSeeAll={() => router.push('/(tabs)/(library)/(albums)' as any)}
					/>

					<HomeSection
						title='Recent Playlists'
						data={recentPlaylists}
						keyExtractor={(item) => item.key ?? item.id}
						renderItem={renderRecentPlaylists}
						isLoading={isLoading}
						itemSize={ITEM_SIZE}
						onSeeAll={() => router.push('/(tabs)/(library)/(playlists)' as any)}
					/>
				</Div>
			)}

			<Div flex={1} style={{ paddingHorizontal: 16, marginBottom: 16 }} transparent>
				<Text type='bodySM' colorVariant='muted' style={{ marginBottom: 12 }}>
					{Number(trackCount).toLocaleString()} {trackCount === 1 ? 'Song' : 'Songs'} in Library
				</Text>
				<View style={styles.sectionGrid}>
					{SECTIONS.map((section) => (
						<Pressable key={section.title} style={styles.sectionCard} onPress={() => router.push(section.route as any)}>
							<Div useGlass style={styles.sectionCardInner}>
								<SymbolView name={section.icon} size={28} type='hierarchical' tintColor={colors.text} />
								<Text type='label'>{section.title}</Text>
							</Div>
						</Pressable>
					))}
				</View>
			</Div>
		</Main>
	);
}

const styles = StyleSheet.create({
	sectionGrid: {
		flexDirection: 'row',
		flexWrap: 'wrap',
		gap: 10,
	},
	sectionCard: {
		width: '48%',
	},
	sectionCardInner: {
		borderRadius: 14,
		paddingVertical: 18,
		alignItems: 'center',
		justifyContent: 'center',
		gap: 8,
	},
	emptyState: {
		flex: 1,
		alignItems: 'center',
		justifyContent: 'center',
		paddingTop: 60,
		paddingHorizontal: 32,
	},
	emptyText: {
		opacity: 0.5,
		marginBottom: 8,
	},
	emptySubtext: {
		opacity: 0.35,
		textAlign: 'center',
		fontSize: 14,
	},
});
