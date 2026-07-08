import AVFoundation

// MARK: - Delegate

protocol PodcastPlayerDelegate: AnyObject {
	func podcastPlayer(_ player: PodcastPlayer, didFinishTrack trackId: String)
	func podcastPlayer(_ player: PodcastPlayer, didEncounterError error: String, trackId: String)
}

// MARK: - PodcastPlayer

/// Lightweight streaming player for podcasts.
///
/// Podcasts don't need the EQ / normalization / crossfade / gapless machinery that lives on
/// `AudioEnginePlayer` — they need progressive streaming and instant seeking into arbitrary
/// positions (resuming a 3‑hour episode in the middle). AVPlayer gives us both for free via HTTP
/// range requests, without downloading the whole file first.
///
/// A seek that arrives before the item is ready is stored and applied once playback is ready, so
/// resume-from-position works reliably regardless of call ordering from JS.
final class PodcastPlayer {
	weak var delegate: PodcastPlayerDelegate?

	private let player = AVPlayer()
	private(set) var currentTrackId: String?

	private var _rate: Float = 1.0
	private var _volume: Float = 1.0

	/// User intent to play (survives buffering stalls). Mirrors `AudioEnginePlayer._isPlaying`.
	private var shouldBePlaying = false
	/// Seek requested before the item was ready; applied on `.readyToPlay`.
	private var pendingSeekSeconds: Double?

	private var statusObserver: NSKeyValueObservation?
	private var endObserver: NSObjectProtocol?
	private var failObserver: NSObjectProtocol?

	init() {
		player.automaticallyWaitsToMinimizeStalling = true
		player.volume = _volume
	}

	deinit {
		cleanupItemObservers()
	}

	// MARK: - State

	/// Intent-based, so brief buffering stalls don't flip the UI to "paused".
	var isPlaying: Bool { shouldBePlaying }

	var currentPosition: Double {
		let t = player.currentTime().seconds
		return t.isFinite && t >= 0 ? t : 0
	}

	var currentDuration: Double {
		guard let item = player.currentItem else { return 0 }
		let d = item.duration.seconds
		if d.isFinite && d > 0 { return d }
		// Live/undetermined duration: fall back to the seekable range end.
		if let range = item.seekableTimeRanges.last?.timeRangeValue {
			let end = (range.start + range.duration).seconds
			if end.isFinite && end > 0 { return end }
		}
		return 0
	}

	var rate: Float { _rate }

	// MARK: - Playback

	func play(url: URL, trackId: String, startAt: Double?, startPaused: Bool = false) {
		cleanupItemObservers()

		currentTrackId = trackId
		pendingSeekSeconds = (startAt != nil && startAt! > 0) ? startAt : nil
		shouldBePlaying = !startPaused

		let item = AVPlayerItem(asset: AVURLAsset(url: url))
		// Preserve pitch when the user speeds up voice content.
		item.audioTimePitchAlgorithm = .timeDomain
		player.replaceCurrentItem(with: item)
		player.volume = _volume

		print("YhwavAudio: podcast play trackId=\(trackId) startAt=\(startAt.map { String(format: "%.1f", $0) } ?? "nil")")

		statusObserver = item.observe(\.status, options: [.new, .initial]) { [weak self] observedItem, _ in
			guard let self = self else { return }
			switch observedItem.status {
			case .readyToPlay:
				self.applyPendingSeekAndStartIfNeeded()
			case .failed:
				let msg = observedItem.error?.localizedDescription ?? "Podcast failed to load"
				print("YhwavAudio: podcast item failed trackId=\(trackId): \(msg)")
				self.delegate?.podcastPlayer(self, didEncounterError: msg, trackId: trackId)
			default:
				break
			}
		}

		endObserver = NotificationCenter.default.addObserver(
			forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main
		) { [weak self] _ in
			guard let self = self, let tid = self.currentTrackId else { return }
			print("YhwavAudio: podcast ended trackId=\(tid)")
			self.shouldBePlaying = false
			self.delegate?.podcastPlayer(self, didFinishTrack: tid)
		}

		failObserver = NotificationCenter.default.addObserver(
			forName: .AVPlayerItemFailedToPlayToEndTime, object: item, queue: .main
		) { [weak self] note in
			guard let self = self, let tid = self.currentTrackId else { return }
			let err = note.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? Error
			let msg = err?.localizedDescription ?? "Podcast stalled"
			print("YhwavAudio: podcast failed to play to end trackId=\(tid): \(msg)")
			self.delegate?.podcastPlayer(self, didEncounterError: msg, trackId: tid)
		}
	}

	private func applyPendingSeekAndStartIfNeeded() {
		if let seconds = pendingSeekSeconds {
			pendingSeekSeconds = nil
			let time = CMTime(seconds: max(0, seconds), preferredTimescale: 600)
			player.seek(to: time, toleranceBefore: .zero, toleranceAfter: CMTime(seconds: 1, preferredTimescale: 600)) { [weak self] _ in
				guard let self = self else { return }
				if self.shouldBePlaying { self.player.rate = self._rate }
			}
		} else if shouldBePlaying {
			player.rate = _rate
		}
	}

	func resume() {
		shouldBePlaying = true
		if player.currentItem?.status == .readyToPlay {
			player.rate = _rate
		}
	}

	func pause() {
		shouldBePlaying = false
		player.pause()
	}

	/// Seeks immediately if the item is ready; otherwise defers until `.readyToPlay`.
	func seek(to seconds: Double) {
		let clamped = max(0, seconds)
		guard let item = player.currentItem, item.status == .readyToPlay else {
			pendingSeekSeconds = clamped
			return
		}
		let time = CMTime(seconds: clamped, preferredTimescale: 600)
		player.seek(to: time, toleranceBefore: .zero, toleranceAfter: CMTime(seconds: 1, preferredTimescale: 600))
	}

	func setRate(_ value: Float) {
		_rate = max(0.5, min(2.0, value))
		if shouldBePlaying && player.currentItem?.status == .readyToPlay {
			player.rate = _rate
		}
	}

	func setVolume(_ value: Float) {
		_volume = max(0, min(1, value))
		player.volume = _volume
	}

	func stop() {
		shouldBePlaying = false
		pendingSeekSeconds = nil
		player.pause()
		cleanupItemObservers()
		player.replaceCurrentItem(with: nil)
		currentTrackId = nil
	}

	private func cleanupItemObservers() {
		statusObserver?.invalidate()
		statusObserver = nil
		if let o = endObserver {
			NotificationCenter.default.removeObserver(o)
			endObserver = nil
		}
		if let o = failObserver {
			NotificationCenter.default.removeObserver(o)
			failObserver = nil
		}
	}
}
