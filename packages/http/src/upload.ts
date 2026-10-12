import { HidApiError } from './errors'

/** Short-lived object-storage URL returned by EHR's upload-intent command. */
export interface PresignedUpload {
  readonly method: 'PUT'
  readonly url: string
  readonly expiresInSeconds: number
  readonly requiredHeaders: Readonly<Record<string, string>>
}

export interface SignedStorageUrlOptions {
  /**
   * Accept plain http to this machine (localhost, 127.0.0.1, [::1]). Only a
   * local environment, whose object storage runs without TLS, passes true.
   */
  readonly allowLocalHttp?: boolean
  /** The refusal's code and user-facing message. */
  readonly code?: string
  readonly message?: string
}

const THIS_MACHINE = ['localhost', '127.0.0.1', '[::1]']

/**
 * A signed object-storage link the backend handed over, parsed, or a refusal:
 * https only, with no user name or password, and plain http only to this
 * machine when the caller allows it. Anything else (javascript:, data:, blob:,
 * http to another host, a value that is not a URL) is never fetched or opened.
 */
export function assertSignedStorageUrl(value: string, options: SignedStorageUrlOptions = {}): URL {
  let url: URL | null
  try { url = new URL(value) } catch { url = null }
  const local = options.allowLocalHttp === true && url?.protocol === 'http:' && THIS_MACHINE.includes(url.hostname)
  if (!url || (url.protocol !== 'https:' && !local) || url.username || url.password) {
    throw new HidApiError(400, options.message ?? 'The storage link is invalid.', {
      code: options.code ?? 'INVALID_STORAGE_URL', retryable: false,
    })
  }
  return url
}

export interface PresignedUploadOptions {
  readonly url: string
  readonly body: Blob | ArrayBuffer
  readonly requiredHeaders: Readonly<Record<string, string>>
  /** See SignedStorageUrlOptions: true only in a local environment. */
  readonly allowLocalHttp?: boolean
  readonly signal?: AbortSignal
  readonly fetchImpl?: typeof fetch
}

/** Sends bytes directly to the exact signed storage URL, without HID cookies. */
export async function uploadPresignedObject(options: PresignedUploadOptions): Promise<void> {
  const url = assertSignedStorageUrl(options.url, {
    allowLocalHttp: options.allowLocalHttp, code: 'INVALID_UPLOAD_URL', message: 'The document upload link is invalid.',
  })

  let response: Response
  try {
    response = await (options.fetchImpl ?? globalThis.fetch)(url.toString(), {
      method: 'PUT',
      body: options.body,
      headers: new Headers(options.requiredHeaders),
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: options.signal,
    })
  } catch (cause) {
    if (options.signal?.aborted) throw new HidApiError(0, 'The upload was cancelled.', {
      code: 'REQUEST_CANCELLED', retryable: false, cause,
    })
    throw new HidApiError(0, 'The document could not be uploaded. Please try again.', {
      code: 'NETWORK_ERROR', retryable: false, cause,
    })
  }

  if (!response.ok) throw new HidApiError(response.status,
    'The document could not be uploaded. Please try again.', {
      code: 'UPLOAD_FAILED', retryable: false,
    })
}
