import AVFoundation
import AudioToolbox
import Foundation

// MARK: - Converter status sentinels
//
// AudioConverterFillComplexBuffer surfaces whatever OSStatus our input callback returns. These
// arbitrary (non-conflicting) codes let `read` distinguish "the stream is genuinely finished" from
// "we've drained everything downloaded so far but more is coming".
private let kYhwavReaderMissingSourceFormat: OSStatus = 932332582
private let kYhwavReaderReachedEndOfData: OSStatus = 932332581
private let kYhwavReaderNotEnoughData: OSStatus = 932332580

// MARK: - C callbacks (Audio File Stream Services + Audio Converter Services)

private func yhwavParserPropertyCallback(
	_ context: UnsafeMutableRawPointer,
	_ streamID: AudioFileStreamID,
	_ propertyID: AudioFileStreamPropertyID,
	_ flags: UnsafeMutablePointer<AudioFileStreamPropertyFlags>
) {
	let source = Unmanaged<StreamingAudioSource>.fromOpaque(context).takeUnretainedValue()
	switch propertyID {
	case kAudioFileStreamProperty_DataFormat:
		var asbd = AudioStreamBasicDescription()
		var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
		if AudioFileStreamGetProperty(streamID, propertyID, &size, &asbd) == noErr {
			source.setDataFormat(AVAudioFormat(streamDescription: &asbd))
		}
	case kAudioFileStreamProperty_AudioDataPacketCount:
		var count: UInt64 = 0
		var size = UInt32(MemoryLayout<UInt64>.size)
		if AudioFileStreamGetProperty(streamID, propertyID, &size, &count) == noErr {
			source.setTotalPacketCount(count)
		}
	default:
		break
	}
}

private func yhwavParserPacketCallback(
	_ context: UnsafeMutableRawPointer,
	_ byteCount: UInt32,
	_ packetCount: UInt32,
	_ data: UnsafeRawPointer,
	_ packetDescriptions: UnsafeMutablePointer<AudioStreamPacketDescription>?
) {
	let source = Unmanaged<StreamingAudioSource>.fromOpaque(context).takeUnretainedValue()
	// `packetDescriptions` is non-nil for compressed formats (MP3/AAC) and nil for constant-bitrate PCM.
	source.appendPackets(count: Int(packetCount), data: data, descriptions: packetDescriptions)
}

private func yhwavReaderConverterCallback(
	_ converter: AudioConverterRef,
	_ ioNumberDataPackets: UnsafeMutablePointer<UInt32>,
	_ ioData: UnsafeMutablePointer<AudioBufferList>,
	_ outPacketDescriptions: UnsafeMutablePointer<UnsafeMutablePointer<AudioStreamPacketDescription>?>?,
	_ context: UnsafeMutableRawPointer?
) -> OSStatus {
	guard let context = context else { return kYhwavReaderMissingSourceFormat }
	let source = Unmanaged<StreamingAudioSource>.fromOpaque(context).takeUnretainedValue()
	return source.provideNextPacket(ioNumberDataPackets: ioNumberDataPackets, ioData: ioData, outPacketDescriptions: outPacketDescriptions)
}

// MARK: - StreamingAudioSource

/// Streams a remote compressed audio file (e.g. Plex `start.mp3`) into LPCM `AVAudioPCMBuffer`s that
/// can be scheduled onto an existing `AVAudioPlayerNode`, so playback can start after a short
/// prebuffer instead of waiting for the whole file.
///
/// Pipeline: `URLSession` (progressive download) → Audio File Stream Services (parse → packets) →
/// `AudioConverterFillComplexBuffer` (packets → LPCM). Bytes are also persisted to a temp file so a
/// fully-streamed track lands in the on-disk cache for instant replay/seek.
///
/// Threading: download callbacks arrive on the URLSession delegate queue; `read`/`seek` are called
/// by the engine's pump on a single serial queue. Shared parser/converter state is guarded by
/// `stateLock`.
final class StreamingAudioSource: NSObject {
	enum ReadResult {
		case data(AVAudioPCMBuffer)
		/// Everything downloaded so far is drained but the download is still in flight — try again shortly.
		case waiting
		/// The entire stream has been decoded and scheduled.
		case end
	}

	let trackId: String
	private let url: URL
	private let readFormat: AVAudioFormat

	private let stateLock = NSLock()
	private var streamID: AudioFileStreamID?
	private var converter: AudioConverterRef?
	private var dataFormat: AVAudioFormat?
	private var packets: [(Data, AudioStreamPacketDescription?)] = []
	private var currentPacket: Int = 0
	private var totalPacketCount: UInt64 = 0
	private var parsingComplete = false
	private var _error: Error?

	// Per-callback scratch owned by us (freed on the next callback / dispose) so the converter never
	// reads freed memory and we don't leak one allocation per packet.
	private var scratch: UnsafeMutableRawPointer?
	private var packetDescPtr: UnsafeMutablePointer<AudioStreamPacketDescription>?

	private var session: URLSession?
	private var task: URLSessionDataTask?

	// Range-resume state: direct Plex files can have their connection dropped mid-transfer
	// ("network connection was lost"), especially large FLACs. They advertise Accept-Ranges: bytes,
	// so we resume from the last received byte instead of treating the drop as end-of-track.
	private var contentLength: Int64 = 0
	private var bytesReceived: Int64 = 0
	private var resumeAttempts = 0
	private let maxResumeAttempts = 8
	private var cancelled = false

	// Cache persistence
	private let persistURL: URL
	private var persistHandle: FileHandle?
	private var persistFailed = false
	private(set) var completedFileURL: URL?

	init?(url: URL, trackId: String, readFormat: AVAudioFormat, cacheDir: URL) {
		self.url = url
		self.trackId = trackId
		self.readFormat = readFormat
		// Persist with the SOURCE's real extension (e.g. flac/mp3/m4a). `AVAudioFile(forReading:)` uses the
		// file extension as a format hint, so a hardcoded `.mp3` on FLAC bytes makes it run the MP3 parser and
		// fail with kAudioFileInvalidFileError (1685348671) when the cached file is reopened on replay.
		let sourceExt = url.pathExtension.isEmpty ? "mp3" : url.pathExtension
		self.persistURL = cacheDir.appendingPathComponent("stream-\(trackId).\(sourceExt)")
		super.init()

		let context = Unmanaged.passUnretained(self).toOpaque()
		// Hint 0 = auto-detect. Originals may be MP3/FLAC/ALAC/AAC, not just MP3.
		let status = AudioFileStreamOpen(context, yhwavParserPropertyCallback, yhwavParserPacketCallback, 0, &streamID)
		guard status == noErr, streamID != nil else {
			return nil
		}

		try? FileManager.default.removeItem(at: persistURL)
		FileManager.default.createFile(atPath: persistURL.path, contents: nil)
		persistHandle = try? FileHandle(forWritingTo: persistURL)
		if persistHandle == nil { persistFailed = true }
	}

	// MARK: - Lifecycle

	func start() {
		let config = URLSessionConfiguration.default
		config.waitsForConnectivity = true
		config.requestCachePolicy = .reloadIgnoringLocalCacheData
		config.timeoutIntervalForRequest = 30
		let session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
		self.session = session
		startTask(rangeFrom: 0)
	}

	/// Starts (or restarts) the download. `offset > 0` issues an HTTP Range request so we resume exactly
	/// where a dropped connection left off, keeping the byte stream contiguous for the parser.
	private func startTask(rangeFrom offset: Int64) {
		guard let session = session else { return }
		var request = URLRequest(url: url)
		if offset > 0 {
			request.setValue("bytes=\(offset)-", forHTTPHeaderField: "Range")
		}
		let task = session.dataTask(with: request)
		self.task = task
		task.resume()
	}

	/// Stops the network transfer. The parser/converter are intentionally torn down in `deinit` rather
	/// than here: ARC guarantees no `read`/parse is in-flight once the last reference is released, so we
	/// never dispose Core Audio objects out from under a running callback. `invalidateAndCancel` also
	/// releases the session's strong reference to us (its delegate), allowing deinit to run.
	func cancel() {
		cancelled = true
		task?.cancel()
		session?.invalidateAndCancel()
		task = nil
		session = nil
	}

	private func dispose() {
		stateLock.lock()
		if let s = streamID {
			AudioFileStreamClose(s)
			streamID = nil
		}
		if let c = converter {
			AudioConverterDispose(c)
			converter = nil
		}
		if let sc = scratch {
			sc.deallocate()
			scratch = nil
		}
		if let pd = packetDescPtr {
			pd.deallocate()
			packetDescPtr = nil
		}
		try? persistHandle?.close()
		persistHandle = nil
		stateLock.unlock()
	}

	deinit {
		dispose()
	}

	// MARK: - Parser callbacks (state mutation)

	fileprivate func setDataFormat(_ format: AVAudioFormat?) {
		guard let format = format else { return }
		stateLock.lock()
		if dataFormat == nil {
			dataFormat = format
			createConverterLocked()
		}
		stateLock.unlock()
	}

	fileprivate func setTotalPacketCount(_ count: UInt64) {
		stateLock.lock()
		totalPacketCount = count
		stateLock.unlock()
	}

	private func createConverterLocked() {
		guard converter == nil, let dataFormat = dataFormat else { return }
		var source = dataFormat.streamDescription.pointee
		var dest = readFormat.streamDescription.pointee
		var conv: AudioConverterRef?
		if AudioConverterNew(&source, &dest, &conv) == noErr {
			converter = conv
		}
	}

	fileprivate func appendPackets(count: Int, data: UnsafeRawPointer, descriptions: UnsafeMutablePointer<AudioStreamPacketDescription>?) {
		guard count > 0 else { return }
		stateLock.lock()
		let format = dataFormat?.streamDescription.pointee
		if let descriptions = descriptions {
			for i in 0..<count {
				let desc = descriptions[i]
				let start = Int(desc.mStartOffset)
				let size = Int(desc.mDataByteSize)
				let packet = Data(bytes: data.advanced(by: start), count: size)
				packets.append((packet, desc))
			}
		} else if let format = format, format.mBytesPerPacket > 0 {
			let bytesPerPacket = Int(format.mBytesPerPacket)
			for i in 0..<count {
				let start = i * bytesPerPacket
				let packet = Data(bytes: data.advanced(by: start), count: bytesPerPacket)
				packets.append((packet, nil))
			}
		}
		stateLock.unlock()
	}

	// MARK: - Converter input callback

	fileprivate func provideNextPacket(
		ioNumberDataPackets: UnsafeMutablePointer<UInt32>,
		ioData: UnsafeMutablePointer<AudioBufferList>,
		outPacketDescriptions: UnsafeMutablePointer<UnsafeMutablePointer<AudioStreamPacketDescription>?>?
	) -> OSStatus {
		stateLock.lock()
		defer { stateLock.unlock() }

		guard let dataFormat = dataFormat else {
			ioNumberDataPackets.pointee = 0
			return kYhwavReaderMissingSourceFormat
		}

		guard currentPacket < packets.count else {
			ioNumberDataPackets.pointee = 0
			return parsingComplete ? kYhwavReaderReachedEndOfData : kYhwavReaderNotEnoughData
		}

		let (packetData, desc) = packets[currentPacket]
		let byteCount = packetData.count

		if let sc = scratch { sc.deallocate() }
		let raw = UnsafeMutableRawPointer.allocate(byteCount: max(1, byteCount), alignment: 1)
		packetData.copyBytes(to: raw.assumingMemoryBound(to: UInt8.self), count: byteCount)
		scratch = raw

		ioData.pointee.mNumberBuffers = 1
		ioData.pointee.mBuffers.mData = raw
		ioData.pointee.mBuffers.mDataByteSize = UInt32(byteCount)
		ioData.pointee.mBuffers.mNumberChannels = dataFormat.streamDescription.pointee.mChannelsPerFrame

		if dataFormat.streamDescription.pointee.mFormatID != kAudioFormatLinearPCM {
			if packetDescPtr == nil {
				packetDescPtr = UnsafeMutablePointer<AudioStreamPacketDescription>.allocate(capacity: 1)
			}
			var d = desc ?? AudioStreamPacketDescription()
			d.mStartOffset = 0
			d.mVariableFramesInPacket = 0
			d.mDataByteSize = UInt32(byteCount)
			packetDescPtr!.pointee = d
			outPacketDescriptions?.pointee = packetDescPtr
		}

		ioNumberDataPackets.pointee = 1
		currentPacket += 1
		return noErr
	}

	// MARK: - Read (called by engine pump, serially)

	func read(frames: AVAudioFrameCount) -> ReadResult {
		guard let converter = stateLock.guarded({ converter }) else { return .waiting }
		guard let buffer = AVAudioPCMBuffer(pcmFormat: readFormat, frameCapacity: frames) else { return .waiting }
		buffer.frameLength = frames

		// LPCM read format has mFramesPerPacket == 1, so packets requested == frames.
		var packetCount = frames
		let context = Unmanaged.passUnretained(self).toOpaque()
		let status = AudioConverterFillComplexBuffer(converter, yhwavReaderConverterCallback, context, &packetCount, buffer.mutableAudioBufferList, nil)

		stateLock.lock()
		if let sc = scratch { sc.deallocate(); scratch = nil }
		stateLock.unlock()

		switch status {
		case noErr:
			if packetCount == 0 { return .waiting }
			buffer.frameLength = packetCount
			return .data(buffer)
		case kYhwavReaderReachedEndOfData:
			if packetCount == 0 { return .end }
			buffer.frameLength = packetCount
			return .data(buffer)
		case kYhwavReaderNotEnoughData, kYhwavReaderMissingSourceFormat:
			return .waiting
		default:
			return .waiting
		}
	}

	func seek(toTime time: Double) {
		guard let sr = stateLock.guarded({ dataFormat?.streamDescription.pointee.mSampleRate }), sr > 0,
			  let framesPerPacket = stateLock.guarded({ dataFormat?.streamDescription.pointee.mFramesPerPacket }), framesPerPacket > 0
		else { return }
		let frame = max(0, time * sr)
		let packet = Int(frame / Double(framesPerPacket))
		stateLock.lock()
		currentPacket = min(max(0, packet), max(0, packets.count))
		stateLock.unlock()
	}

	// MARK: - Introspection

	var error: Error? { stateLock.guarded { _error } }

	var hasFormat: Bool { stateLock.guarded { dataFormat != nil && converter != nil } }

	var isParsingComplete: Bool { stateLock.guarded { parsingComplete } }

	/// Seconds of audio parsed (and thus schedulable) so far.
	var bufferedSeconds: Double {
		stateLock.guarded {
			guard let asbd = dataFormat?.streamDescription.pointee, asbd.mSampleRate > 0, asbd.mFramesPerPacket > 0 else { return 0 }
			return Double(packets.count) * Double(asbd.mFramesPerPacket) / asbd.mSampleRate
		}
	}

	/// Best-effort total duration from the parsed packet count (may be 0 until known).
	var duration: Double {
		stateLock.guarded {
			guard let asbd = dataFormat?.streamDescription.pointee, asbd.mSampleRate > 0, asbd.mFramesPerPacket > 0 else { return 0 }
			let pkts = max(totalPacketCount, UInt64(packets.count))
			return Double(pkts) * Double(asbd.mFramesPerPacket) / asbd.mSampleRate
		}
	}

	/// Blocks (async) until enough audio is buffered to start, the download finishes, or it fails/times out.
	func prime(minimumSeconds: Double, timeout: TimeInterval) async throws {
		let deadline = Date().addingTimeInterval(timeout)
		while true {
			if let err = error { throw err }
			let ready = hasFormat
			let complete = isParsingComplete
			if ready && (bufferedSeconds >= minimumSeconds || complete) { return }
			if complete && !ready {
				throw NSError(domain: "StreamingAudioSource", code: -2, userInfo: [NSLocalizedDescriptionKey: "Stream finished before an audio format could be parsed"])
			}
			if Date() > deadline {
				throw NSError(domain: "StreamingAudioSource", code: -1, userInfo: [NSLocalizedDescriptionKey: "Timed out waiting for stream to buffer"])
			}
			try await Task.sleep(nanoseconds: 40_000_000)
		}
	}

	// MARK: - Persistence

	private func persist(_ data: Data) {
		guard !persistFailed, let handle = persistHandle else { return }
		do {
			try handle.write(contentsOf: data)
		} catch {
			persistFailed = true
		}
	}
}

// MARK: - URLSessionDataDelegate

extension StreamingAudioSource: URLSessionDataDelegate {
	func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
		if let http = response as? HTTPURLResponse {
			// Only the initial 200 carries the full length. A 206 (range resume) reports the remaining
			// bytes, so never overwrite the total once known.
			if contentLength == 0, http.statusCode == 200, response.expectedContentLength > 0 {
				contentLength = response.expectedContentLength
			}
		}
		completionHandler(.allow)
	}

	func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
		bytesReceived += Int64(data.count)
		persist(data)

		let sid = stateLock.guarded { streamID }
		guard let sid = sid else { return }
		let status = data.withUnsafeBytes { raw -> OSStatus in
			guard let base = raw.baseAddress else { return noErr }
			return AudioFileStreamParseBytes(sid, UInt32(data.count), base, [])
		}
		if status != noErr {
			stateLock.lock()
			if _error == nil {
				_error = NSError(domain: "StreamingAudioSource", code: Int(status), userInfo: [NSLocalizedDescriptionKey: "Failed to parse audio stream (\(status))"])
			}
			stateLock.unlock()
		}

		// Create the converter as soon as the format is known (the property callback also attempts this).
		if !hasFormat { setDataFormat(stateLock.guarded { dataFormat }) }
	}

	func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
		// A dropped connection before we've received the whole file is recoverable: reconnect with an
		// HTTP Range request from the last byte we got. Keep the stream "alive" (no _error, no
		// parsingComplete) so the reader waits on buffered audio instead of ending the track.
		let incomplete = contentLength > 0 && bytesReceived < contentLength
		if !cancelled, error != nil, incomplete, resumeAttempts < maxResumeAttempts {
			resumeAttempts += 1
			startTask(rangeFrom: bytesReceived)
			return
		}

		stateLock.lock()
		parsingComplete = true
		// Treat an exhausted/incomplete transfer as failure so the reader/engine don't mistake a
		// truncated download for a finished track.
		if _error == nil, let error = error {
			_error = error
		} else if _error == nil, incomplete {
			_error = NSError(domain: "StreamingAudioSource", code: -1, userInfo: [NSLocalizedDescriptionKey: "Stream ended before the full file was received"])
		}
		let failed = persistFailed || _error != nil
		stateLock.unlock()

		try? persistHandle?.close()
		persistHandle = nil

		if !failed {
			completedFileURL = persistURL
		} else {
			try? FileManager.default.removeItem(at: persistURL)
		}
	}
}

// MARK: - NSLock helper

private extension NSLock {
	/// Named `guarded` (not `withLock`) to avoid clashing with the system `NSLock.withLock` on newer SDKs.
	func guarded<T>(_ body: () -> T) -> T {
		lock(); defer { unlock() }
		return body()
	}
}
