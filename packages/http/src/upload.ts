import { HidApiError } from './errors'

/** Short-lived object-storage URL returned by EHR's upload-intent command. */
export interface PresignedUpload {
  readonly method: 'PUT'
  readonly url: string
  readonly expiresInSeconds: number
  readonly requiredHeaders: Readonly<Record<string, string>>
}

export interface PresignedUploadOptions {
  readonly url: string
  readonly body: Blob | ArrayBuffer
  readonly requiredHeaders: Readonly<Record<string, string>>
  readonly signal?: AbortSignal
  readonly fetchImpl?: typeof fetch
}

/** Sends bytes directly to the exact signed storage URL, without HID cookies. */
export async function uploadPresignedObject(options: PresignedUploadOptions): Promise<void> {
  const url = new URL(options.url)
  const local = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !local) || url.username || url.password) {
    throw new HidApiError(400, 'The document upload link is invalid.', {
      code: 'INVALID_UPLOAD_URL', retryable: false,
    })
  }

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
