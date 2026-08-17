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

/**
 * Reads a barcode out of a still photo.
 *
 * Worth trying before anything cleverer: it runs on the device, costs nothing,
 * sends nothing anywhere, and when it works the answer is exact rather than a
 * guess at what the packet says. Most of a shopping trip is barcoded.
 *
 * Returns undefined rather than throwing — a photo of an apple has no barcode,
 * and that is an ordinary outcome, not a failure.
 */
export async function readBarcodeFromImage(source: Blob): Promise<string | undefined> {
  const Detector = nativeDetector()
  if (!Detector) return undefined

  let bitmap: ImageBitmap | undefined
  try {
    bitmap = await createImageBitmap(source)
    const detector = new Detector()
    const found = await detector.detect(bitmap)
    // Longest wins: a stray short code is more likely a misread of packaging
    // than a real EAN sitting next to one.
    return found
      .map((b) => b.rawValue)
      .filter((v) => /^\d{8,14}$/.test(v))
      .sort((a, b) => b.length - a.length)[0]
  } catch {
    return undefined
  } finally {
    bitmap?.close()
  }
}

export function scanningAvailable(): boolean {
  return Boolean(window.isSecureContext && navigator.mediaDevices?.getUserMedia)
}
