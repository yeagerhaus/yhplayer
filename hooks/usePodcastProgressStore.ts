import { create } from 'zustand';
import { storage } from '@/lib/storage';

const STORAGE_KEY = 'PODCAST_EPISODE_PROGRESS';

export interface EpisodeProgress {
	position: number;
	duration: number;
	completed: boolean;
	updatedAt: number;
}

interface PodcastProgressState {
	/** Only episodes that have been played have an entry. */
	progressByEpisodeId: Record<string, EpisodeProgress>;
	hydrated: boolean;

	hydrate: () => void;
	getProgress: (episodeId: string) => EpisodeProgress | undefined;
	/** Save progress for an episode (only called for episodes we've played). */
	saveProgress: (episodeId: string, position: number, duration: number, completed?: boolean) => void;
	/** Mark episode as fully played so we don't resume. Optionally pass duration (e.g. when marking as played without playback). */
	markAsPlayed: (episodeId: string, duration?: number) => void;
	/** Mark multiple episodes as played (e.g. when importing a feed you're already up to date on). */
	markEpisodesAsPlayed: (episodes: Array<{ id: string; durationSeconds?: number }>) => void;
}

function persistProgress(progressByEpisodeId: Record<string, EpisodeProgress>) {
	storage.set(STORAGE_KEY, JSON.stringify(progressByEpisodeId));
}

export const usePodcastProgressStore = create<PodcastProgressState>((set, get) => ({
	progressByEpisodeId: {},
	hydrated: false,

	hydrate: () => {
		try {
			const raw = storage.getString(STORAGE_KEY);
			if (!raw) {
				set({ hydrated: true });
				return;
			}
			const parsed = JSON.parse(raw) as Record<string, EpisodeProgress>;
			const normalized: Record<string, EpisodeProgress> = {};
			for (const [id, p] of Object.entries(parsed)) {
				if (p && typeof p.position === 'number') {
					normalized[id] = {
						position: p.position,
						duration: typeof p.duration === 'number' ? p.duration : 0,
						completed: Boolean(p.completed),
						updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : Date.now(),
					};
				}
			}
			set({ progressByEpisodeId: normalized, hydrated: true });
		} catch {
			set({ hydrated: true });
		}
	},

	getProgress: (episodeId: string) => get().progressByEpisodeId[episodeId],

	saveProgress: (episodeId: string, position: number, duration: number, completed?: boolean) => {
		const { progressByEpisodeId } = get();
		const existing = progressByEpisodeId[episodeId];
		// Only mark complete near the actual end. Use an absolute 60s cap so long episodes (e.g. a
		// 3-hour show) aren't flagged complete ~9 minutes early by a percentage rule; fall back to a
		// tight 98% for short clips where 60s would be most of the episode.
		const NEAR_END_SECONDS = 60;
		const completionThreshold = duration > 0 ? Math.max(duration - NEAR_END_SECONDS, duration * 0.98) : 0;
		const isCompleted = completed ?? (duration > 0 && position >= completionThreshold);
		const next: EpisodeProgress = {
			position: Math.max(0, position),
			duration: Math.max(0, duration),
			// When completed is explicitly passed (true or false), use it directly;
			// otherwise auto-detect OR preserve existing completed state.
			completed: completed != null ? isCompleted : existing?.completed || isCompleted,
			updatedAt: Date.now(),
		};
		const nextMap = { ...progressByEpisodeId, [episodeId]: next };
		set({ progressByEpisodeId: nextMap });
		persistProgress(nextMap);
	},

	markAsPlayed: (episodeId: string, duration?: number) => {
		const { progressByEpisodeId } = get();
		const existing = progressByEpisodeId[episodeId];
		const durationToUse = duration ?? existing?.duration ?? 0;
		const next: EpisodeProgress = {
			position: existing?.position ?? durationToUse,
			duration: durationToUse,
			completed: true,
			updatedAt: Date.now(),
		};
		const nextMap = { ...progressByEpisodeId, [episodeId]: next };
		set({ progressByEpisodeId: nextMap });
		persistProgress(nextMap);
	},
	markEpisodesAsPlayed: (episodes: Array<{ id: string; durationSeconds?: number }>) => {
		const { progressByEpisodeId } = get();
		const nextMap = { ...progressByEpisodeId };
		const now = Date.now();
		for (const { id, durationSeconds } of episodes) {
			const existing = nextMap[id];
			const durationToUse = durationSeconds ?? existing?.duration ?? 0;
			nextMap[id] = {
				position: existing?.position ?? durationToUse,
				duration: durationToUse,
				completed: true,
				updatedAt: now,
			};
		}
		set({ progressByEpisodeId: nextMap });
		persistProgress(nextMap);
	},
}));
