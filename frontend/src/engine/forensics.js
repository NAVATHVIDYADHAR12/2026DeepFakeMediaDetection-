/**
 * Browser-side forensic analysis.
 *
 * These are the same three checks the Python backend runs, reimplemented with
 * canvas and DataView so they work on a static deployment with no server.
 * They are genuinely computed from the file's bytes — nothing here is sampled,
 * simulated or filled in.
 *
 * What is NOT here is the neural verdict: that needs the trained classifiers,
 * which are ~50 MB of ONNX and only exist once the training notebook has run.
 * The report is explicit about that rather than guessing a score.
 */

/* ------------------------------------------------------------------ EXIF -- */

const EXIF_TAGS = {
  0x010f: 'Make',
  0x0110: 'Model',
  0x0131: 'Software',
  0x0132: 'DateTime',
  0x9003: 'DateTimeOriginal',
  0xa434: 'LensModel',
  0x829a: 'ExposureTime',
  0x829d: 'FNumber',
  0x8827: 'ISOSpeedRatings',
  0x920a: 'FocalLength',
  0x8825: 'GPSInfo',
  0x013b: 'Artist',
  0x8298: 'Copyright',
}

/**
 * Minimal EXIF reader for JPEG.
 *
 * Walks the JPEG segment markers to find APP1/Exif, then reads the TIFF IFD
 * inside it. Only the tags the report displays are decoded — a full EXIF
 * parser would be a dependency for no extra value here.
 */
export function readExif(buffer) {
  const out = {
    has_exif: false,
    metadata_stripped: true,
    camera_make: null,
    camera_model: null,
    software: null,
    datetime: null,
    has_gps: false,
    fields: {},
  }

  const view = new DataView(buffer)
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return out  // not JPEG

  let offset = 2
  let exifStart = -1

  // Walk segments looking for APP1 with an "Exif\0\0" header.
  while (offset < view.byteLength - 4) {
    if (view.getUint8(offset) !== 0xff) break
    const marker = view.getUint8(offset + 1)
    const size = view.getUint16(offset + 2)

    if (marker === 0xe1 && view.getUint32(offset + 4) === 0x45786966) {
      exifStart = offset + 10
      break
    }
    if (marker === 0xda) break        // start of scan; no metadata beyond here
    offset += 2 + size
  }
  if (exifStart < 0 || exifStart + 8 > view.byteLength) return out

  // TIFF header: byte order, then the offset of the first IFD.
  const little = view.getUint16(exifStart) === 0x4949
  const firstIFD = view.getUint32(exifStart + 4, little)

  const readIFD = (ifdOffset, depth = 0) => {
    const base = exifStart + ifdOffset
    if (depth > 2 || base + 2 > view.byteLength) return

    const count = view.getUint16(base, little)
    for (let i = 0; i < count; i++) {
      const entry = base + 2 + i * 12
      if (entry + 12 > view.byteLength) return

      const tag = view.getUint16(entry, little)
      const type = view.getUint16(entry + 2, little)
      const num = view.getUint32(entry + 4, little)

      // The EXIF sub-IFD holds most of the interesting capture tags.
      if (tag === 0x8769) {
        readIFD(view.getUint32(entry + 8, little), depth + 1)
        continue
      }
      if (tag === 0x8825) { out.has_gps = true; continue }

      const name = EXIF_TAGS[tag]
      if (!name) continue

      try {
        if (type === 2) {                     // ASCII
          const strOffset = num > 4 ? exifStart + view.getUint32(entry + 8, little) : entry + 8
          let s = ''
          for (let c = 0; c < num - 1 && strOffset + c < view.byteLength; c++) {
            s += String.fromCharCode(view.getUint8(strOffset + c))
          }
          if (s.trim()) out.fields[name] = s.trim()
        } else if (type === 3) {              // SHORT
          out.fields[name] = String(view.getUint16(entry + 8, little))
        } else if (type === 5) {              // RATIONAL
          const r = exifStart + view.getUint32(entry + 8, little)
          if (r + 8 <= view.byteLength) {
            const n = view.getUint32(r, little)
            const d = view.getUint32(r + 4, little)
            if (d) out.fields[name] = `${(n / d).toFixed(4)}`
          }
        }
      } catch {
        // A malformed tag should not abort the whole read.
      }
    }
  }

  readIFD(firstIFD)

  out.has_exif = Object.keys(out.fields).length > 0 || out.has_gps
  out.camera_make = out.fields.Make ?? null
  out.camera_model = out.fields.Model ?? null
  out.software = out.fields.Software ?? null
  out.datetime = out.fields.DateTimeOriginal ?? out.fields.DateTime ?? null
  out.metadata_stripped = !(out.camera_make || out.datetime)

  return out
}

/* ------------------------------------------------------------------ C2PA -- */

/**
 * Look for an embedded C2PA / Content Credentials manifest.
 *
 * Presence check only — exactly like the backend. Verifying the signature
 * chain against a trust list is a different and much larger job, and the
 * report says so rather than implying the credential was validated.
 */
export function checkC2PA(buffer) {
  const bytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 2_000_000))

  // Decode as latin1 so byte values map 1:1 to characters and the markers can
  // be found with a plain string search.
  let text = ''
  const CHUNK = 32768
  for (let i = 0; i < bytes.length; i += CHUNK) {
    text += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
  }
  const lowered = text.toLowerCase()

  const markers = ['c2pa', 'jumbf', 'contentauth'].filter((m) => lowered.includes(m))
  const found = markers.length > 0

  return {
    signature_found: found,
    markers,
    status: found ? 'PRESENT' : 'NOT_FOUND',
    note: found
      ? 'A provenance manifest is embedded. Cryptographic validation against a trust list is not performed.'
      : 'No content credential found. Most cameras and editors do not yet write one, so this is not evidence of manipulation.',
  }
}

/* ------------------------------------------------------------------- ELA -- */

/**
 * Error Level Analysis.
 *
 * Re-encodes the image at a known JPEG quality and measures how far each
 * region moves. Untouched areas sit near their compression fixed point and
 * barely change; regions that were pasted or generated have a different
 * compression history and move further. Block-level spread flags the
 * difference.
 *
 * Weak on PNGs and on heavily re-compressed images — reported, not hidden.
 */
export async function errorLevelAnalysis(bitmap, quality = 0.92) {
  const w = Math.min(bitmap.width, 1024)
  const h = Math.round(bitmap.height * (w / bitmap.width))

  const draw = (source) => {
    const c = document.createElement('canvas')
    c.width = w; c.height = h
    c.getContext('2d', { willReadFrequently: true }).drawImage(source, 0, 0, w, h)
    return c
  }

  const original = draw(bitmap)

  // Round-trip through JPEG at a known quality.
  const blob = await new Promise((r) => original.toBlob(r, 'image/jpeg', quality))
  if (!blob) return { error: 'canvas encoding unavailable' }
  const resaved = draw(await createImageBitmap(blob))

  const a = original.getContext('2d').getImageData(0, 0, w, h).data
  const b = resaved.getContext('2d').getImageData(0, 0, w, h).data

  const diff = new Float32Array(w * h)
  let peak = 0
  for (let i = 0, p = 0; i < a.length; i += 4, p++) {
    const d = (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3
    diff[p] = d
    if (d > peak) peak = d
  }
  if (peak === 0) peak = 1

  let sum = 0, sumSq = 0
  for (let i = 0; i < diff.length; i++) {
    const v = diff[i] / peak
    diff[i] = v
    sum += v
    sumSq += v * v
  }
  const mean = sum / diff.length
  const std = Math.sqrt(Math.max(0, sumSq / diff.length - mean * mean))

  // Split into an 8x8 grid; a splice shows up as a few hot tiles rather than
  // a uniform lift across the frame.
  const bw = Math.max(1, Math.floor(w / 8))
  const bh = Math.max(1, Math.floor(h / 8))
  const blocks = []
  for (let by = 0; by + bh <= h; by += bh) {
    for (let bx = 0; bx + bw <= w; bx += bw) {
      let acc = 0
      for (let y = by; y < by + bh; y++) {
        for (let x = bx; x < bx + bw; x++) acc += diff[y * w + x]
      }
      blocks.push(acc / (bw * bh))
    }
  }
  const bMean = blocks.reduce((s, v) => s + v, 0) / (blocks.length || 1)
  const blockSpread = Math.sqrt(
    blocks.reduce((s, v) => s + (v - bMean) ** 2, 0) / (blocks.length || 1)
  )

  const suspicious = blockSpread > 0.055

  return {
    mean_error: Number(mean.toFixed(5)),
    std_error: Number(std.toFixed(5)),
    block_spread: Number(blockSpread.toFixed(5)),
    suspicious_regions: suspicious,
    note: suspicious
      ? 'Uneven compression response across the frame, consistent with a spliced or edited region.'
      : 'Compression response is uniform across the frame.',
  }
}
