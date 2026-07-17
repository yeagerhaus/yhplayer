import AVFoundation
import Accelerate
import Foundation

/// Extracts a downsampled amplitude envelope ("waveform peaks") from an audio file on disk.
/// Used to persist real waveform data for downloaded tracks so the player scrubber can render
/// an accurate waveform instead of a decorative placeholder.
enum WaveformExtractor {
	/// Reads `url` and returns `buckets` normalized peak amplitudes in 0...1.
	/// Returns `nil` if the file can't be opened/decoded.
	static func extractPeaks(url: URL, buckets: Int) -> [Float]? {
		guard buckets > 0 else { return nil }
		guard let file = try? AVAudioFile(forReading: url) else { return nil }

		let format = file.processingFormat
		let totalFrames = file.length
		guard totalFrames > 0, format.channelCount > 0 else { return nil }

		let framesPerBucket = max(1, Int(totalFrames) / buckets)
		let chunkFrames: AVAudioFrameCount = 65_536
		guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: chunkFrames) else { return nil }

		let channelCount = Int(format.channelCount)
		var peaks = [Float](repeating: 0, count: buckets)
		var frameIndex = 0

		while true {
			buffer.frameLength = 0
			do {
				try file.read(into: buffer, frameCount: chunkFrames)
			} catch {
				break
			}
			let n = Int(buffer.frameLength)
			if n == 0 { break }
			guard let channels = buffer.floatChannelData else { break }

			// Per-frame magnitude = max abs across channels; track the peak in each bucket.
			for i in 0..<n {
				var mag: Float = 0
				for c in 0..<channelCount {
					let v = fabsf(channels[c][i])
					if v > mag { mag = v }
				}
				let bucket = min(buckets - 1, (frameIndex + i) / framesPerBucket)
				if mag > peaks[bucket] { peaks[bucket] = mag }
			}

			frameIndex += n
			if frameIndex >= Int(totalFrames) { break }
		}

		// Normalize so the loudest peak maps to 1.0.
		var maxPeak: Float = 0
		vDSP_maxv(peaks, 1, &maxPeak, vDSP_Length(buckets))
		if maxPeak > 0.0001 {
			var scale = 1.0 / maxPeak
			vDSP_vsmul(peaks, 1, &scale, &peaks, 1, vDSP_Length(buckets))
		}

		return peaks
	}
}
