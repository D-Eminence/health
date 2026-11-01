import { HidApiError } from './errors'
import { PLAIN } from './plain'

/** What every failed upload says: nothing about links, storage or signing. */
const UPLOAD_FAILED = 'We couldn’t upload this document. Please try again.'

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
    throw new HidApiError(400, options.message ?? 'We couldn’t open this document. Please try again.', {
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

/**
 * The required headers, less any the signer already put in the link's query: the AWS SDK's presigner moves
 * x-amz-checksum-* and x-amz-meta-* there and signs them as query parameters. S3 refuses an x-amz-* header that the
 * signature does not cover, so sending one of those again as a header would fail the upload.
 */
function uploadHeaders(url: URL, requiredHeaders: Readonly<Record<string, string>>): Headers {
  const inQuery = new Set([...url.searchParams.keys()].map(name => name.toLowerCase()))
  const headers = new Headers()
  for (const [name, value] of Object.entries(requiredHeaders)) {
    if (!inQuery.has(name.toLowerCase())) headers.set(name, value)
  }
  return headers
}

/** Sends bytes directly to the exact signed storage URL, without HID cookies. */
export async function uploadPresignedObject(options: PresignedUploadOptions): Promise<void> {
  const url = assertSignedStorageUrl(options.url, {
    allowLocalHttp: options.allowLocalHttp, code: 'INVALID_UPLOAD_URL', message: UPLOAD_FAILED,
  })

  let response: Response
  try {
    response = await (options.fetchImpl ?? globalThis.fetch)(url.toString(), {
      method: 'PUT',
      body: options.body,
      headers: uploadHeaders(url, options.requiredHeaders),
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: options.signal,
    })
  } catch (cause) {
    if (options.signal?.aborted) throw new HidApiError(0, PLAIN.stopped, {
      code: 'REQUEST_CANCELLED', retryable: false, cause,
    })
    throw new HidApiError(0, UPLOAD_FAILED, {
      code: 'NETWORK_ERROR', retryable: false, cause,
    })
  }

  if (!response.ok) throw new HidApiError(response.status, UPLOAD_FAILED, {
      code: 'UPLOAD_FAILED', retryable: false,
    })
}
