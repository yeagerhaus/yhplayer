import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useMemo } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable } from 'react-native';
import { Div, DynamicItem, Main, Text } from '@/components';
import { useColors } from '@/hooks/useColors';
import { useLibraryStore } from '@/hooks/useLibraryStore';
import { useOfflineFilteredLibrary } from '@/hooks/useOfflineFilteredLibrary';
import { usePlaylists } from '@/hooks/usePlaylists';
import { createPlaylist } from '@/utils/plex';

export default function PlaylistsScreen() {
	const colors = useColors();
	const { playlists: rawPlaylists, isLoading } = usePlaylists();
	const { playlists } = useOfflineFilteredLibrary();
	const setPlaylists = useLibraryStore((s) => s.setPlaylists);
	const hasNoPlaylists = useMemo(() => !playlists.length, [playlists]);

	const formattedPlaylists = useMemo(
		() =>
			playlists
				.filter((playlist) => playlist.playlistType === 'audio') // && playlist.artworkUrl != null) // NOTE: Uncomment this if you ever want to filter by artwork again
				.map((playlist) => ({
					id: playlist.key || playlist.id,
					title: playlist.title,
					subtitle: playlist.summary || `${playlist.leafCount || 0} tracks`,
					artwork: playlist.artworkUrl || playlist.artwork || '',
					count: playlist.leafCount || 0,
					duration: playlist.duration || 0,
				}))
				.sort((a, b) => a.title.localeCompare(b.title)),
		[playlists],
	);

	const handleCreatePlaylist = useCallback(() => {
		if (Platform.OS === 'ios') {
			Alert.prompt('New Playlist', 'Enter a name for your playlist', async (name) => {
				if (!name?.trim()) return;
				const newPlaylist = await createPlaylist(name.trim());
				if (newPlaylist) {
					setPlaylists([...rawPlaylists, newPlaylist]);
					router.push({
						pathname: '/(tabs)/(library)/(playlists)/[playlistId]',
						params: { playlistId: newPlaylist.key },
					});
				}
			});
		} else {
			Alert.alert('New Playlist', 'Enter a name for your playlist');
		}
	}, [rawPlaylists, setPlaylists]);

	const keyExtractor = useCallback((item: (typeof formattedPlaylists)[0]) => item.id.toString(), [formattedPlaylists]);

	const renderItem = useCallback(({ item }: { item: (typeof formattedPlaylists)[0] }) => <DynamicItem item={item} type='playlist' />, []);

	const listHeaderComponent = useMemo(
		() => (
			<Div
				transparent
				style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 64, marginBottom: 16 }}
			>
				<Text type='h1'>Playlists</Text>
				<Pressable onPress={handleCreatePlaylist} hitSlop={8}>
					<SymbolView name='plus.circle' size={28} tintColor={colors.brand} />
				</Pressable>
			</Div>
		),
		[handleCreatePlaylist, colors.brand],
	);

	if (isLoading) {
		return (
			<Main>
				<Div transparent style={{ paddingHorizontal: 16, flex: 1, justifyContent: 'center', alignItems: 'center' }}>
					<ActivityIndicator />
				</Div>
			</Main>
		);
	}

	if (hasNoPlaylists) {
		return (
			<Main>
				<Div transparent style={{ paddingHorizontal: 16, flex: 1, justifyContent: 'center', alignItems: 'center' }}>
					<Text style={{ fontSize: 24, fontWeight: 'bold', marginBottom: 8 }}>Playlists</Text>
					<Text type='body' colorVariant='muted'>
						No playlists found
					</Text>
					<Pressable onPress={handleCreatePlaylist} style={{ marginTop: 16 }}>
						<Text type='body' colorVariant='brand'>
							Create Playlist
						</Text>
					</Pressable>
				</Div>
			</Main>
		);
	}

	return (
		<Main scrollEnabled={false}>
			<FlashList
				data={formattedPlaylists}
				keyExtractor={keyExtractor}
				numColumns={2}
				renderItem={renderItem}
				ListHeaderComponent={listHeaderComponent}
				contentContainerStyle={{ paddingBottom: 100, paddingHorizontal: 16 }}
			/>
		</Main>
	);
}
