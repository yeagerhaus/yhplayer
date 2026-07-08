import * as FileSystem from 'expo-file-system/legacy';
import { create } from 'zustand';
import { storage } from '@/lib/storage';
import type { PodcastDownload, PodcastEpisode, PodcastFeed } from '@/types/podcast';

const STORAGE_KEY = 'PODCAST_DOWNLOADS';

/** Safe filename segment from episode id (no path separators). */
function safeSegment(id: string): string {
	return encodeURIComponent(id).replace(/%/g, '_').slice(0, 120);
}

/** Infer file extension from enclosure URL or default to .mp3 */
function extensionFromUrl(url: string): string {
	try {
		const path = new URL(url).pathname;
		const ext = path.slice(path.lastIndexOf('.'));
		if (['.mp3', '.m4a', '.aac', '.ogg', '.wav'].includes(ext.toLowerCase())) return ext;
	} catch {}
	return '.mp3';
}

interface PodcastDownloadsState {
	/** episodeId -> download metadata (includes localUri) */
	downloads: Record<string, PodcastDownload>;
	/** episodeIds currently being downloaded */
	downloading: Set<string>;
	hydrated: boolean;

	hydrate: () => void;
	downloadEpisode: (episode: PodcastEpisode, feed: PodcastFeed) => Promise<void>;
	removeDownload: (episodeId: string) => Promise<void>;
	getDownload: (episodeId: string) => PodcastDownload | undefined;
	getLocalUri: (episodeId: string) => string | undefined;
	/** Resume position for a downloaded episode (from download record, not progress store). */
	getResumeAt: (episodeId: string) => number | undefined;
	/** Update resume position on the download record and persist. */
	updateResumeAt: (episodeId: string, position: number) => Promise<void>;
	getDownloadedEpisodesForFeed: (feedId: string) => PodcastDownload[];
	isDownloading: (episodeId: string) => boolean;
	isDownloaded: (episodeId: string) => boolean;
	removeAllDownloads: () => Promise<void>;
}

function persistDownloads(downloads: Record<string, PodcastDownload>) {
	const list = Object.values(downloads);
	storage.set(STORAGE_KEY, JSON.stringify(list));
}

/** Bounded parallelism so batch-downloading a feed doesn't open dozens of simultaneous connections. */
const MAX_CONCURRENT_PODCAST_DOWNLOADS = 3;
let activePodcastDownloads = 0;
const podcastDownloadQueue: Array<() => Promise<void>> = [];

function runPodcastDownloadQueue() {
	while (activePodcastDownloads < MAX_CONCURRENT_PODCAST_DOWNLOADS && podcastDownloadQueue.length > 0) {
		const job = podcastDownloadQueue.shift();
		if (!job) break;
		activePodcastDownloads++;
		void job().finally(() => {
			activePodcastDownloads--;
			runPodcastDownloadQueue();
		});
	}
}

export const usePodcastDownloadsStore = create<PodcastDownloadsState>((set, get) => ({
	downloads: {},
	downloading: new Set(),
	hydrated: false,

	hydrate: () => {
		try {
			const raw = storage.getString(STORAGE_KEY);
			if (!raw) {
				set({ hydrated: true });
				return;
			}
			const list: PodcastDownload[] = JSON.parse(raw);
			const downloads: Record<string, PodcastDownload> = {};
			for (const d of list) {
				const withId = d.id ? d : { ...d, id: d.episodeId };
				downloads[d.episodeId] = withId;
			}
			set({ downloads, hydrated: true });
		} catch {
			set({ hydrated: true });
		}
	},

	downloadEpisode: (episode: PodcastEpisode, feed: PodcastFeed) => {
		const { downloads, downloading } = get();
		if (downloads[episode.id] || downloading.has(episode.id)) return Promise.resolve();

		// Mark as downloading immediately (before the job runs) so rapid taps dedupe and the UI updates.
		set((s) => ({
			downloading: new Set(s.downloading).add(episode.id),
		}));

		return new Promise<void>((resolve, reject) => {
			podcastDownloadQueue.push(async () => {
				const dir = `${FileSystem.documentDirectory ?? ''}podcasts`;
				const ext = extensionFromUrl(episode.enclosureUrl);
				const filename = `${safeSegment(episode.id)}${ext}`;
				const localPath = `${dir}/${filename}`;

				try {
					await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
					const { uri } = await FileSystem.downloadAsync(episode.enclosureUrl, localPath);

					const entry: PodcastDownload = {
						episodeId: episode.id,
						id: episode.id,
						feedId: episode.feedId,
						localUri: uri,
						title: episode.title,
						showTitle: feed.title ?? feed.url ?? 'Show',
						pubDate: episode.pubDate,
						durationSeconds: episode.durationSeconds,
						imageUrl: episode.imageUrl ?? feed.imageUrl,
						downloadedAt: Date.now(),
					};

					set((s) => {
						const d = new Set(s.downloading);
						d.delete(episode.id);
						return { downloads: { ...s.downloads, [episode.id]: entry }, downloading: d };
					});
					persistDownloads(get().downloads);
					resolve();
				} catch {
					set((s) => {
						const d = new Set(s.downloading);
						d.delete(episode.id);
						return { downloading: d };
					});
					reject(new Error('Download failed'));
				}
			});
			runPodcastDownloadQueue();
		});
	},

	removeDownload: async (episodeId: string) => {
		const { downloads } = get();
		const entry = downloads[episodeId];
		if (!entry) return;

		try {
			await FileSystem.deleteAsync(entry.localUri, { idempotent: true });
		} catch {
			// ignore if file already gone
		}

		const next = { ...downloads };
		delete next[episodeId];
		set({ downloads: next });
		persistDownloads(next);
	},

	getDownload: (episodeId: string) => get().downloads[episodeId],

	getLocalUri: (episodeId: string) => get().downloads[episodeId]?.localUri,

	getResumeAt: (episodeId: string) => {
		const d = get().downloads[episodeId];
		return d?.resumeAt != null && d.resumeAt >= 0 ? d.resumeAt : undefined;
	},

	updateResumeAt: async (episodeId: string, position: number) => {
		const { downloads } = get();
		const entry = downloads[episodeId];
		if (!entry) return;
		const resumeAt = Math.max(0, position);
		const next = { ...downloads, [episodeId]: { ...entry, resumeAt } };
		set({ downloads: next });
		persistDownloads(next);
	},

	getDownloadedEpisodesForFeed: (feedId: string) => {
		return Object.values(get().downloads).filter((d) => d.feedId === feedId);
	},

	isDownloading: (episodeId: string) => get().downloading.has(episodeId),

	isDownloaded: (episodeId: string) => !!get().downloads[episodeId],

	removeAllDownloads: async () => {
		const { downloads } = get();
		for (const entry of Object.values(downloads)) {
			try {
				await FileSystem.deleteAsync(entry.localUri, { idempotent: true });
			} catch {}
		}
		set({ downloads: {}, downloading: new Set() });
		persistDownloads({});
	},
}));
