import AVFoundation
import Accelerate
import ExpoModulesCore
import MediaPlayer
import UIKit

// MARK: - Records (JS → Swift)

struct SetupOptions: Record {
	@Field var iosCategory: String?
	@Field var iosCategoryMode: String?
	@Field var minBuffer: Double?
	@Field var maxBuffer: Double?
	@Field var playBuffer: Double?
	@Field var waitForBuffer: Bool?
	@Field var autoHandleInterruptions: Bool?
}

struct TrackRecord: Record {
	@Field var id: String
	@Field var url: String
	@Field var title: String?
	@Field var artist: String?
	@Field var album: String?
	@Field var artwork: String?
	@Field var duration: Double?
	/// Original Plex `/library/parts/...` URL when `url` is a transcode URL (used if transcode file is truncated).
	@Field var directUrl: String?
	/// When true, transition to this track uses gapless scheduling (e.g. podcasts) even if Sweet Fades is on.
	@Field var crossfadeDisabled: Bool?
}

struct CrossfadeConfigRecord: Record {
	@Field var enabled: Bool = false
	@Field var defaultDuration: Double = 4.0
	@Field var minDuration: Double = 1.0
	@Field var maxDuration: Double = 8.0
	@Field var fadeInOnManualSkip: Bool = true
	@Field var manualSkipFadeDuration: Double = 0.5
}

struct PlaybackStateRecord: Record {
	@Field var state: String = "stopped"
	@Field var position: Double = 0
	@Field var duration: Double = 0
	@Field var buffered: Double?
}

// MARK: - Shared DSP state (thread-safe, accessed from real-time audio thread)

final class AudioDSPState {
	static let shared = AudioDSPState()

	private let lock = os_unfair_lock_t.allocate(capacity: 1)

	private var _eqEnabled: Bool = false
	private var _eqBands: [(frequency: Float, gain: Float)] = []
	private var _outputGainLinear: Float = 1.0
	private var _normalizationEnabled: Bool = false
	private var _monoEnabled: Bool = false

	// Biquad filter state: 10 bands × 5 coefficients + delay state per channel
	private var _biquadCoefficients: [[Double]] = []
	private var _biquadDelaysL: [[Double]] = []
	private var _biquadDelaysR: [[Double]] = []
	private var _cachedSampleRate: Float = 0

	init() {
		lock.initialize(to: os_unfair_lock())
	}

	deinit {
		lock.deallocate()
	}

	var eqEnabled: Bool {
		os_unfair_lock_lock(lock); defer { os_unfair_lock_unlock(lock) }
		return _eqEnabled
	}

	var outputGainLinear: Float {
		os_unfair_lock_lock(lock); defer { os_unfair_lock_unlock(lock) }
		return _outputGainLinear
	}

	var normalizationEnabled: Bool {
		os_unfair_lock_lock(lock); defer { os_unfair_lock_unlock(lock) }
		return _normalizationEnabled
	}

	var monoEnabled: Bool {
		os_unfair_lock_lock(lock); defer { os_unfair_lock_unlock(lock) }
		return _monoEnabled
	}

	func setEqEnabled(_ v: Bool) {
		os_unfair_lock_lock(lock); _eqEnabled = v; os_unfair_lock_unlock(lock)
	}

	func setOutputGainDb(_ db: Float) {
		let linear = powf(10.0, db / 20.0)
		os_unfair_lock_lock(lock); _outputGainLinear = linear; os_unfair_lock_unlock(lock)
	}

	func setNormalizationEnabled(_ v: Bool) {
		os_unfair_lock_lock(lock); _normalizationEnabled = v; os_unfair_lock_unlock(lock)
	}

	func setMonoEnabled(_ v: Bool) {
		os_unfair_lock_lock(lock); _monoEnabled = v; os_unfair_lock_unlock(lock)
	}

	func setEqualizerBands(_ bands: [(frequency: Float, gain: Float)], sampleRate: Float) {
		os_unfair_lock_lock(lock)
		_eqBands = bands
		let needsRebuild = sampleRate != _cachedSampleRate || _biquadCoefficients.count != bands.count
		_cachedSampleRate = sampleRate
		if needsRebuild {
			_biquadDelaysL = bands.map { _ in [Double](repeating: 0, count: 4) }
			_biquadDelaysR = bands.map { _ in [Double](repeating: 0, count: 4) }
		}
		_biquadCoefficients = bands.map { Self.peakingEQCoefficients(frequency: $0.frequency, gainDb: $0.gain, q: 1.414, sampleRate: sampleRate) }
		os_unfair_lock_unlock(lock)
	}

	func resetFilterState() {
		os_unfair_lock_lock(lock)
		for i in 0..<_biquadDelaysL.count {
			_biquadDelaysL[i] = [Double](repeating: 0, count: 4)
			_biquadDelaysR[i] = [Double](repeating: 0, count: 4)
		}
		os_unfair_lock_unlock(lock)
	}

	/// Apply all DSP effects to the audio buffer in-place.
	func processAudio(_ bufferList: UnsafeMutablePointer<AudioBufferList>, frameCount: UInt32) {
		let list = UnsafeMutableAudioBufferListPointer(bufferList)
		let bufferCount = list.count
		guard bufferCount > 0, frameCount > 0 else { return }

		os_unfair_lock_lock(lock)
		let eqOn = _eqEnabled
		let coeffs = _biquadCoefficients
		let gainLinear = _outputGainLinear
		let normalize = _normalizationEnabled
		let mono = _monoEnabled
		os_unfair_lock_unlock(lock)

		let fc = Int(frameCount)
		let isNonInterleaved = bufferCount > 1

		if isNonInterleaved {
			processNonInterleaved(list: list, bufferCount: bufferCount, frameCount: fc,
				eqOn: eqOn, coeffs: coeffs, gainLinear: gainLinear, normalize: normalize, mono: mono)
		} else {
			processInterleaved(list: list, frameCount: fc,
				eqOn: eqOn, coeffs: coeffs, gainLinear: gainLinear, normalize: normalize, mono: mono)
		}
	}

	private func processNonInterleaved(list: UnsafeMutableAudioBufferListPointer, bufferCount: Int, frameCount: Int,
		eqOn: Bool, coeffs: [[Double]], gainLinear: Float, normalize: Bool, mono: Bool) {

		if eqOn && !coeffs.isEmpty {
			for ch in 0..<bufferCount {
				guard let mData = list[ch].mData else { continue }
				let samples = mData.assumingMemoryBound(to: Float.self)
				applyEQSingleChannel(samples: samples, frameCount: frameCount, channelIndex: ch, coefficients: coeffs)
			}
		}

		if gainLinear != 1.0 {
			var g = gainLinear
			for ch in 0..<bufferCount {
				guard let mData = list[ch].mData else { continue }
				let samples = mData.assumingMemoryBound(to: Float.self)
				vDSP_vsmul(samples, 1, &g, samples, 1, vDSP_Length(frameCount))
			}
		}

		if normalize {
			var globalPeak: Float = 0
			for ch in 0..<bufferCount {
				guard let mData = list[ch].mData else { continue }
				let samples = mData.assumingMemoryBound(to: Float.self)
				var peak: Float = 0
				vDSP_maxmgv(samples, 1, &peak, vDSP_Length(frameCount))
				if peak > globalPeak { globalPeak = peak }
			}
			if globalPeak > 1.0 {
				var scale = 1.0 / globalPeak
				for ch in 0..<bufferCount {
					guard let mData = list[ch].mData else { continue }
					let samples = mData.assumingMemoryBound(to: Float.self)
					vDSP_vsmul(samples, 1, &scale, samples, 1, vDSP_Length(frameCount))
				}
			}
		}

		if mono && bufferCount >= 2 {
			var avg = [Float](repeating: 0, count: frameCount)
			for ch in 0..<bufferCount {
				guard let mData = list[ch].mData else { continue }
				let samples = mData.assumingMemoryBound(to: Float.self)
				vDSP_vadd(avg, 1, samples, 1, &avg, 1, vDSP_Length(frameCount))
			}
			var divisor = Float(bufferCount)
			vDSP_vsdiv(avg, 1, &divisor, &avg, 1, vDSP_Length(frameCount))
			for ch in 0..<bufferCount {
				guard let mData = list[ch].mData else { continue }
				let samples = mData.assumingMemoryBound(to: Float.self)
				avg.withUnsafeBufferPointer { src in
					samples.update(from: src.baseAddress!, count: frameCount)
				}
			}
		}
	}

	private func processInterleaved(list: UnsafeMutableAudioBufferListPointer, frameCount: Int,
		eqOn: Bool, coeffs: [[Double]], gainLinear: Float, normalize: Bool, mono: Bool) {
		guard let mData = list[0].mData else { return }
		let channelCount = Int(list[0].mNumberChannels)
		let totalSamples = frameCount * channelCount
		guard totalSamples > 0 else { return }
		let samples = mData.assumingMemoryBound(to: Float.self)

		if eqOn && !coeffs.isEmpty {
			applyEQInterleaved(samples: samples, frameCount: frameCount, channelCount: channelCount, coefficients: coeffs)
		}

		if gainLinear != 1.0 {
			var g = gainLinear
			vDSP_vsmul(samples, 1, &g, samples, 1, vDSP_Length(totalSamples))
		}

		if normalize {
			var peak: Float = 0
			vDSP_maxmgv(samples, 1, &peak, vDSP_Length(totalSamples))
			if peak > 1.0 {
				var scale = 1.0 / peak
				vDSP_vsmul(samples, 1, &scale, samples, 1, vDSP_Length(totalSamples))
			}
		}

		if mono && channelCount >= 2 {
			for f in 0..<frameCount {
				let idx = f * channelCount
				var sum: Float = 0
				for ch in 0..<channelCount { sum += samples[idx + ch] }
				let avg = sum / Float(channelCount)
				for ch in 0..<channelCount { samples[idx + ch] = avg }
			}
		}
	}

	private func applyEQSingleChannel(samples: UnsafeMutablePointer<Float>, frameCount: Int, channelIndex: Int, coefficients: [[Double]]) {
		os_unfair_lock_lock(lock)
		let useRight = channelIndex > 0
		let delays = useRight ? _biquadDelaysR : _biquadDelaysL
		guard delays.count == coefficients.count else {
			os_unfair_lock_unlock(lock)
			return
		}

		var channel = [Double](repeating: 0, count: frameCount)
		for i in 0..<frameCount { channel[i] = Double(samples[i]) }

		for b in 0..<coefficients.count {
			let c = coefficients[b]
			guard c.count == 5 else { continue }
			if useRight {
				_biquadDelaysR[b].withUnsafeMutableBufferPointer { delayBuf in
					Self.applyBiquad(c, delay: delayBuf.baseAddress!, data: &channel, count: frameCount)
				}
			} else {
				_biquadDelaysL[b].withUnsafeMutableBufferPointer { delayBuf in
					Self.applyBiquad(c, delay: delayBuf.baseAddress!, data: &channel, count: frameCount)
				}
			}
		}

		for i in 0..<frameCount { samples[i] = Float(channel[i]) }
		os_unfair_lock_unlock(lock)
	}

	private func applyEQInterleaved(samples: UnsafeMutablePointer<Float>, frameCount: Int, channelCount: Int, coefficients: [[Double]]) {
		os_unfair_lock_lock(lock)
		guard _biquadDelaysL.count == coefficients.count else {
			os_unfair_lock_unlock(lock)
			return
		}

		if channelCount == 1 {
			var channel = [Double](repeating: 0, count: frameCount)
			for i in 0..<frameCount { channel[i] = Double(samples[i]) }
			for b in 0..<coefficients.count {
				let c = coefficients[b]
				guard c.count == 5 else { continue }
				_biquadDelaysL[b].withUnsafeMutableBufferPointer { delayBuf in
					Self.applyBiquad(c, delay: delayBuf.baseAddress!, data: &channel, count: frameCount)
				}
			}
			for i in 0..<frameCount { samples[i] = Float(channel[i]) }
		} else {
			var left = [Double](repeating: 0, count: frameCount)
			var right = [Double](repeating: 0, count: frameCount)
			for i in 0..<frameCount {
				left[i] = Double(samples[i * channelCount])
				right[i] = Double(samples[i * channelCount + 1])
			}
			for b in 0..<coefficients.count {
				let c = coefficients[b]
				guard c.count == 5 else { continue }
				_biquadDelaysL[b].withUnsafeMutableBufferPointer { delayBuf in
					Self.applyBiquad(c, delay: delayBuf.baseAddress!, data: &left, count: frameCount)
				}
				_biquadDelaysR[b].withUnsafeMutableBufferPointer { delayBuf in
					Self.applyBiquad(c, delay: delayBuf.baseAddress!, data: &right, count: frameCount)
				}
			}
			for i in 0..<frameCount {
				samples[i * channelCount] = Float(left[i])
				samples[i * channelCount + 1] = Float(right[i])
			}
		}
		os_unfair_lock_unlock(lock)
	}

	private static func applyBiquad(_ c: [Double], delay: UnsafeMutablePointer<Double>, data: inout [Double], count: Int) {
		let b0 = c[0], b1 = c[1], b2 = c[2], a1 = c[3], a2 = c[4]
		var z1 = delay[0], z2 = delay[1]

		for i in 0..<count {
			let x = data[i]
			let y = b0 * x + z1
			z1 = b1 * x - a1 * y + z2
			z2 = b2 * x - a2 * y
			data[i] = y
		}

		delay[0] = z1
		delay[1] = z2
	}

	private static func peakingEQCoefficients(frequency: Float, gainDb: Float, q: Float, sampleRate: Float) -> [Double] {
		let A = Double(powf(10.0, gainDb / 40.0))
		let w0 = 2.0 * Double.pi * Double(frequency) / Double(sampleRate)
		let sinW0 = sin(w0)
		let cosW0 = cos(w0)
		let alpha = sinW0 / (2.0 * Double(q))

		let b0 = 1.0 + alpha * A
		let b1 = -2.0 * cosW0
		let b2 = 1.0 - alpha * A
		let a0 = 1.0 + alpha / A
		let a1 = -2.0 * cosW0
		let a2 = 1.0 - alpha / A

		return [b0/a0, b1/a0, b2/a0, a1/a0, a2/a0]
	}
}

// MARK: - Module

public final class YhwavAudioModule: Module {
	fileprivate var enginePlayer: AudioEnginePlayer?
	fileprivate var podcastPlayer: PodcastPlayer?
	/// When true, playback control routes to `podcastPlayer` (AVPlayer) instead of `enginePlayer`.
	private var usingPodcastBackend = false
	private var fileCache: AudioFileCache?
	private var trackMetadata: [String: TrackRecord] = [:]
	private var trackOrder: [String] = []
	private var progressTimer: Timer?
	private var progressUpdateInterval: TimeInterval = 0.5
	private var repeatMode: Int = 2 // 0=Off, 1=Track, 2=Queue
	private var isInitialized = false
	private var lastTrackEndTimestamp: Double = 0
	private var lastPlaybackErrorEmitTime: Double = 0
	private var lastEmittedTrackIndex: Int = -1
	private var lastEmittedTrackTime: Double = 0
	private var lastEmittedState: String = "stopped"
	private var suppressTrackChangeEvents = false
	private var crossfadeUserEnabled = false

	private lazy var nowPlayingManager = NowPlayingManager(module: self)

	// MARK: - Search index
	private struct SearchEntry {
		let id: String
		let titleLower: String
		let artistLower: String
		let albumLower: String
	}
	private var searchIndex: [SearchEntry] = []
	private let searchQueue = DispatchQueue(label: "com.yhwav.search", qos: .userInitiated)

	public func definition() -> ModuleDefinition {
		Name("YhwavAudio")

		Events(
			"PlaybackProgressUpdated",
			"PlaybackQueueEnded",
			"PlaybackActiveTrackChanged",
			"PlaybackError",
			"RemotePlay",
			"RemotePause",
			"RemoteNext",
			"RemotePrevious",
			"RemoteSeek",
			"AudioLevelsUpdated"
		)

		OnCreate {
			// Will be set up in setupPlayer
		}

		AsyncFunction("setupPlayer") { (options: SetupOptions?) in
			guard !self.isInitialized else { return }
			self.configureAudioSession()
			let cache = AudioFileCache()
			self.fileCache = cache
			let player = AudioEnginePlayer(fileCache: cache)
			player.delegate = self
			player.setup()
			player.crossfadeEnabled = self.crossfadeUserEnabled
			self.enginePlayer = player
			let podcast = PodcastPlayer()
			podcast.delegate = self
			self.podcastPlayer = podcast
			self.nowPlayingManager.setupRemoteCommands()
			self.isInitialized = true
		}

		AsyncFunction("updateOptions") { (options: [String: Any]?) in
			if let interval = options?["progressUpdateEventInterval"] as? Double, interval > 0 {
				self.progressUpdateInterval = interval
			}
			if let caps = options?["capabilities"] as? [String] {
				self.nowPlayingManager.setCapabilities(caps)
			}
		}

		AsyncFunction("add") { (tracks: [TrackRecord], insertAfterIndex: Int?) in
			guard self.enginePlayer != nil else { return }
			DispatchQueue.main.sync {
				let afterIdx = insertAfterIndex ?? (self.trackOrder.isEmpty ? -1 : self.trackOrder.count - 1)
				let wasEmpty = self.trackOrder.isEmpty
				print("YhwavAudio: add \(tracks.count) tracks (wasEmpty=\(wasEmpty), afterIdx=\(afterIdx))")

				for track in tracks {
					self.trackMetadata[track.id] = track
				}
				if self.trackOrder.isEmpty {
					self.trackOrder = tracks.map(\.id)
				} else if afterIdx < 0 {
					self.trackOrder.append(contentsOf: tracks.map(\.id))
				} else {
					let head = Array(self.trackOrder.prefix(afterIdx + 1))
					let tail = Array(self.trackOrder.dropFirst(afterIdx + 1))
					self.trackOrder = head + tracks.map(\.id) + tail
				}

				self.predownloadNext()
			}
		}

		AsyncFunction("reset") {
			DispatchQueue.main.sync {
				print("YhwavAudio: reset (had \(self.trackOrder.count) tracks)")
				self.stopProgressTimer()
				self.enginePlayer?.clearScheduled()
				self.podcastPlayer?.stop()
				self.usingPodcastBackend = false
				self.trackMetadata.removeAll()
				self.trackOrder.removeAll()
				self.lastTrackEndTimestamp = 0
				self.lastPlaybackErrorEmitTime = 0
				self.lastEmittedTrackIndex = -1
				self.lastEmittedTrackTime = 0
				self.lastEmittedState = "stopped"
				self.fileCache?.clearAll()
				AudioDSPState.shared.resetFilterState()
			}
		}

		AsyncFunction("remove") { (indices: [Int]) in
			guard self.enginePlayer != nil else { return }
			DispatchQueue.main.sync {
				for idx in indices.sorted(by: >) where idx >= 0 && idx < self.trackOrder.count {
					let id = self.trackOrder[idx]
					self.trackOrder.remove(at: idx)
					self.trackMetadata.removeValue(forKey: id)
				}
				self.rescheduleNextIfNeeded()
			}
		}

		AsyncFunction("removeUpcomingTracks") {
			guard self.enginePlayer != nil else { return }
			DispatchQueue.main.sync {
				let currentIdx = self.currentActiveTrackIndex()
				guard currentIdx >= 0 else { return }

				let idsToRemove = Array(self.trackOrder.dropFirst(currentIdx + 1))
				for id in idsToRemove {
					self.trackMetadata.removeValue(forKey: id)
				}
				self.trackOrder = Array(self.trackOrder.prefix(currentIdx + 1))
				self.enginePlayer?.clearCrossfadeIdle()
			}
		}

		AsyncFunction("move") { (fromIndex: Int, toIndex: Int) in
			guard fromIndex != toIndex,
			      fromIndex >= 0, toIndex >= 0,
			      fromIndex < self.trackOrder.count, toIndex < self.trackOrder.count
			else { return }
			DispatchQueue.main.sync {
				let id = self.trackOrder.remove(at: fromIndex)
				self.trackOrder.insert(id, at: toIndex)
				self.rescheduleNextIfNeeded()
			}
		}

		AsyncFunction("skip") { (index: Int, startPaused: Bool?, startAtSeconds: Double?) in
			guard self.enginePlayer != nil, index >= 0, index < self.trackOrder.count else { return }
			let currentIdx = self.currentActiveTrackIndex()
			let targetId = self.trackOrder[index]
			let paused = startPaused ?? false
			let startAt = (startAtSeconds ?? 0) > 0 ? startAtSeconds : nil
			print("YhwavAudio: skip idx=\(currentIdx)→\(index) (trackId=\(targetId)), queueSize=\(self.trackOrder.count) paused=\(paused)")

			guard let track = self.trackMetadata[targetId],
				  let url = URL(string: track.url) else { return }

			// Podcasts stream through the lightweight AVPlayer backend (instant seek, no full download).
			// Set the routing flag synchronously so a `seekTo` issued right after `skip` (podcast resume)
			// routes to the podcast backend before the async work below runs.
			if track.crossfadeDisabled == true {
				self.usingPodcastBackend = true
				DispatchQueue.main.async {
					self.enginePlayer?.clearScheduled()
					self.podcastPlayer?.play(url: url, trackId: targetId, startAt: startAt, startPaused: paused)
					self.emitActiveTrackChanged(index: index)
					self.startProgressTimerIfNeeded()
				}
				return
			}

			// Music: engine backend. Leave the podcast backend if we were on it.
			guard let engine = self.enginePlayer else { return }
			if self.usingPodcastBackend {
				DispatchQueue.main.async { self.podcastPlayer?.stop() }
				self.usingPodcastBackend = false
			}

			var keepPrefetch: Set<String> = [targetId]
			if index + 1 < self.trackOrder.count {
				keepPrefetch.insert(self.trackOrder[index + 1])
			}
			self.fileCache?.cancelDownloads(exceptTrackIds: keepPrefetch)

			Task {
				do {
					try await engine.play(
						url: url,
						trackId: targetId,
						expectedDurationSeconds: self.expectedDurationSeconds(for: track),
						fallbackURL: self.fallbackDirectURL(for: track),
						startPaused: paused,
						startAtSeconds: startAt
					)
					await MainActor.run {
						self.emitActiveTrackChanged(index: index)
						if paused {
							// Loaded but not playing (restore): don't run the progress timer.
							self.syncNowPlaying()
						} else {
							self.startProgressTimerIfNeeded()
						}
						self.scheduleNextTrack(afterIndex: index)
					}
				} catch {
					print("YhwavAudio: skip failed: \(error.localizedDescription)")
					await MainActor.run {
						self.sendEvent("PlaybackError", ["error": error.localizedDescription, "trackId": targetId])
					}
				}
			}
		}

		AsyncFunction("play") {
			self.performPlayAndSync()
		}

		AsyncFunction("pause") {
			self.performPauseAndSync()
		}

		AsyncFunction("seekTo") { (position: Double) in
			self.performSeekAndSync(position)
		}

		AsyncFunction("setVolume") { (value: Float) in
			let v = max(0, min(1, value))
			self.enginePlayer?.volume = v
			self.podcastPlayer?.setVolume(v)
		}

		AsyncFunction("setRate") { (value: Float) in
			let v = max(0.5, min(2.0, value))
			if self.usingPodcastBackend {
				self.podcastPlayer?.setRate(v)
			} else {
				self.enginePlayer?.rate = v
			}
			DispatchQueue.main.async { self.syncNowPlaying() }
		}

		AsyncFunction("setRepeatMode") { (mode: Int) in
			self.repeatMode = mode
		}

		// MARK: - DSP control APIs

		AsyncFunction("setEqualizerBands") { (_ bands: [[String: Any]]) in
			let parsed: [(frequency: Float, gain: Float)] = bands.compactMap { dict in
				guard let freq = (dict["frequency"] as? NSNumber)?.floatValue,
				      let gain = (dict["gain"] as? NSNumber)?.floatValue else { return nil }
				return (frequency: freq, gain: max(-12, min(12, gain)))
			}
			let sr = Float(AVAudioSession.sharedInstance().sampleRate)
			AudioDSPState.shared.setEqualizerBands(parsed, sampleRate: sr > 0 ? sr : 44100)
		}

		AsyncFunction("setEqualizerEnabled") { (enabled: Bool) in
			AudioDSPState.shared.setEqEnabled(enabled)
		}

		AsyncFunction("setOutputGain") { (gainDb: Float) in
			AudioDSPState.shared.setOutputGainDb(max(-10, min(10, gainDb)))
		}

		AsyncFunction("setNormalizationEnabled") { (enabled: Bool) in
			AudioDSPState.shared.setNormalizationEnabled(enabled)
		}

		AsyncFunction("setMonoAudioEnabled") { (enabled: Bool) in
			AudioDSPState.shared.setMonoEnabled(enabled)
		}

		AsyncFunction("setCrossfadeConfig") { (config: CrossfadeConfigRecord) in
			self.crossfadeUserEnabled = config.enabled
			self.enginePlayer?.crossfadeEnabled = config.enabled
			if config.defaultDuration > 0 {
				self.enginePlayer?.nextCrossfadeDuration = config.defaultDuration
			}
		}

		AsyncFunction("setNextCrossfadeDuration") { (seconds: Double) in
			let clamped = max(0.1, min(30.0, seconds))
			self.enginePlayer?.nextCrossfadeDuration = clamped
		}

		Function("getPlaybackState") { () -> PlaybackStateRecord in
			var record = PlaybackStateRecord()
			DispatchQueue.main.sync {
				let (state, position, duration) = self.currentPlaybackState()
				record.state = state
				record.position = position
				record.duration = duration
				record.buffered = nil
			}
			return record
		}

		Function("getActiveTrackIndex") { () -> Int in
			var idx = -1
			DispatchQueue.main.sync {
				idx = self.currentActiveTrackIndex()
			}
			return idx
		}

		Function("getQueue") { () -> [TrackRecord] in
			var result: [TrackRecord] = []
			DispatchQueue.main.sync {
				result = self.trackOrder.compactMap { id in self.trackMetadata[id] }
			}
			return result
		}

		// MARK: - Search

		AsyncFunction("prewarmURL") { (urlString: String, trackId: String) in
			guard let url = URL(string: urlString) else { return }
			self.fileCache?.predownload(url: url, trackId: trackId)
		}

		// MARK: - Search

		AsyncFunction("buildSearchIndex") { (tracks: [[String: Any]]) in
			let entries: [SearchEntry] = tracks.compactMap { dict in
				guard let id = dict["id"] as? String else { return nil }
				let title = (dict["title"] as? String ?? "").lowercased()
				let artist = (dict["artist"] as? String ?? "").lowercased()
				let album = (dict["album"] as? String ?? "").lowercased()
				return SearchEntry(id: id, titleLower: title, artistLower: artist, albumLower: album)
			}
			self.searchQueue.sync {
				self.searchIndex = entries
			}
		}

		AsyncFunction("searchTracks") { (query: String, limit: Int) -> [[String: Any]] in
			let q = query.lowercased().trimmingCharacters(in: .whitespaces)
			guard !q.isEmpty else { return [] }

			var hits: [(id: String, score: Int)] = []

			self.searchQueue.sync {
				for entry in self.searchIndex {
					let titleHit = entry.titleLower.contains(q)
					let artistHit = entry.artistLower.contains(q)
					let albumHit = entry.albumLower.contains(q)
					guard titleHit || artistHit || albumHit else { continue }

					var score = 0
					if entry.titleLower.hasPrefix(q) { score += 100 }
					else if titleHit { score += 50 }
					if entry.artistLower.hasPrefix(q) { score += 80 }
					else if artistHit { score += 40 }
					if entry.albumLower.hasPrefix(q) { score += 60 }
					else if albumHit { score += 30 }

					hits.append((id: entry.id, score: score))
					if hits.count >= limit * 2 { break }
				}
			}

			hits.sort { $0.score > $1.score }
			return Array(hits.prefix(limit)).map { ["id": $0.id, "score": $0.score] }
		}
	}

	// MARK: - Track playback helpers

	/// JS sends Plex `duration` in milliseconds.
	private func expectedDurationSeconds(for track: TrackRecord) -> Double? {
		guard let d = track.duration, d > 0 else { return nil }
		return d / 1000.0
	}

	private func fallbackDirectURL(for track: TrackRecord) -> URL? {
		guard let s = track.directUrl, !s.isEmpty, s != track.url, let u = URL(string: s) else { return nil }
		return u
	}

	// MARK: - Audio session

	private func configureAudioSession() {
		do {
			try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
			try AVAudioSession.sharedInstance().setActive(true)
		} catch {
			print("YhwavAudio: Failed to set audio session: \(error)")
		}
	}

	// MARK: - Scheduling helpers

	private func scheduleNextTrack(afterIndex idx: Int) {
		guard !usingPodcastBackend else { return }
		guard let engine = enginePlayer else { return }
		let nextIdx = idx + 1
		guard nextIdx < trackOrder.count else { return }
		let nextId = trackOrder[nextIdx]
		guard let track = trackMetadata[nextId],
			  let url = URL(string: track.url) else { return }

		// While the current track is being streamed, the active deck is busy with streamed buffers, so we
		// can't preload the next track onto a deck (that's the crossfade/gapless file path). Instead we
		// prefetch upcoming tracks into the cache so they play via the fast file path once current — and
		// once a streamed track hands off to a cached one, gapless/crossfade resume normally.
		if engine.isCurrentStreaming {
			predownloadAhead(fromIndex: nextIdx)
			return
		}

		let forceGapless = track.crossfadeDisabled == true

		Task {
			do {
				try await engine.scheduleNext(
					url: url,
					trackId: nextId,
					expectedDurationSeconds: self.expectedDurationSeconds(for: track),
					fallbackURL: self.fallbackDirectURL(for: track),
					forceGapless: forceGapless
				)
			} catch {
				print("YhwavAudio: failed to schedule next: \(error)")
			}
		}

		predownloadAhead(fromIndex: nextIdx + 1)
	}

	private func predownloadNext() {
		guard !usingPodcastBackend else { return }
		guard let engine = enginePlayer, engine.currentTrackId != nil else { return }
		let currentIdx = currentActiveTrackIndex()
		guard currentIdx >= 0 else { return }
		let nextIdx = currentIdx + 1
		guard nextIdx < trackOrder.count else { return }
		let nextId = trackOrder[nextIdx]
		guard let track = trackMetadata[nextId],
			  let url = URL(string: track.url) else { return }
		fileCache?.predownload(url: url, trackId: nextId)
	}

	private func predownloadAhead(fromIndex startIdx: Int, count: Int = 2) {
		for i in 0..<count {
			let idx = startIdx + i
			guard idx < trackOrder.count else { return }
			let id = trackOrder[idx]
			guard let track = trackMetadata[id],
				  let url = URL(string: track.url) else { continue }
			fileCache?.predownload(url: url, trackId: id)
		}
	}

	private func rescheduleNextIfNeeded() {
		let currentIdx = currentActiveTrackIndex()
		guard currentIdx >= 0 else { return }
		scheduleNextTrack(afterIndex: currentIdx)
	}

	// MARK: - Track index

	/// Track id from whichever backend (engine or podcast) is currently active.
	private var activeCurrentTrackId: String? {
		usingPodcastBackend ? podcastPlayer?.currentTrackId : enginePlayer?.currentTrackId
	}

	/// Play/position/duration from whichever backend is currently active.
	private func activePlaybackTiming() -> (isPlaying: Bool, position: Double, duration: Double, hasTrack: Bool) {
		if usingPodcastBackend {
			guard let pod = podcastPlayer, pod.currentTrackId != nil else { return (false, 0, 0, false) }
			return (pod.isPlaying, pod.currentPosition, pod.currentDuration, true)
		}
		guard let engine = enginePlayer, engine.currentTrackId != nil else { return (false, 0, 0, false) }
		return (engine.isPlaying, engine.currentPosition, engine.currentDuration, true)
	}

	/// Playback rate of the active backend (for Now Playing).
	fileprivate func currentPlaybackRate() -> Double {
		usingPodcastBackend ? Double(podcastPlayer?.rate ?? 1.0) : Double(enginePlayer?.rate ?? 1.0)
	}

	fileprivate func currentActiveTrackIndex() -> Int {
		guard let trackId = activeCurrentTrackId,
			  let idx = trackOrder.firstIndex(of: trackId) else { return -1 }
		return idx
	}

	// MARK: - Track change events

	private func emitActiveTrackChanged(index: Int) {
		let now = Date().timeIntervalSince1970 * 1000
		if index == lastEmittedTrackIndex && (now - lastEmittedTrackTime) < 300 {
			return
		}
		lastEmittedTrackIndex = index
		lastEmittedTrackTime = now

		let trackId = (index >= 0 && index < trackOrder.count) ? trackOrder[index] : "?"
		print("YhwavAudio: emitActiveTrackChanged idx=\(index) trackId=\(trackId)")
		var payload: [String: Any] = ["index": index]
		if lastTrackEndTimestamp > 0 {
			payload["previousTrackEndedAt"] = lastTrackEndTimestamp
		}
		sendEvent("PlaybackActiveTrackChanged", payload)
		syncNowPlaying()
	}

	// MARK: - Progress timer

	private func startProgressTimerIfNeeded() {
		guard progressTimer == nil else { return }
		guard Thread.isMainThread else {
			DispatchQueue.main.async { self.startProgressTimerIfNeeded() }
			return
		}
		progressTimer = Timer(timeInterval: progressUpdateInterval, repeats: true) { [weak self] _ in
			self?.emitProgressUpdate()
		}
		RunLoop.main.add(progressTimer!, forMode: .common)
	}

	private func stopProgressTimer() {
		progressTimer?.invalidate()
		progressTimer = nil
	}

	private func emitProgressUpdate() {
		if !usingPodcastBackend {
			self.enginePlayer?.tickCrossfadeIfNeeded()
		}
		let (state, position, duration) = currentPlaybackState()
		if state != lastEmittedState {
			lastEmittedState = state
		}
		let idx = currentActiveTrackIndex()
		sendEvent("PlaybackProgressUpdated", [
			"position": position,
			"duration": duration,
			"track": idx,
			"index": idx
		])
	}

	private func syncNowPlaying() {
		let (state, position, duration) = currentPlaybackState()
		let idx = currentActiveTrackIndex()
		let trackId = idx >= 0 && idx < trackOrder.count ? trackOrder[idx] : nil
		let track = trackId.flatMap { trackMetadata[$0] }
		nowPlayingManager.updateNowPlaying(track: track, position: position, duration: duration, isPlaying: state == "playing")
	}

	// MARK: - State

	private func currentPlaybackState() -> (state: String, position: Double, duration: Double) {
		let timing = activePlaybackTiming()
		guard timing.hasTrack else {
			return ("stopped", 0, 0)
		}
		let pos = timing.position
		var dur = timing.duration
		if !dur.isFinite || dur <= 0 {
			let idx = currentActiveTrackIndex()
			if idx >= 0, idx < trackOrder.count,
			   let meta = trackMetadata[trackOrder[idx]], let md = meta.duration, md > 0 {
				dur = md
			}
		}
		let validPos = pos.isFinite && pos >= 0 ? pos : 0
		let validDur = dur.isFinite && dur >= 0 ? dur : 0

		return (timing.isPlaying ? "playing" : "paused", validPos, validDur)
	}

	// MARK: - Play / pause / seek (bridge + remote control)

	/// Same behavior as the JS `play` bridge: resume the active backend, run progress timer + Now Playing on the main thread.
	fileprivate func performPlayAndSync() {
		if usingPodcastBackend {
			DispatchQueue.main.async { self.podcastPlayer?.resume() }
		} else {
			enginePlayer?.resume()
		}
		DispatchQueue.main.async {
			self.startProgressTimerIfNeeded()
			self.emitProgressUpdate()
			self.syncNowPlaying()
		}
	}

	/// Same behavior as the JS `pause` bridge: stop audio immediately, then timer + Now Playing on main.
	fileprivate func performPauseAndSync() {
		if usingPodcastBackend {
			DispatchQueue.main.async { self.podcastPlayer?.pause() }
		} else {
			enginePlayer?.pause()
		}
		DispatchQueue.main.async {
			self.stopProgressTimer()
			self.emitProgressUpdate()
			self.syncNowPlaying()
		}
	}

	fileprivate func performSeekAndSync(_ position: Double) {
		if usingPodcastBackend {
			DispatchQueue.main.async { self.podcastPlayer?.seek(to: position) }
		} else {
			enginePlayer?.seek(to: position)
		}
		DispatchQueue.main.async {
			self.emitProgressUpdate()
			self.syncNowPlaying()
		}
	}

	deinit {
		stopProgressTimer()
		enginePlayer?.teardown()
		podcastPlayer?.stop()
	}
}

// MARK: - PodcastPlayerDelegate

extension YhwavAudioModule: PodcastPlayerDelegate {
	func podcastPlayer(_ player: PodcastPlayer, didFinishTrack trackId: String) {
		lastTrackEndTimestamp = Date().timeIntervalSince1970 * 1000

		guard let finishedIdx = trackOrder.firstIndex(of: trackId) else {
			stopProgressTimer()
			sendEvent("PlaybackQueueEnded", [:])
			return
		}

		// Explicit single-track repeat: replay the same episode from the start.
		if repeatMode == 1 {
			print("YhwavAudio: podcast didFinish \(trackId) → repeat track")
			guard let track = trackMetadata[trackId], let url = URL(string: track.url) else { return }
			player.play(url: url, trackId: trackId, startAt: 0)
			emitActiveTrackChanged(index: finishedIdx)
			return
		}

		// Podcast queues are single-episode; a following track is uncommon. Either way, ending the
		// episode surfaces as queue-ended so JS marks progress complete and scrobbles.
		print("YhwavAudio: podcast didFinish \(trackId) → queue ended")
		stopProgressTimer()
		sendEvent("PlaybackQueueEnded", [:])
	}

	func podcastPlayer(_ player: PodcastPlayer, didEncounterError error: String, trackId: String) {
		let now = Date().timeIntervalSince1970 * 1000
		guard now - lastPlaybackErrorEmitTime > 500 else { return }
		lastPlaybackErrorEmitTime = now
		print("YhwavAudio: podcast didEncounterError trackId=\(trackId): \(error)")
		sendEvent("PlaybackError", ["error": error, "trackId": trackId])
	}
}

// MARK: - AudioEnginePlayerDelegate

extension YhwavAudioModule: AudioEnginePlayerDelegate {
	func enginePlayer(_ player: AudioEnginePlayer, didFinishTrack trackId: String) {
		lastTrackEndTimestamp = Date().timeIntervalSince1970 * 1000

		guard let finishedIdx = trackOrder.firstIndex(of: trackId) else { return }

		if repeatMode == 1 {
			print("YhwavAudio: didFinishTrack \(trackId) → repeat track")
			guard let track = trackMetadata[trackId],
				  let url = URL(string: track.url) else { return }
			Task {
				do {
					try await player.play(
						url: url,
						trackId: trackId,
						expectedDurationSeconds: self.expectedDurationSeconds(for: track),
						fallbackURL: self.fallbackDirectURL(for: track)
					)
					await MainActor.run {
						self.emitActiveTrackChanged(index: finishedIdx)
						self.scheduleNextTrack(afterIndex: finishedIdx)
					}
				} catch {
					print("YhwavAudio: repeat track failed: \(error.localizedDescription)")
					await MainActor.run {
						self.sendEvent("PlaybackError", ["error": error.localizedDescription, "trackId": trackId])
					}
				}
			}
			return
		}

		let nextIdx = finishedIdx + 1
		if nextIdx < trackOrder.count {
			let nextId = trackOrder[nextIdx]
			print("YhwavAudio: didFinishTrack \(trackId) → advancing to idx=\(nextIdx) trackId=\(nextId)")

			if player.currentTrackId == nextId {
				emitActiveTrackChanged(index: nextIdx)
				scheduleNextTrack(afterIndex: nextIdx)
			} else {
				advanceToTrack(at: nextIdx, player: player)
			}
		} else if repeatMode == 2 && !trackOrder.isEmpty {
			print("YhwavAudio: didFinishTrack \(trackId) → repeat queue from idx=0")
			advanceToTrack(at: 0, player: player)
		} else {
			print("YhwavAudio: didFinishTrack \(trackId) → queue ended")
			stopProgressTimer()
			sendEvent("PlaybackQueueEnded", [:])
		}
	}

	/// Try to play the track at `startIdx`; on failure, walk forward trying subsequent tracks.
	private func advanceToTrack(at startIdx: Int, player: AudioEnginePlayer, attempt: Int = 0) {
		let maxSkips = min(3, trackOrder.count)
		let idx = startIdx + attempt
		guard idx < trackOrder.count, attempt < maxSkips else {
			print("YhwavAudio: all advancement attempts failed")
			sendEvent("PlaybackError", ["error": "Failed to load tracks", "trackId": trackOrder[startIdx]])
			return
		}

		let targetId = trackOrder[idx]
		guard let track = trackMetadata[targetId],
			  let url = URL(string: track.url) else {
			advanceToTrack(at: startIdx, player: player, attempt: attempt + 1)
			return
		}

		Task {
			do {
				try await player.play(
					url: url,
					trackId: targetId,
					expectedDurationSeconds: self.expectedDurationSeconds(for: track),
					fallbackURL: self.fallbackDirectURL(for: track)
				)
				await MainActor.run {
					self.emitActiveTrackChanged(index: idx)
					self.scheduleNextTrack(afterIndex: idx)
				}
			} catch {
				print("YhwavAudio: advance to idx=\(idx) trackId=\(targetId) failed: \(error.localizedDescription)")
				await MainActor.run {
					self.advanceToTrack(at: startIdx, player: player, attempt: attempt + 1)
				}
			}
		}
	}

	func enginePlayer(_ player: AudioEnginePlayer, didEncounterError error: String, trackId: String) {
		let now = Date().timeIntervalSince1970 * 1000
		guard now - lastPlaybackErrorEmitTime > 500 else { return }
		lastPlaybackErrorEmitTime = now
		print("YhwavAudio: didEncounterError trackId=\(trackId): \(error)")
		sendEvent("PlaybackError", [
			"error": error,
			"trackId": trackId
		])
	}

	func enginePlayer(_ player: AudioEnginePlayer, didUpdateLevels levels: [Float]) {
		sendEvent("AudioLevelsUpdated", ["levels": levels])
	}
}

// MARK: - Now Playing / Lock Screen

private final class NowPlayingManager {
	weak var module: YhwavAudioModule?
	private var capabilities: Set<String> = ["Play", "Pause", "SkipToNext", "SkipToPrevious", "SeekTo"]
	private var cachedArtworkUrl: String?
	private var cachedArtwork: MPMediaItemArtwork?

	init(module: YhwavAudioModule) {
		self.module = module
	}

	func setCapabilities(_ caps: [String]) {
		capabilities = Set(caps)
		applyRemoteCommandEnabledFlags()
	}

	private func applyRemoteCommandEnabledFlags() {
		let center = MPRemoteCommandCenter.shared()
		center.playCommand.isEnabled = capabilities.contains("Play")
		center.pauseCommand.isEnabled = capabilities.contains("Pause")
		center.nextTrackCommand.isEnabled = capabilities.contains("SkipToNext")
		center.previousTrackCommand.isEnabled = capabilities.contains("SkipToPrevious")
		center.changePlaybackPositionCommand.isEnabled = capabilities.contains("SeekTo")
	}

	func setupRemoteCommands() {
		let center = MPRemoteCommandCenter.shared()
		center.playCommand.removeTarget(nil)
		center.pauseCommand.removeTarget(nil)
		center.nextTrackCommand.removeTarget(nil)
		center.previousTrackCommand.removeTarget(nil)
		center.changePlaybackPositionCommand.removeTarget(nil)

		applyRemoteCommandEnabledFlags()

		center.playCommand.addTarget { [weak self] _ in
			guard let mod = self?.module else { return .commandFailed }
			mod.performPlayAndSync()
			mod.sendEvent("RemotePlay", [:])
			return .success
		}
		center.pauseCommand.addTarget { [weak self] _ in
			guard let mod = self?.module else { return .commandFailed }
			mod.performPauseAndSync()
			mod.sendEvent("RemotePause", [:])
			return .success
		}
		center.nextTrackCommand.addTarget { [weak self] _ in
			self?.module?.sendEvent("RemoteNext", [:])
			return .success
		}
		center.previousTrackCommand.addTarget { [weak self] _ in
			self?.module?.sendEvent("RemotePrevious", [:])
			return .success
		}
		center.changePlaybackPositionCommand.addTarget { [weak self] event in
			guard let e = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
			guard let mod = self?.module else { return .commandFailed }
			mod.sendEvent("RemoteSeek", ["position": e.positionTime])
			mod.performSeekAndSync(e.positionTime)
			return .success
		}
	}

	func updateNowPlaying(track: TrackRecord?, position: Double?, duration: Double?, isPlaying: Bool) {
		var info = [String: Any]()
		if let track = track {
			info[MPMediaItemPropertyTitle] = track.title ?? ""
			info[MPMediaItemPropertyArtist] = track.artist ?? ""
			if let album = track.album, !album.isEmpty {
				info[MPMediaItemPropertyAlbumTitle] = album
			}
			if let d = track.duration, d > 0 {
				info[MPMediaItemPropertyPlaybackDuration] = d
			}
			if let urlString = track.artwork, !urlString.isEmpty {
				if urlString != cachedArtworkUrl {
					cachedArtworkUrl = urlString
					cachedArtwork = nil
					if let url = URL(string: urlString) {
						URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
							guard let data = data, let image = UIImage(data: data) else { return }
							let art = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
							DispatchQueue.main.async {
								self?.cachedArtwork = art
								var i = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
								i[MPMediaItemPropertyArtwork] = art
								MPNowPlayingInfoCenter.default().nowPlayingInfo = i
							}
						}.resume()
					}
				} else if let art = cachedArtwork {
					info[MPMediaItemPropertyArtwork] = art
				}
			}
		}
		if let pos = position {
			info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = pos
		}
		if let dur = duration, dur > 0 {
			info[MPMediaItemPropertyPlaybackDuration] = dur
		}
		info[MPNowPlayingInfoPropertyPlaybackRate] = isPlaying ? (module?.currentPlaybackRate() ?? 1.0) : 0.0
		let current = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
		MPNowPlayingInfoCenter.default().nowPlayingInfo = current.merging(info) { _, new in new }
	}
}
