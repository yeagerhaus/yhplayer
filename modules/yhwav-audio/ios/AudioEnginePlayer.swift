import AVFoundation
import Accelerate
import AudioToolbox
import QuartzCore

// MARK: - Delegate

protocol AudioEnginePlayerDelegate: AnyObject {
	func enginePlayer(_ player: AudioEnginePlayer, didFinishTrack trackId: String)
	func enginePlayer(_ player: AudioEnginePlayer, didEncounterError error: String, trackId: String)
	func enginePlayer(_ player: AudioEnginePlayer, didUpdateLevels levels: [Float])
}

// MARK: - YhwavDSPUnit

private let yhwavDSPDesc = AudioComponentDescription(
	componentType: kAudioUnitType_Effect,
	componentSubType: fourCC("yDSP"),
	componentManufacturer: fourCC("yhwv"),
	componentFlags: 0,
	componentFlagsMask: 0
)

private func fourCC(_ str: String) -> FourCharCode {
	var result: FourCharCode = 0
	for char in str.utf8.prefix(4) {
		result = (result << 8) | FourCharCode(char)
	}
	return result
}

private var dspRegistered = false

final class YhwavDSPUnit: AUAudioUnit {
	private var _inputBusArray: AUAudioUnitBusArray!
	private var _outputBusArray: AUAudioUnitBusArray!
	private var inputBus: AUAudioUnitBus!
	private var _maxFrames: AUAudioFrameCount = 4096

	override init(componentDescription: AudioComponentDescription, options: AudioComponentInstantiationOptions = []) throws {
		try super.init(componentDescription: componentDescription, options: [])
		let defaultFormat = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!
		inputBus = try AUAudioUnitBus(format: defaultFormat)
		_inputBusArray = AUAudioUnitBusArray(audioUnit: self, busType: .input, busses: [inputBus])
		_outputBusArray = AUAudioUnitBusArray(audioUnit: self, busType: .output, busses: [try AUAudioUnitBus(format: defaultFormat)])
	}

	override var inputBusses: AUAudioUnitBusArray { _inputBusArray }
	override var outputBusses: AUAudioUnitBusArray { _outputBusArray }
	override var maximumFramesToRender: AUAudioFrameCount {
		get { _maxFrames }
		set { _maxFrames = newValue }
	}

	override var internalRenderBlock: AUInternalRenderBlock {
		return { actionFlags, timestamp, frameCount, outputBusNumber, outputData, renderEvent, pullInputBlock in
			guard let pull = pullInputBlock else { return kAudioUnitErr_NoConnection }
			let status = pull(actionFlags, timestamp, frameCount, 0, outputData)
			guard status == noErr else { return status }
			AudioDSPState.shared.processAudio(outputData, frameCount: frameCount)
			return noErr
		}
	}
}

// MARK: - AudioEnginePlayer

final class AudioEnginePlayer {
	weak var delegate: AudioEnginePlayerDelegate?

	private var engine: AVAudioEngine!
	private var deckA: AVAudioPlayerNode!
	private var deckB: AVAudioPlayerNode!
	private var mixerNode: AVAudioMixerNode!
	private var timePitchNode: AVAudioUnitTimePitch!
	private var dspNode: AVAudioUnit?
	private let fileCache: AudioFileCache

	/// When false, only deck A is used (deck B silent). When true, A/B alternate for crossfades.
	var crossfadeEnabled: Bool = false {
		didSet {
			if !crossfadeEnabled {
				cancelCrossfadeRamp()
				crossfadeInProgress = false
				crossfadeIdleReady = false
				crossfadeIdleFile = nil
				crossfadeIdleTrackId = nil
				idleNode.stop()
				idleNode.volume = 0
				activeNode.volume = _volume
			}
		}
	}

	/// JS-computed overlap length for the upcoming transition.
	var nextCrossfadeDuration: TimeInterval = 4.0

	private(set) var currentTrackId: String?
	private var currentFile: AVAudioFile?
	private var currentFrameOffset: AVAudioFramePosition = 0
	private var playerTimeBaseOffset: AVAudioFramePosition = 0

	private var nextFile: AVAudioFile?
	private var nextTrackId: String?
	private var isNextScheduled = false

	private var activeDeckIsA: Bool = true
	private var crossfadeIdleFile: AVAudioFile?
	private var crossfadeIdleTrackId: String?
	private var crossfadeIdleReady: Bool = false
	private var crossfadeInProgress: Bool = false
	private var crossfadeRampLink: CADisplayLink?
	private var crossfadeRampStartTime: CFTimeInterval = 0
	private var crossfadeRampDurationActive: TimeInterval = 0
	private var crossfadeOutgoingIsA: Bool = true
	private var finishedTrackIdForRamp: String?

	private var _isPlaying = false
	private var _volume: Float = 1.0
	private var _rate: Float = 1.0

	private var playGeneration: UInt64 = 0
	private var trackEndWallTime: Double = 0
	private var cachedPlaybackSeconds: Double = 0

	// MARK: - Streaming (remote, progressive) state
	//
	// When a remote track isn't already cached we stream it: a `StreamingAudioSource` produces LPCM
	// buffers that a background pump schedules onto the active deck, so audio starts after a short
	// prebuffer instead of a full download. Crossfade/gapless preloading stay on the file path.
	private var streamingSource: StreamingAudioSource?
	private var isStreaming = false
	private var streamReadFormat: AVAudioFormat?
	private var streamingDuration: Double = 0
	private let streamPumpQueue = DispatchQueue(label: "com.yhwav.stream-pump")
	private var streamPumpTimer: DispatchSourceTimer?
	/// Pump-queue-only state (never touch off `streamPumpQueue`).
	private var streamInFlight = 0
	private var streamSchedulingComplete = false
	private let streamReadBufferSize: AVAudioFrameCount = 8192
	private let maxInFlightStreamBuffers = 16

	private var interruptionObserver: NSObjectProtocol?
	private var routeChangeObserver: NSObjectProtocol?

	init(fileCache: AudioFileCache) {
		self.fileCache = fileCache
	}

	private var activeNode: AVAudioPlayerNode { activeDeckIsA ? deckA : deckB }
	private var idleNode: AVAudioPlayerNode { activeDeckIsA ? deckB : deckA }

	// MARK: - Engine lifecycle

	func setup() {
		if !dspRegistered {
			AUAudioUnit.registerSubclass(YhwavDSPUnit.self, as: yhwavDSPDesc, name: "YhwavDSP", version: 1)
			dspRegistered = true
		}

		engine = AVAudioEngine()
		deckA = AVAudioPlayerNode()
		deckB = AVAudioPlayerNode()
		mixerNode = AVAudioMixerNode()
		timePitchNode = AVAudioUnitTimePitch()

		engine.attach(deckA)
		engine.attach(deckB)
		engine.attach(mixerNode)
		engine.attach(timePitchNode)

		let format = engine.mainMixerNode.outputFormat(forBus: 0)

		let sem = DispatchSemaphore(value: 0)
		var createdUnit: AVAudioUnit?

		AVAudioUnit.instantiate(with: yhwavDSPDesc, options: []) { unit, error in
			if let error = error {
				print("YhwavAudio: DSP unit instantiation failed: \(error)")
			}
			createdUnit = unit
			sem.signal()
		}
		sem.wait()

		if let unit = createdUnit {
			dspNode = unit
			engine.attach(unit)
			engine.connect(deckA, to: mixerNode, format: format)
			engine.connect(deckB, to: mixerNode, format: format)
			engine.connect(mixerNode, to: timePitchNode, format: format)
			engine.connect(timePitchNode, to: unit, format: format)
			engine.connect(unit, to: engine.mainMixerNode, format: format)
			print("YhwavAudio: engine setup dual-deck+mixer+DSP format=\(format.sampleRate)Hz/\(format.channelCount)ch")
		} else {
			engine.connect(deckA, to: mixerNode, format: format)
			engine.connect(deckB, to: mixerNode, format: format)
			engine.connect(mixerNode, to: timePitchNode, format: format)
			engine.connect(timePitchNode, to: engine.mainMixerNode, format: format)
			print("YhwavAudio: engine setup dual-deck+mixer (no DSP) format=\(format.sampleRate)Hz/\(format.channelCount)ch")
		}

		deckB.volume = 0
		deckA.volume = _volume

		installLevelTap()
		observeInterruptions()

		do {
			try engine.start()
		} catch {
			print("YhwavAudio: engine start failed: \(error)")
		}
	}

	func teardown() {
		print("YhwavAudio: engine teardown")
		cancelCrossfadeRamp()
		stopStreaming()
		playGeneration &+= 1
		stopLevelTap()
		removeInterruptionObservers()

		deckA?.stop()
		deckB?.stop()
		engine?.stop()

		if let e = engine {
			if let n = deckA { e.detach(n) }
			if let n = deckB { e.detach(n) }
			if let n = mixerNode { e.detach(n) }
			if let n = timePitchNode { e.detach(n) }
			if let n = dspNode { e.detach(n) }
		}

		engine = nil
		deckA = nil
		deckB = nil
		mixerNode = nil
		timePitchNode = nil
		dspNode = nil
		currentFile = nil
		currentTrackId = nil
		currentFrameOffset = 0
		playerTimeBaseOffset = 0
		nextFile = nil
		nextTrackId = nil
		isNextScheduled = false
		crossfadeIdleFile = nil
		crossfadeIdleTrackId = nil
		crossfadeIdleReady = false
		crossfadeInProgress = false
		activeDeckIsA = true
		_isPlaying = false
		cachedPlaybackSeconds = 0
	}

	// MARK: - Crossfade tick (from module progress timer)

	func tickCrossfadeIfNeeded() {
		guard crossfadeEnabled, _isPlaying, !crossfadeInProgress, crossfadeIdleReady else { return }
		let dur = currentDuration
		guard dur > 0, nextCrossfadeDuration > 0 else { return }
		let remaining = dur - currentPosition
		if remaining <= nextCrossfadeDuration {
			beginCrossfadeRamp()
		}
	}

	// MARK: - Playback

	private func loadAudioFile(url: URL, trackId: String, expectedDurationSeconds: Double?, fallbackURL: URL?) async throws -> AVAudioFile {
		do {
			return try await fileCache.getAudioFile(url: url, trackId: trackId, expectedDurationSeconds: expectedDurationSeconds)
		} catch {
			let ns = error as NSError
			if let fb = fallbackURL,
			   ns.domain == AudioFileCache.errorDomain,
			   ns.code == AudioFileCache.durationMismatchCode {
				print("YhwavAudio: transcode too short vs metadata — trying direct file URL trackId=\(trackId)")
				fileCache.evict(trackIds: Set([trackId]))
				return try await fileCache.getAudioFile(url: fb, trackId: trackId, expectedDurationSeconds: expectedDurationSeconds)
			}
			throw error
		}
	}

	func play(url: URL, trackId: String, expectedDurationSeconds: Double? = nil, fallbackURL: URL? = nil, startPaused: Bool = false, startAtSeconds: Double? = nil) async throws {
		guard let deckA = deckA, let engine = engine else { return }

		playGeneration &+= 1
		let gen = playGeneration

		cancelCrossfadeRamp()
		crossfadeInProgress = false
		crossfadeIdleReady = false
		crossfadeIdleFile = nil
		crossfadeIdleTrackId = nil
		stopStreaming()
		deckA.stop()
		deckB.stop()
		isNextScheduled = false
		nextFile = nil
		nextTrackId = nil
		activeDeckIsA = true
		deckA.volume = _volume
		deckB.volume = 0

		print("YhwavAudio: play trackId=\(trackId)")

		// Prefer progressive streaming for remote tracks that aren't already on disk, so playback starts
		// after a short prebuffer. Any failure falls through to the full-download path below.
		//
		// Stream the DIRECT original file (`fallbackURL`) rather than the Plex universal transcoder: the
		// transcoder returns a truncated body with no Content-Length and closes after a few seconds, which
		// the stream reader correctly interprets as end-of-track (causing auto-skips). The original is a
		// static file with a real Content-Length and range support, so it streams reliably.
		let streamURL = fallbackURL ?? url
		if !streamURL.isFileURL && !fileCache.hasCached(trackId: trackId) {
			do {
				try await playStreaming(url: streamURL, trackId: trackId, expectedDurationSeconds: expectedDurationSeconds, gen: gen, startPaused: startPaused, startAtSeconds: startAtSeconds)
				return
			} catch {
				guard gen == playGeneration else { return }
				print("YhwavAudio: stream failed trackId=\(trackId), falling back to download: \(error.localizedDescription)")
			}
		}

		let file: AVAudioFile
		do {
			file = try await loadAudioFile(url: url, trackId: trackId, expectedDurationSeconds: expectedDurationSeconds, fallbackURL: fallbackURL)
		} catch {
			print("YhwavAudio: error trackId=\(trackId): \(error.localizedDescription)")
			throw error
		}

		guard gen == playGeneration else {
			print("YhwavAudio: play trackId=\(trackId) stale (gen \(gen) != \(playGeneration))")
			return
		}

		reconnectIfNeeded(for: file)

		if !engine.isRunning {
			try engine.start()
		}

		currentFile = file
		currentTrackId = trackId
		let sampleRate = file.processingFormat.sampleRate
		// Start offset (e.g. restoring saved playback position): schedule a segment from that frame.
		let startFrame: AVAudioFramePosition = {
			guard let s = startAtSeconds, s > 0 else { return 0 }
			return max(0, min(AVAudioFramePosition(s * sampleRate), file.length - 1))
		}()
		currentFrameOffset = startFrame
		playerTimeBaseOffset = 0
		cachedPlaybackSeconds = Double(startFrame) / sampleRate

		let duration = Double(file.length) / sampleRate
		print("YhwavAudio: schedule trackId=\(trackId) duration=\(String(format: "%.1f", duration))s startFrame=\(startFrame) startPaused=\(startPaused) (current)")

		if startFrame > 0 {
			let remainingFrames = AVAudioFrameCount(file.length - startFrame)
			deckA.scheduleSegment(file, startingFrame: startFrame, frameCount: remainingFrames, at: nil, completionCallbackType: .dataPlayedBack) { [weak self] _ in
				DispatchQueue.main.async {
					self?.handleTrackCompletion(trackId: trackId, generation: gen)
				}
			}
		} else {
			deckA.scheduleFile(file, at: nil, completionCallbackType: .dataPlayedBack) { [weak self] _ in
				DispatchQueue.main.async {
					self?.handleTrackCompletion(trackId: trackId, generation: gen)
				}
			}
		}

		// Restore/prepare loads a track without starting playback; only start the deck when not paused.
		if startPaused {
			_isPlaying = false
		} else {
			deckA.play()
			_isPlaying = true
		}
		timePitchNode.rate = _rate

		DispatchQueue.main.async { [weak self] in
			self?.tickCrossfadeIfNeeded()
		}
	}

	// MARK: - Streaming path

	/// True while the current track is being progressively streamed (as opposed to played from a
	/// complete on-disk file). The module uses this to avoid preloading the next track onto a deck
	/// that's busy with streamed buffers.
	var isCurrentStreaming: Bool { isStreaming }

	private func playStreaming(url: URL, trackId: String, expectedDurationSeconds: Double?, gen: UInt64, startPaused: Bool = false, startAtSeconds: Double? = nil) async throws {
		guard let deckA = deckA, let engine = engine else {
			throw NSError(domain: "AudioEnginePlayer", code: -10, userInfo: [NSLocalizedDescriptionKey: "Engine unavailable"])
		}

		// Canonical LPCM format at the hardware sample rate so scheduled buffers match the deck's
		// connection without an extra mixer conversion.
		let hwRate = engine.mainMixerNode.outputFormat(forBus: 0).sampleRate
		let sr = hwRate > 0 ? hwRate : 44100
		guard let readFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: sr, channels: 2, interleaved: false) else {
			throw NSError(domain: "AudioEnginePlayer", code: -11, userInfo: [NSLocalizedDescriptionKey: "Bad read format"])
		}

		guard let source = StreamingAudioSource(url: url, trackId: trackId, readFormat: readFormat, cacheDir: fileCache.cacheDirectory) else {
			throw NSError(domain: "AudioEnginePlayer", code: -12, userInfo: [NSLocalizedDescriptionKey: "Could not open stream"])
		}

		source.start()
		do {
			try await source.prime(minimumSeconds: 2.0, timeout: 25)
		} catch {
			source.cancel()
			throw error
		}

		guard gen == playGeneration else {
			source.cancel()
			return
		}

		reconnectIfNeeded(toFormat: readFormat)
		if !engine.isRunning { try engine.start() }

		streamingSource = source
		streamReadFormat = readFormat
		isStreaming = true
		currentFile = nil
		currentTrackId = trackId
		currentFrameOffset = 0
		playerTimeBaseOffset = 0
		cachedPlaybackSeconds = 0
		let parsedDuration = source.duration
		streamingDuration = parsedDuration > 0 ? parsedDuration : (expectedDurationSeconds ?? 0)
		activeDeckIsA = true
		deckA.volume = _volume
		deckB?.volume = 0

		// Start offset (e.g. restoring saved playback position): seek the source before pumping so the
		// first scheduled buffers begin at the saved position rather than the top of the file.
		if let s = startAtSeconds, s > 0 {
			let clamped = streamingDuration > 0 ? min(s, streamingDuration) : s
			source.seek(toTime: clamped)
			currentFrameOffset = AVAudioFramePosition(clamped * sr)
			cachedPlaybackSeconds = clamped
		}

		streamPumpQueue.sync {
			streamInFlight = 0
			streamSchedulingComplete = false
			pumpStream(gen: gen)
		}

		// Restore/prepare loads a track without starting playback; only start the deck when not paused.
		if startPaused {
			_isPlaying = false
		} else {
			deckA.play()
			_isPlaying = true
		}
		timePitchNode.rate = _rate
		startStreamPump(gen: gen)

		print("YhwavAudio: stream start trackId=\(trackId) dur~=\(Int(streamingDuration))s @\(Int(sr))Hz startPaused=\(startPaused)")
	}

	private func startStreamPump(gen: UInt64) {
		stopStreamPumpTimer()
		let timer = DispatchSource.makeTimerSource(queue: streamPumpQueue)
		timer.schedule(deadline: .now() + 0.1, repeating: 0.1)
		timer.setEventHandler { [weak self] in self?.pumpStream(gen: gen) }
		streamPumpTimer = timer
		timer.resume()
	}

	private func stopStreamPumpTimer() {
		streamPumpTimer?.cancel()
		streamPumpTimer = nil
	}

	/// Runs on `streamPumpQueue`. Tops up the active deck with LPCM buffers up to the in-flight budget.
	private func pumpStream(gen: UInt64) {
		guard gen == playGeneration, isStreaming, let source = streamingSource else { return }
		while streamInFlight < maxInFlightStreamBuffers {
			switch source.read(frames: streamReadBufferSize) {
			case .data(let buffer):
				let node = activeNode
				streamInFlight += 1
				node.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
					guard let self = self else { return }
					self.streamPumpQueue.async { self.onStreamBufferPlayed(gen: gen) }
				}
			case .waiting:
				return
			case .end:
				streamSchedulingComplete = true
				if streamInFlight == 0 {
					let tid = currentTrackId
					DispatchQueue.main.async { [weak self] in self?.handleStreamCompletion(trackId: tid, gen: gen) }
				}
				return
			}
		}
	}

	/// Runs on `streamPumpQueue`. A scheduled buffer finished playing.
	private func onStreamBufferPlayed(gen: UInt64) {
		guard gen == playGeneration, isStreaming else { return }
		if streamInFlight > 0 { streamInFlight -= 1 }
		if streamSchedulingComplete {
			if streamInFlight == 0 {
				let tid = currentTrackId
				DispatchQueue.main.async { [weak self] in self?.handleStreamCompletion(trackId: tid, gen: gen) }
			}
		} else {
			pumpStream(gen: gen)
		}
	}

	private func handleStreamCompletion(trackId: String?, gen: UInt64) {
		guard gen == playGeneration, isStreaming, let trackId = trackId, currentTrackId == trackId else { return }
		stopStreamPumpTimer()
		_isPlaying = false
		// A stream that ended with an error (e.g. an unrecoverable connection drop) is NOT a finished
		// track. Surfacing the error instead of firing didFinishTrack prevents the queue from rapidly
		// auto-skipping through truncated downloads.
		if let err = streamingSource?.error {
			let msg = err.localizedDescription
			print("YhwavAudio: stream error trackId=\(trackId): \(msg)")
			delegate?.enginePlayer(self, didEncounterError: msg, trackId: trackId)
			return
		}
		if let done = streamingSource?.completedFileURL {
			fileCache.registerCachedFile(trackId: trackId, fileURL: done)
		}
		trackEndWallTime = Date().timeIntervalSince1970 * 1000
		print("YhwavAudio: stream ended trackId=\(trackId)")
		delegate?.enginePlayer(self, didFinishTrack: trackId)
	}

	private func seekStreaming(to seconds: Double) {
		guard let source = streamingSource, let deckA = deckA else { return }

		playGeneration &+= 1
		let gen = playGeneration
		stopStreamPumpTimer()

		let sr = streamReadFormat?.sampleRate ?? 44100
		let clamped = max(0, streamingDuration > 0 ? min(seconds, streamingDuration) : seconds)
		let wasPlaying = _isPlaying

		let node = activeNode
		node.stop()

		streamPumpQueue.sync {
			streamInFlight = 0
			streamSchedulingComplete = false
		}
		source.seek(toTime: clamped)

		currentFrameOffset = AVAudioFramePosition(clamped * sr)
		playerTimeBaseOffset = 0
		cachedPlaybackSeconds = clamped
		deckA.volume = _volume
		deckB?.volume = 0

		streamPumpQueue.sync { self.pumpStream(gen: gen) }
		if wasPlaying { node.play() }
		startStreamPump(gen: gen)
		print("YhwavAudio: stream seek to=\(String(format: "%.1f", clamped))s")
	}

	private func stopStreaming() {
		guard isStreaming || streamingSource != nil else { return }
		stopStreamPumpTimer()
		if let src = streamingSource {
			if let done = src.completedFileURL, let tid = currentTrackId {
				fileCache.registerCachedFile(trackId: tid, fileURL: done)
			}
			src.cancel()
		}
		streamingSource = nil
		isStreaming = false
		streamReadFormat = nil
		streamingDuration = 0
		streamPumpQueue.sync {
			streamInFlight = 0
			streamSchedulingComplete = false
		}
	}

	func scheduleNext(url: URL, trackId: String, expectedDurationSeconds: Double? = nil, fallbackURL: URL? = nil, forceGapless: Bool = false) async throws {
		guard deckA != nil else { return }
		let gen = playGeneration

		let file: AVAudioFile
		do {
			file = try await loadAudioFile(url: url, trackId: trackId, expectedDurationSeconds: expectedDurationSeconds, fallbackURL: fallbackURL)
		} catch {
			print("YhwavAudio: error loading next trackId=\(trackId): \(error.localizedDescription)")
			return
		}

		guard gen == playGeneration else {
			print("YhwavAudio: scheduleNext trackId=\(trackId) stale (gen \(gen) != \(playGeneration))")
			return
		}

		if crossfadeEnabled && !forceGapless {
			let idle = idleNode
			idle.stop()
			crossfadeIdleFile = file
			crossfadeIdleTrackId = trackId
			let dur = Double(file.length) / file.processingFormat.sampleRate
			print("YhwavAudio: crossfade preload trackId=\(trackId) duration=\(String(format: "%.1f", dur))s on idle deck")

			idle.scheduleFile(file, at: nil, completionCallbackType: .dataPlayedBack) { [weak self] _ in
				DispatchQueue.main.async {
					self?.handleTrackCompletion(trackId: trackId, generation: gen)
				}
			}
			crossfadeIdleReady = true
			isNextScheduled = false
			nextFile = nil
			nextTrackId = nil

			DispatchQueue.main.async { [weak self] in
				self?.tickCrossfadeIfNeeded()
			}
			return
		}

		nextFile = file
		nextTrackId = trackId

		let frameCount = AVAudioFrameCount(file.length)
		let duration = Double(file.length) / file.processingFormat.sampleRate
		print("YhwavAudio: schedule trackId=\(trackId) duration=\(String(format: "%.1f", duration))s frames=\(frameCount) (next gapless)")

		let node = activeNode
		node.scheduleFile(file, at: nil, completionCallbackType: .dataPlayedBack) { [weak self] _ in
			DispatchQueue.main.async {
				self?.handleTrackCompletion(trackId: trackId, generation: gen)
			}
		}
		isNextScheduled = true
	}

	func clearCrossfadeIdle() {
		crossfadeIdleReady = false
		crossfadeIdleFile = nil
		crossfadeIdleTrackId = nil
		idleNode.stop()
	}

	func clearScheduled() {
		cancelCrossfadeRamp()
		stopStreaming()
		playGeneration &+= 1
		deckA.stop()
		deckB.stop()
		currentFile = nil
		currentTrackId = nil
		currentFrameOffset = 0
		playerTimeBaseOffset = 0
		nextFile = nil
		nextTrackId = nil
		isNextScheduled = false
		crossfadeIdleReady = false
		crossfadeIdleFile = nil
		crossfadeIdleTrackId = nil
		crossfadeInProgress = false
		activeDeckIsA = true
		_isPlaying = false
		trackEndWallTime = 0
		cachedPlaybackSeconds = 0
		deckA.volume = _volume
		deckB.volume = 0
	}

	func pause() {
		print("YhwavAudio: pause")
		deckA.pause()
		deckB.pause()
		_isPlaying = false
		cancelCrossfadeRamp()
	}

	func resume() {
		guard let deckA = deckA else { return }
		print("YhwavAudio: resume")

		if let engine = engine, !engine.isRunning {
			do { try engine.start() } catch {
				print("YhwavAudio: engine restart failed: \(error)")
				return
			}
		}

		if crossfadeInProgress {
			deckA.play()
			deckB.play()
		} else {
			activeNode.play()
		}
		_isPlaying = true
	}

	func seek(to seconds: Double) {
		if isStreaming {
			seekStreaming(to: seconds)
			return
		}
		guard let file = currentFile, let deckA = deckA, let deckB = deckB, let trackId = currentTrackId else { return }

		cancelCrossfadeRamp()
		crossfadeInProgress = false
		crossfadeIdleReady = false
		crossfadeIdleFile = nil
		crossfadeIdleTrackId = nil

		playGeneration &+= 1
		let gen = playGeneration

		let sampleRate = file.processingFormat.sampleRate
		let targetFrame = AVAudioFramePosition(seconds * sampleRate)
		let clampedFrame = max(0, min(targetFrame, file.length - 1))
		let remainingFrames = AVAudioFrameCount(file.length - clampedFrame)

		print("YhwavAudio: seek trackId=\(trackId) to=\(String(format: "%.1f", seconds))s frame=\(clampedFrame)")

		cachedPlaybackSeconds = Double(clampedFrame) / sampleRate

		let wasPlaying = _isPlaying
		deckA.stop()
		deckB.stop()
		isNextScheduled = false
		nextFile = nil
		nextTrackId = nil

		currentFrameOffset = clampedFrame
		playerTimeBaseOffset = 0

		let node = activeNode
		node.scheduleSegment(file, startingFrame: clampedFrame, frameCount: remainingFrames, at: nil, completionCallbackType: .dataPlayedBack) { [weak self] _ in
			DispatchQueue.main.async {
				self?.handleTrackCompletion(trackId: trackId, generation: gen)
			}
		}

		if !crossfadeEnabled, let nf = nextFile, let nid = nextTrackId {
			let chainNode = activeNode
			chainNode.scheduleFile(nf, at: nil, completionCallbackType: .dataPlayedBack) { [weak self] _ in
				DispatchQueue.main.async {
					self?.handleTrackCompletion(trackId: nid, generation: gen)
				}
			}
			isNextScheduled = true
		}

		deckA.volume = activeDeckIsA ? _volume : 0
		deckB.volume = activeDeckIsA ? 0 : _volume

		if wasPlaying {
			node.play()
		}
	}

	// MARK: - State

	var isPlaying: Bool { _isPlaying }

	var currentPosition: Double {
		if isStreaming {
			let dur = currentDuration
			let node = activeNode
			guard let nodeTime = node.lastRenderTime,
				  nodeTime.isSampleTimeValid,
				  let playerTime = node.playerTime(forNodeTime: nodeTime) else {
				return max(0, cachedPlaybackSeconds)
			}
			let sr = streamReadFormat?.sampleRate ?? playerTime.sampleRate
			let frames = playerTime.sampleTime - playerTimeBaseOffset + currentFrameOffset
			var pos = Double(frames) / sr
			if dur > 0 { pos = min(pos, dur) }
			let clamped = max(0, pos)
			cachedPlaybackSeconds = clamped
			return clamped
		}
		guard let file = currentFile else {
			cachedPlaybackSeconds = 0
			return 0
		}
		let dur = Double(file.length) / file.processingFormat.sampleRate
		let node = activeNode
		guard let nodeTime = node.lastRenderTime,
			  nodeTime.isSampleTimeValid,
			  let playerTime = node.playerTime(forNodeTime: nodeTime) else {
			return max(0, min(cachedPlaybackSeconds, dur))
		}
		let frames = playerTime.sampleTime - playerTimeBaseOffset + currentFrameOffset
		let pos = Double(frames) / file.processingFormat.sampleRate
		let clamped = max(0, min(pos, dur))
		cachedPlaybackSeconds = clamped
		return clamped
	}

	var currentDuration: Double {
		if isStreaming {
			// Parsed duration refines as more of the file downloads; keep the largest known estimate.
			let parsed = streamingSource?.duration ?? 0
			return max(streamingDuration, parsed)
		}
		guard let file = currentFile else { return 0 }
		return Double(file.length) / file.processingFormat.sampleRate
	}

	var volume: Float {
		get { _volume }
		set {
			_volume = max(0, min(1, newValue))
			if crossfadeInProgress {
				return
			}
			activeNode.volume = _volume
			idleNode.volume = 0
			print("YhwavAudio: volume=\(_volume)")
		}
	}

	var rate: Float {
		get { _rate }
		set {
			_rate = max(0.5, min(2.0, newValue))
			timePitchNode?.rate = _rate
			print("YhwavAudio: rate=\(_rate)")
		}
	}

	// MARK: - Crossfade ramp

	private func beginCrossfadeRamp() {
		guard crossfadeEnabled, crossfadeIdleReady, let idleId = crossfadeIdleTrackId, !crossfadeInProgress else { return }
		guard let outgoing = currentTrackId else { return }

		crossfadeInProgress = true
		crossfadeOutgoingIsA = activeDeckIsA
		finishedTrackIdForRamp = outgoing
		crossfadeRampDurationActive = max(0.1, nextCrossfadeDuration)

		let inc = idleNode
		let out = activeNode

		inc.volume = 0
		out.volume = _volume
		inc.play()

		crossfadeRampStartTime = CACurrentMediaTime()
		cancelCrossfadeRamp()

		let link = CADisplayLink(target: CrossfadeRampProxy.shared, selector: #selector(CrossfadeRampProxy.tick))
		CrossfadeRampProxy.shared.player = self
		link.add(to: .main, forMode: .common)
		crossfadeRampLink = link
		print("YhwavAudio: crossfade ramp start \(outgoing) → \(idleId) over \(crossfadeRampDurationActive)s")
	}

	fileprivate func crossfadeRampStep() {
		guard crossfadeInProgress, crossfadeRampLink != nil else { return }
		let t = (CACurrentMediaTime() - crossfadeRampStartTime) / crossfadeRampDurationActive
		if t >= 1.0 {
			finishCrossfadeRamp()
			return
		}
		let s = Float(t)
		let outVol = sqrtf(1.0 - s) * _volume
		let inVol = sqrtf(s) * _volume
		if crossfadeOutgoingIsA {
			deckA.volume = outVol
			deckB.volume = inVol
		} else {
			deckB.volume = outVol
			deckA.volume = inVol
		}
	}

	private func finishCrossfadeRamp() {
		cancelCrossfadeRamp()

		guard let finishedId = finishedTrackIdForRamp, let idleFile = crossfadeIdleFile, let idleId = crossfadeIdleTrackId else {
			crossfadeInProgress = false
			return
		}

		let outgoingWasA = crossfadeOutgoingIsA
		if outgoingWasA {
			deckA.stop()
			deckA.volume = 0
			deckB.volume = _volume
		} else {
			deckB.stop()
			deckB.volume = 0
			deckA.volume = _volume
		}

		activeDeckIsA = !activeDeckIsA
		currentFile = idleFile
		currentTrackId = idleId
		currentFrameOffset = 0
		playerTimeBaseOffset = 0
		cachedPlaybackSeconds = 0

		crossfadeIdleFile = nil
		crossfadeIdleTrackId = nil
		crossfadeIdleReady = false
		crossfadeInProgress = false
		finishedTrackIdForRamp = nil
		isNextScheduled = false
		nextFile = nil
		nextTrackId = nil

		let now = Date().timeIntervalSince1970 * 1000
		trackEndWallTime = now
		delegate?.enginePlayer(self, didFinishTrack: finishedId)
	}

	private func cancelCrossfadeRamp() {
		crossfadeRampLink?.invalidate()
		crossfadeRampLink = nil
		CrossfadeRampProxy.shared.player = nil
	}

	// MARK: - Track completion (gapless + crossfade fallback)

	private func handleTrackCompletion(trackId: String, generation: UInt64) {
		guard generation == playGeneration else { return }
		guard trackId == currentTrackId else { return }

		if crossfadeInProgress {
			return
		}

		let now = Date().timeIntervalSince1970 * 1000

		if crossfadeEnabled, crossfadeIdleReady, let nf = crossfadeIdleFile, let nid = crossfadeIdleTrackId {
			print("YhwavAudio: active ended with crossfade idle preloaded → \(nid)")
			activeNode.stop()
			activeDeckIsA.toggle()
			currentFile = nf
			currentTrackId = nid
			currentFrameOffset = 0
			playerTimeBaseOffset = 0
			cachedPlaybackSeconds = 0
			crossfadeIdleFile = nil
			crossfadeIdleTrackId = nil
			crossfadeIdleReady = false
			deckA.volume = activeDeckIsA ? _volume : 0
			deckB.volume = activeDeckIsA ? 0 : _volume
			if _isPlaying {
				activeNode.play()
			}
			trackEndWallTime = now
			delegate?.enginePlayer(self, didFinishTrack: trackId)
			return
		}

		if !crossfadeEnabled, isNextScheduled, let nid = nextTrackId, let nf = nextFile {
			let gap = trackEndWallTime > 0 ? Int(now - trackEndWallTime) : 0
			print("YhwavAudio: transition trackId=\(trackId) → \(nid) gap=\(gap)ms")

			let previousFileLength = currentFile?.length ?? 0
			let node = activeNode
			if let nt = node.lastRenderTime, nt.isSampleTimeValid,
			   let pt = node.playerTime(forNodeTime: nt) {
				playerTimeBaseOffset = pt.sampleTime - currentFrameOffset
			} else {
				playerTimeBaseOffset += previousFileLength - currentFrameOffset
			}

			currentFile = nf
			currentTrackId = nid
			currentFrameOffset = 0
			nextFile = nil
			nextTrackId = nil
			isNextScheduled = false
			cachedPlaybackSeconds = 0
		} else {
			print("YhwavAudio: transition trackId=\(trackId) → end (no next scheduled)")
			_isPlaying = false
		}

		trackEndWallTime = now
		delegate?.enginePlayer(self, didFinishTrack: trackId)
	}

	// MARK: - Format handling

	private func reconnectIfNeeded(for file: AVAudioFile) {
		reconnectIfNeeded(toFormat: file.processingFormat)
	}

	private func reconnectIfNeeded(toFormat fileFormat: AVAudioFormat) {
		guard let engine = engine, let mixer = mixerNode, let timePitchNode = timePitchNode else { return }
		let currentFormat = deckA.outputFormat(forBus: 0)

		let formatChanged = fileFormat.sampleRate != currentFormat.sampleRate || fileFormat.channelCount != currentFormat.channelCount
		guard formatChanged else { return }

		let wasRunning = engine.isRunning
		if wasRunning { engine.stop() }

		engine.disconnectNodeOutput(deckA)
		engine.disconnectNodeOutput(deckB)
		engine.disconnectNodeOutput(mixer)
		engine.disconnectNodeOutput(timePitchNode)

		if let dsp = dspNode {
			engine.disconnectNodeOutput(dsp)
			engine.connect(deckA, to: mixer, format: fileFormat)
			engine.connect(deckB, to: mixer, format: fileFormat)
			engine.connect(mixer, to: timePitchNode, format: fileFormat)
			engine.connect(timePitchNode, to: dsp, format: fileFormat)
			engine.connect(dsp, to: engine.mainMixerNode, format: fileFormat)
		} else {
			engine.connect(deckA, to: mixer, format: fileFormat)
			engine.connect(deckB, to: mixer, format: fileFormat)
			engine.connect(mixer, to: timePitchNode, format: fileFormat)
			engine.connect(timePitchNode, to: engine.mainMixerNode, format: fileFormat)
		}

		print("YhwavAudio: engine reconnect format=\(fileFormat.sampleRate)Hz/\(fileFormat.channelCount)ch")

		if wasRunning {
			do { try engine.start() } catch {
				print("YhwavAudio: engine restart after reconnect failed: \(error)")
			}
		}
	}

	// MARK: - Level metering

	private func installLevelTap() {
		guard let engine = engine else { return }
		let mixer = engine.mainMixerNode
		let format = mixer.outputFormat(forBus: 0)
		guard format.sampleRate > 0 else { return }

		mixer.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
			guard let self = self, self._isPlaying else { return }
			let levels = Self.computeLevels(buffer: buffer, bandCount: 5)
			DispatchQueue.main.async {
				self.delegate?.enginePlayer(self, didUpdateLevels: levels)
			}
		}
	}

	private func stopLevelTap() {
		engine?.mainMixerNode.removeTap(onBus: 0)
	}

	static func computeLevels(buffer: AVAudioPCMBuffer, bandCount: Int) -> [Float] {
		guard let channelData = buffer.floatChannelData else {
			return [Float](repeating: 0, count: bandCount)
		}
		let frameLength = Int(buffer.frameLength)
		guard frameLength > 0 else { return [Float](repeating: 0, count: bandCount) }

		let samples = channelData[0]
		var bands = [Float](repeating: 0, count: bandCount)
		let bandFrames = max(1, frameLength / bandCount)

		for b in 0..<bandCount {
			let start = b * bandFrames
			let count = min(bandFrames, frameLength - start)
			guard count > 0 else { continue }
			var rms: Float = 0
			vDSP_rmsqv(samples.advanced(by: start), 1, &rms, vDSP_Length(count))
			bands[b] = min(1, max(0, rms * 4))
		}
		return bands
	}

	// MARK: - Audio interruptions

	private func observeInterruptions() {
		interruptionObserver = NotificationCenter.default.addObserver(
			forName: AVAudioSession.interruptionNotification,
			object: nil,
			queue: .main
		) { [weak self] notification in
			guard let info = notification.userInfo,
				  let typeValue = info[AVAudioSessionInterruptionTypeKey] as? UInt,
				  let type = AVAudioSession.InterruptionType(rawValue: typeValue) else { return }

			switch type {
			case .began:
				print("YhwavAudio: engine interrupted type=began")
				self?.pause()
			case .ended:
				print("YhwavAudio: engine interrupted type=ended")
				if let opts = info[AVAudioSessionInterruptionOptionKey] as? UInt,
				   AVAudioSession.InterruptionOptions(rawValue: opts).contains(.shouldResume) {
					self?.resume()
				}
			@unknown default:
				break
			}
		}

		routeChangeObserver = NotificationCenter.default.addObserver(
			forName: AVAudioSession.routeChangeNotification,
			object: nil,
			queue: .main
		) { [weak self] notification in
			guard let info = notification.userInfo,
				  let reasonValue = info[AVAudioSessionRouteChangeReasonKey] as? UInt,
				  let reason = AVAudioSession.RouteChangeReason(rawValue: reasonValue) else { return }

			print("YhwavAudio: engine route changed reason=\(reason.rawValue)")

			if reason == .oldDeviceUnavailable {
				self?.pause()
			}
		}
	}

	private func removeInterruptionObservers() {
		if let obs = interruptionObserver {
			NotificationCenter.default.removeObserver(obs)
			interruptionObserver = nil
		}
		if let obs = routeChangeObserver {
			NotificationCenter.default.removeObserver(obs)
			routeChangeObserver = nil
		}
	}

	deinit {
		teardown()
	}
}

// CADisplayLink needs a NSObject target
private final class CrossfadeRampProxy: NSObject {
	static let shared = CrossfadeRampProxy()
	weak var player: AudioEnginePlayer?

	@objc func tick() {
		player?.crossfadeRampStep()
	}
}
