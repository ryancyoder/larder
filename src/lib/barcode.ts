/**
 * Barcode scanning with two engines.
 *
 * `BarcodeDetector` is native, fast and free of a bundle cost — Chrome and
 * Android have it. Safari and Firefox don't, so those fall back to ZXing, which
 * is lazy-loaded on first scan rather than shipped in the main bundle.
 */

const PRODUCT_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf']

interface DetectedBarcode {
  rawValue: string
  format: string
}

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>
}

type BarcodeDetectorCtor = {
  new (options?: { formats?: string[] }): BarcodeDetectorLike
  getSupportedFormats?: () => Promise<string[]>
}

function nativeDetector(): BarcodeDetectorCtor | undefined {
  return (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
}

export class ScanError extends Error {
  constructor(message: string, readonly kind: 'permission' | 'no-camera' | 'insecure' | 'unsupported' | 'unknown') {
    super(message)
  }
}

export interface ScannerHandle {
  stop(): void
  /** Which engine ended up running — surfaced in the UI for troubleshooting. */
  engine: 'native' | 'zxing'
}

function toScanError(err: unknown): ScanError {
  const name = (err as { name?: string })?.name
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new ScanError('Camera access was denied. Allow it in your browser settings and try again.', 'permission')
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return new ScanError('No camera found on this device.', 'no-camera')
  }
  return new ScanError('The camera could not be started.', 'unknown')
}

async function openCamera(): Promise<MediaStream> {
  if (!window.isSecureContext) {
    throw new ScanError('Camera access needs a secure connection (https, or localhost).', 'insecure')
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new ScanError('This browser cannot open the camera.', 'unsupported')
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    })
  } catch (err) {
    throw toScanError(err)
  }
}

/**
 * Starts scanning into `video`. Calls `onResult` once with the first barcode
 * seen twice in a row — a cheap guard against a misread on a blurry frame.
 */
export async function startScanner(
  video: HTMLVideoElement,
  onResult: (code: string) => void,
): Promise<ScannerHandle> {
  let stopped = false
  let lastSeen: string | null = null

  const accept = (code: string) => {
    if (stopped) return
    const clean = code.trim()
    if (!clean) return
    // Require the same value on two consecutive reads before trusting it.
    if (clean !== lastSeen) {
      lastSeen = clean
      return
    }
    stopped = true
    onResult(clean)
  }

  const Detector = nativeDetector()

  if (Detector) {
    const stream = await openCamera()
    video.srcObject = stream
    video.setAttribute('playsinline', 'true')
    await video.play().catch(() => undefined)

    const supported = (await Detector.getSupportedFormats?.()) ?? PRODUCT_FORMATS
    const formats = PRODUCT_FORMATS.filter((f) => supported.includes(f))
    const detector = new Detector({ formats: formats.length ? formats : undefined })

    let frame = 0
    const tick = async () => {
      if (stopped) return
      try {
        const found = await detector.detect(video)
        if (found.length) accept(found[0].rawValue)
      } catch {
        // A transient decode failure on one frame is normal; keep going.
      }
      if (!stopped) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

    return {
      engine: 'native',
      stop() {
        stopped = true
        cancelAnimationFrame(frame)
        stream.getTracks().forEach((t) => t.stop())
        video.srcObject = null
      },
    }
  }

  // Safari / Firefox: pull ZXing in on demand so it stays out of the main bundle.
  const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
    import('@zxing/browser'),
    import('@zxing/library'),
  ])

  const hints = new Map()
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E, BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.ITF,
  ])

  const reader = new BrowserMultiFormatReader(hints)
  let controls: { stop: () => void } | undefined
  try {
    controls = await reader.decodeFromConstraints(
      { video: { facingMode: { ideal: 'environment' } }, audio: false },
      video,
      (result) => { if (result) accept(result.getText()) },
    )
  } catch (err) {
    throw toScanError(err)
  }

  return {
    engine: 'zxing',
    stop() {
      stopped = true
      controls?.stop()
    },
  }
}

/** The formats worth looking for on groceries, in both engines' vocabularies. */
async function zxingHints() {
  const { BarcodeFormat, DecodeHintType } = await import('@zxing/library')
  const hints = new Map()
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E, BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.ITF,
  ])
  // Real packaging is curved, creased and badly lit. Worth the extra passes.
  hints.set(DecodeHintType.TRY_HARDER, true)
  return hints
}

function plausible(value: string): boolean {
  return /^\d{8,14}$/.test(value)
}

/**
 * One attempt at framing the photo: how much of it to look at, and which way up.
 *
 * Whole frame first, then tighter centre crops — a photo of a jar is mostly jar,
 * and cropping in gives the decoder a barcode that fills more of the frame.
 *
 * Each framing is tried twice, upright and turned a quarter turn. The 1D
 * decoders read horizontal scan lines, so a barcode running down the side of an
 * upright can is invisible to them until the picture is rotated. Photographing
 * a tin standing on the counter produces exactly that, so it is not an edge
 * case worth skipping.
 */
const PASSES: Array<{ crop: number; turn: boolean }> = [
  { crop: 1, turn: false },
  { crop: 1, turn: true },
  { crop: 0.55, turn: false },
  { crop: 0.55, turn: true },
  { crop: 0.32, turn: false },
  { crop: 0.32, turn: true },
]

/**
 * A phone photo is around 4000px wide and decoding one at full size takes
 * seconds — thirty of those is a coffee break. Barcode bars survive downscaling
 * to roughly this far better than the wait survives a batch import, and the
 * tighter crops hand the resolution back where it matters.
 */
const MAX_EDGE = 1600

/** Renders one framing of the photo onto a canvas for a decoder to read. */
function renderPass(bitmap: ImageBitmap, { crop, turn }: { crop: number; turn: boolean }): HTMLCanvasElement {
  const sw = bitmap.width * crop
  const sh = bitmap.height * crop
  const sx = (bitmap.width - sw) / 2
  const sy = (bitmap.height - sh) / 2

  const scale = Math.min(1, MAX_EDGE / Math.max(sw, sh))
  const dw = Math.max(1, Math.round(sw * scale))
  const dh = Math.max(1, Math.round(sh * scale))

  const canvas = document.createElement('canvas')
  canvas.width = turn ? dh : dw
  canvas.height = turn ? dw : dh

  const ctx = canvas.getContext('2d')
  if (ctx) {
    if (turn) {
      ctx.translate(canvas.width, 0)
      ctx.rotate(Math.PI / 2)
    }
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, dw, dh)
  }
  return canvas
}

/**
 * Reads a barcode out of a still photo.
 *
 * Worth trying before anything cleverer: it runs on the device, costs nothing,
 * sends nothing anywhere, and when it works the answer is exact rather than a
 * guess at what the packet says.
 *
 * Both engines are used, for the same reason the live scanner uses both —
 * Safari has no BarcodeDetector at all, and an iPad is the likeliest thing to
 * be photographing a counter full of shopping. Getting this wrong meant the
 * feature reported "no barcode found" on every photo without ever looking.
 *
 * Returns undefined rather than throwing: a photo of an apple has no barcode,
 * and that is an ordinary outcome rather than a failure.
 */
export async function readBarcodeFromImage(source: Blob): Promise<string | undefined> {
  let bitmap: ImageBitmap | undefined
  try {
    // A photo off an iPhone is usually stored landscape with an EXIF flag
    // saying which way up it really is. Honour it, or every upright picture
    // arrives on its side and the framing below rotates the wrong way.
    bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' })
      .catch(() => createImageBitmap(source))
  } catch {
    return undefined
  }

  try {
    const Detector = nativeDetector()
    if (Detector) {
      const detector = new Detector({ formats: PRODUCT_FORMATS })
      for (const pass of PASSES) {
        try {
          const found = await detector.detect(renderPass(bitmap, pass))
          const value = found.map((b) => b.rawValue).filter(plausible)
            .sort((a, b) => b.length - a.length)[0]
          if (value) return value
        } catch {
          // Try the next framing rather than giving up on the photo.
        }
      }
    }

    // Safari and Firefox land here, as does anything the native pass missed.
    const { BrowserMultiFormatReader } = await import('@zxing/browser')
    const reader = new BrowserMultiFormatReader(await zxingHints())
    for (const pass of PASSES) {
      try {
        const value = reader.decodeFromCanvas(renderPass(bitmap, pass))?.getText?.()
        if (value && plausible(value)) return value
      } catch {
        // ZXing throws NotFoundException when there is simply no code here.
      }
    }
    return undefined
  } finally {
    bitmap?.close()
  }
}

export function scanningAvailable(): boolean {
  return Boolean(window.isSecureContext && navigator.mediaDevices?.getUserMedia)
}
