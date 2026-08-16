/**
 * On-device background removal.
 *
 * Runs BiRefNet-lite (MIT) through transformers.js — WebGPU where the browser
 * has it, WASM otherwise. The photo never leaves the device; only the model
 * comes down, once, from the Hugging Face CDN.
 *
 * The whole module is dynamically imported so neither transformers.js nor the
 * ONNX runtime touches the main bundle. Nothing here loads until someone taps
 * "Cut out background".
 */

/** MIT-licensed. The 512×512 lite build is the smallest permissive option. */
const MODEL_ID = 'studioludens/birefnet-lite-512'

/** Roughly what the fp16 weights cost, for the confirmation prompt. */
export const MODEL_DOWNLOAD_MB = 94

export type CutoutStage = 'downloading' | 'loading' | 'running'

export interface CutoutProgress {
  stage: CutoutStage
  /** 0–1 while weights download; undefined once it's compute-bound. */
  ratio?: number
}

export class CutoutError extends Error {}

export function webgpuAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator
}

// The model is expensive to construct, so it's built once and reused for the
// rest of the session. transformers.js caches the weights in Cache Storage, so
// later sessions skip the download.
type Loaded = { model: unknown; processor: unknown }
let loaded: Loaded | null = null
let loading: Promise<Loaded> | null = null

async function getModel(onProgress?: (p: CutoutProgress) => void): Promise<Loaded> {
  if (loaded) return loaded
  if (loading) return loading

  loading = (async () => {
    const { AutoModel, AutoProcessor } = await import('@huggingface/transformers')

    const device = webgpuAvailable() ? 'webgpu' : 'wasm'
    const progress_callback = (event: { status?: string; progress?: number }) => {
      if (event.status === 'progress' && typeof event.progress === 'number') {
        onProgress?.({ stage: 'downloading', ratio: Math.max(0, Math.min(1, event.progress / 100)) })
      } else if (event.status === 'ready' || event.status === 'done') {
        onProgress?.({ stage: 'loading' })
      }
    }

    try {
      const [model, processor] = await Promise.all([
        // fp16 halves the download. On WASM it may be unsupported, which is
        // caught below rather than silently pulling the 183MB fp32 build.
        AutoModel.from_pretrained(MODEL_ID, { dtype: 'fp16', device, progress_callback } as never),
        AutoProcessor.from_pretrained(MODEL_ID, { progress_callback } as never),
      ])
      loaded = { model, processor }
      return loaded
    } catch (err) {
      throw new CutoutError(
        device === 'wasm'
          ? "This browser couldn't load the cutout model. Safari and Chrome on a recent device handle it best."
          : `The cutout model failed to load. ${(err as Error)?.message ?? ''}`.trim(),
      )
    } finally {
      loading = null
    }
  })()

  return loading
}

/** True once the weights are in Cache Storage, so the next run is instant. */
export async function modelIsCached(): Promise<boolean> {
  if (loaded) return true
  if (typeof caches === 'undefined') return false
  try {
    for (const name of await caches.keys()) {
      const cache = await caches.open(name)
      const keys = await cache.keys()
      if (keys.some((r) => r.url.includes(MODEL_ID) && r.url.endsWith('.onnx'))) return true
    }
  } catch {
    // Cache inspection is best-effort; a false negative only re-prompts.
  }
  return false
}

export async function clearModelCache(): Promise<void> {
  loaded = null
  if (typeof caches === 'undefined') return
  for (const name of await caches.keys()) {
    const cache = await caches.open(name)
    for (const request of await cache.keys()) {
      if (request.url.includes(MODEL_ID)) await cache.delete(request)
    }
  }
}

/**
 * Returns a WebP with a transparent background, or throws CutoutError.
 *
 * WebP rather than PNG: same alpha channel at a fraction of the size, and
 * everything that can run this model can also decode WebP. A 1200px PNG cutout
 * runs 300KB–1MB; the WebP equivalent is closer to 60–150KB, which matters when
 * every photo lives in IndexedDB under iOS's eviction rules.
 */
export async function removeBackground(
  source: Blob,
  onProgress?: (p: CutoutProgress) => void,
): Promise<Blob> {
  const { model, processor } = await getModel(onProgress)
  onProgress?.({ stage: 'running' })

  const { RawImage } = await import('@huggingface/transformers')

  const image = await RawImage.fromBlob(source)
  const { pixel_values } = await (processor as (i: unknown) => Promise<{ pixel_values: unknown }>)(image)
  const { output_image } = await (model as (i: unknown) => Promise<{ output_image: never }>)({
    input_image: pixel_values,
  })

  // The model emits a single-channel alpha matte at its own resolution; scale
  // it back up to the source before compositing.
  const mask = await RawImage.fromTensor(
    (output_image as unknown as Array<{ sigmoid(): { mul(n: number): { to(t: string): unknown } } }>)[0]
      .sigmoid()
      .mul(255)
      .to('uint8') as never,
  ).resize(image.width, image.height)

  return composite(source, mask.data as Uint8Array, image.width, image.height)
}

/** Paints the source image, then writes the matte into its alpha channel. */
async function composite(source: Blob, maskData: Uint8Array, width: number, height: number): Promise<Blob> {
  const bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' })
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new CutoutError('Canvas is unavailable in this browser.')

  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const frame = ctx.getImageData(0, 0, width, height)
  const pixels = frame.data
  // The matte is one byte per pixel; RGBA is four, with alpha last.
  for (let i = 0, p = 3; i < maskData.length; i++, p += 4) {
    pixels[p] = maskData[i]
  }
  ctx.putImageData(frame, 0, 0)

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/webp', 0.9),
  )
  if (!blob) throw new CutoutError('Could not encode the cutout.')
  return blob
}
