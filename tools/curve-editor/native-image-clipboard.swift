// Recover only explicit physical resolution from the image currently on the macOS
// pasteboard after exact normalized-pixel matching. No clipboard content leaves
// this process. --candidate-file is an offline fixture mode that never opens it.
import AppKit
import ImageIO

let maxInputBytes = 18 * 1024 * 1024
let maxCandidateBytes = 32 * 1024 * 1024
let maxRequestBytes = 24 * 1024 * 1024 + 1024
struct Resolution {
    var x: Double
    var y: Double
}
func valid(_ r: Resolution) -> Bool { r.x.isFinite && r.y.isFinite && r.x > 0 && r.y > 0 }
func same(_ a: Resolution, _ b: Resolution) -> Bool {
    // PNG stores integer pixels/metre; accommodate only its rounding error.
    abs(a.x - b.x) <= 0.02 && abs(a.y - b.y) <= 0.02
}
struct Bytes {
    let b: [UInt8]
    func uint(_ p: Int, _ n: Int, _ little: Bool = false) -> UInt64? {
        guard p >= 0, n >= 1, n <= 8, p <= b.count, n <= b.count - p else { return nil }
        var value: UInt64 = 0
        for i in 0..<n { value = (value << 8) | UInt64(b[p + (little ? n - 1 - i : i)]) }
        return value
    }
}
// TIFF resolution must include an explicit ResolutionUnit. ImageIO's DPIWidth /
// DPIHeight may be synthesized as 72 and therefore are deliberately never used.
func tiffResolution(_ b: [UInt8]) -> Resolution? {
    let bytes = Bytes(b: b)
    guard b.count >= 8, (b[0] == 73 && b[1] == 73) || (b[0] == 77 && b[1] == 77) else { return nil }
    let little = b[0] == 73
    guard bytes.uint(2, 2, little) == 42, let offset = bytes.uint(4, 4, little), offset <= UInt64(b.count - 2) else { return nil }
    let p = Int(offset)
    guard let count = bytes.uint(p, 2, little), count <= 4096, Int(count) <= (b.count - p - 2) / 12 else { return nil }
    var tags: [UInt64: Double] = [:]
    for i in 0..<Int(count) {
        let entry = p + 2 + i * 12
        guard let tag = bytes.uint(entry, 2, little), [274, 282, 283, 296].contains(tag) else { continue }
        guard tags[tag] == nil, let type = bytes.uint(entry + 2, 2, little), bytes.uint(entry + 4, 4, little) == 1 else { return nil }
        if (tag == 274 || tag == 296), type == 3, let value = bytes.uint(entry + 8, 2, little) { tags[tag] = Double(value) }
        else if (tag == 282 || tag == 283), type == 5, let at = bytes.uint(entry + 8, 4, little), at <= UInt64(b.count),
                let numerator = bytes.uint(Int(at), 4, little), let denominator = bytes.uint(Int(at) + 4, 4, little), denominator > 0 {
            tags[tag] = Double(numerator) / Double(denominator)
        } else { return nil }
    }
    guard let x = tags[282], let y = tags[283], let unit = tags[296], unit == 2 || unit == 3 else { return nil }
    let r = Resolution(x: x * (unit == 3 ? 2.54 : 1), y: y * (unit == 3 ? 2.54 : 1))
    return valid(r) ? r : nil
}
func explicitResolution(_ data: Data) -> Resolution? {
    let b = [UInt8](data), bytes = Bytes(b: [UInt8](data))
    if b.starts(with: [137,80,78,71,13,10,26,10]) {
        var p = 8
        var resolution: Resolution?
        while p <= b.count - 12 {
            guard let length = bytes.uint(p, 4), length <= UInt64(b.count - p - 12) else { return nil }
            let n = Int(length)
            if Array(b[(p+4)..<(p+8)]) == [112,72,89,115] {
                guard resolution == nil, n == 9, b[p+16] == 1,
                      let x = bytes.uint(p+8, 4), let y = bytes.uint(p+12, 4) else { return nil }
                let r = Resolution(x: Double(x) * 0.0254, y: Double(y) * 0.0254)
                guard valid(r) else { return nil }
                resolution = r
            }
            p += n + 12
        }
        return resolution
    }
    if b.starts(with: [255,216]) {
        var p = 2
        var resolutions: [Resolution] = []
        while p < b.count {
            guard b[p] == 255 else { return nil }
            while p < b.count && b[p] == 255 { p += 1 }
            guard p < b.count else { return nil }
            let marker = b[p]; p += 1
            if marker == 218 || marker == 217 { break }
            if marker == 1 || (208...215).contains(marker) { continue }
            guard let length = bytes.uint(p, 2), length >= 2, length <= UInt64(b.count - p) else { return nil }
            let end = p + Int(length), start = p + 2
            if marker == 224, end - start >= 12, Array(b[start..<(start+5)]) == [74,70,73,70,0] {
                let unit = b[start+7]
                if unit == 1 || unit == 2, let x = bytes.uint(start+8, 2), let y = bytes.uint(start+10, 2) {
                    let r = Resolution(x: Double(x) * (unit == 2 ? 2.54 : 1), y: Double(y) * (unit == 2 ? 2.54 : 1))
                    if valid(r) { resolutions.append(r) }
                }
            }
            if marker == 225, end - start >= 6, Array(b[start..<(start+6)]) == [69,120,105,102,0,0],
               let r = tiffResolution(Array(b[(start+6)..<end])) { resolutions.append(r) }
            p = end
        }
        guard let first = resolutions.first, resolutions.allSatisfy({ same(first, $0) }) else { return nil }
        return first
    }
    return tiffResolution(b)
}
func a4ScannerDefault(_ raster: Raster) -> Bool {
    let sourceWidth = raster.orientation >= 5 ? raster.height : raster.width
    let sourceHeight = raster.orientation >= 5 ? raster.width : raster.height
    return (sourceWidth == 826 && sourceHeight == 1168) ||
        (sourceWidth == 1168 && sourceHeight == 826)
}
func supportedPaste(_ data: Data) -> Bool {
    let prefix = [UInt8](data.prefix(12))
    return prefix.starts(with: [137,80,78,71,13,10,26,10]) ||
        prefix.starts(with: [255,216]) ||
        (prefix.count == 12 && Array(prefix[0..<4]) == [82,73,70,70] && Array(prefix[8..<12]) == [87,69,66,80])
}
struct Raster {
    let width: Int
    let height: Int
    let orientation: Int
    let pixels: [UInt8]
}
func decode(_ data: Data) -> Raster? {
    guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
          CGImageSourceGetCount(source) == 1, CGImageSourceGetStatus(source) == .statusComplete,
          let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
          let width = properties[kCGImagePropertyPixelWidth] as? NSNumber,
          let height = properties[kCGImagePropertyPixelHeight] as? NSNumber else { return nil }
    let w = width.intValue, h = height.intValue
    guard w > 0, h > 0, w <= 30000, h <= 30000, w * h <= 64_000_000 else { return nil }
    let orientation = (properties[kCGImagePropertyOrientation] as? NSNumber)?.intValue ?? 1
    guard (1...8).contains(orientation), let image = CGImageSourceCreateImageAtIndex(source, 0, [kCGImageSourceShouldCache: false] as CFDictionary),
          image.width == w, image.height == h, let space = CGColorSpace(name: CGColorSpace.sRGB) else { return nil }
    var raw = [UInt8](repeating: 0, count: w * h * 4)
    let rendered = raw.withUnsafeMutableBytes { buffer -> Bool in
        guard let context = CGContext(data: buffer.baseAddress, width: w, height: h, bitsPerComponent: 8,
                                      bytesPerRow: w * 4, space: space,
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue) else { return false }
        context.setBlendMode(.copy)
        context.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
        return true
    }
    guard rendered else { return nil }
    if orientation == 1 { return Raster(width: w, height: h, orientation: 1, pixels: raw) }
    let swap = orientation >= 5, outW = swap ? h : w, outH = swap ? w : h
    var normalized = [UInt8](repeating: 0, count: raw.count)
    for y in 0..<h { for x in 0..<w {
        let dx: Int, dy: Int
        switch orientation {
        case 2: (dx, dy) = (w - 1 - x, y)
        case 3: (dx, dy) = (w - 1 - x, h - 1 - y)
        case 4: (dx, dy) = (x, h - 1 - y)
        case 5: (dx, dy) = (y, x)
        case 6: (dx, dy) = (h - 1 - y, x)
        case 7: (dx, dy) = (h - 1 - y, w - 1 - x)
        default: (dx, dy) = (y, w - 1 - x)
        }
        let input = (y * w + x) * 4, output = (dy * outW + dx) * 4
        for c in 0..<4 { normalized[output+c] = raw[input+c] }
    } }
    return Raster(width: outW, height: outH, orientation: orientation, pixels: normalized)
}
func failure(_ reason: String) -> [String: Any] { ["metadata": NSNull(), "reason": reason] }
func main() -> [String: Any] {
    // Read a bounded request even when a caller bypasses the Python wrapper.
    var input = Data()
    while input.count <= maxRequestBytes {
        guard let chunk = try? FileHandle.standardInput.read(upToCount: min(65536, maxRequestBytes + 1 - input.count)), !chunk.isEmpty else { break }
        input.append(chunk)
    }
    guard input.count <= maxRequestBytes,
          let request = (try? JSONSerialization.jsonObject(with: input)) as? [String: Any],
          let encoded = request["data"] as? String, encoded.utf8.count <= (maxInputBytes + 2) / 3 * 4,
          let data = Data(base64Encoded: encoded), data.count <= maxInputBytes, supportedPaste(data),
          let pasted = decode(data) else { return failure("invalid-image") }
    let args = Array(CommandLine.arguments.dropFirst())
    var candidates: [Data] = []
    var pasteboard: NSPasteboard?
    var changeCount: Int?
    if !args.isEmpty {
        guard args.count % 2 == 0, args.count <= 16 else { return failure("invalid-arguments") }
        for i in stride(from: 0, to: args.count, by: 2) {
            guard args[i] == "--candidate-file" else { return failure("invalid-arguments") }
            guard let file = FileHandle(forReadingAtPath: args[i+1]) else { return failure("invalid-candidate") }
            let candidate = try? file.read(upToCount: maxCandidateBytes + 1)
            try? file.close()
            guard let candidate, candidate.count <= maxCandidateBytes else { return failure("invalid-candidate") }
            candidates.append(candidate)
        }
    } else {
        let board = NSPasteboard.general
        pasteboard = board
        changeCount = board.changeCount
        guard let items = board.pasteboardItems, items.count == 1 else { return failure("ambiguous-clipboard") }
        // Read only these image representations; never enumerate file, URL or text data.
        for type in [NSPasteboard.PasteboardType.png, .tiff, NSPasteboard.PasteboardType("public.jpeg")] {
            if let candidate = items[0].data(forType: type) {
                guard candidate.count <= maxCandidateBytes else { return failure("invalid-candidate") }
                candidates.append(candidate)
            }
        }
        guard board.changeCount == changeCount else { return failure("clipboard-changed") }
    }
    var found: Resolution?
    var foundDefault = false
    for candidate in candidates {
        guard let raster = decode(candidate),
              raster.width == pasted.width, raster.height == pasted.height, raster.pixels == pasted.pixels else { continue }
        if var resolution = explicitResolution(candidate) {
            if raster.orientation >= 5 { resolution = Resolution(x: resolution.y, y: resolution.x) }
            if let previous = found, !same(previous, resolution) { return failure("ambiguous-resolution") }
            found = resolution
        } else if a4ScannerDefault(raster) {
            foundDefault = true
        }
    }
    if let board = pasteboard, board.changeCount != changeCount { return failure("clipboard-changed") }
    if let resolution = found {
        return ["metadata": ["dpiX": resolution.x, "dpiY": resolution.y, "orientation": 1, "source": "macos-clipboard"]]
    }
    guard foundDefault else { return failure("no-matching-resolution") }
    return ["metadata": ["dpiX": 100, "dpiY": 100, "orientation": 1,
                         "source": "macos-clipboard", "defaultDpi": true]]
}
let result = autoreleasepool { main() }
if let output = try? JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]) {
    FileHandle.standardOutput.write(output)
    FileHandle.standardOutput.write(Data([10]))
}
