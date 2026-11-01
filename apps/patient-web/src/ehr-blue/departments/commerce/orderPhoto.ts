import { useCallback, useEffect, useRef, useState } from 'react'
import { commerce, ORDER_PHOTO_MAX_BYTES } from './api'
import { NOT_SWITCHED_ON } from './NotSwitchedOn'

/** The photo, as uploaded: shown from memory (`preview`, an object URL) and sent as its `fileId`. */
export interface UploadedPhoto { readonly preview: string; readonly fileId: string }

export const PHOTO_UPLOAD_FAILED = 'Couldn’t upload the photo. Try again.'

/**
 * One photo for an order or a price-list item (POINT_OF_CARE_SPEC §4: POST /api/v1/files/order-photos → { fileId }),
 * uploaded the moment it is chosen. A failure is said then, next to the control, and nothing is kept. The preview is an
 * object URL held in memory only, let go when the photo is replaced, removed or the screen closes.
 */
export function useOrderPhotoUpload(facilityId: string | null) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const round = useRef(0)
  const previews = useRef(new Set<string>())
  useEffect(() => {
    const held = previews.current
    return () => { round.current += 1; held.forEach(URL.revokeObjectURL); held.clear() }
  }, [])

  /** Uploads `file`; answers the uploaded photo, or null once the reason is said in `error`. */
  const upload = useCallback(async (file: File): Promise<UploadedPhoto | null> => {
    const mine = ++round.current
    setError(null)
    if (!file.type.startsWith('image/')) { setError('Choose a photo (an image file).'); return null }
    if (file.size > ORDER_PHOTO_MAX_BYTES) { setError('The photo is over 10 MB. Choose a smaller one.'); return null }
    if (!facilityId) { setError(PHOTO_UPLOAD_FAILED); return null }
    setUploading(true)
    let failure: string | null = PHOTO_UPLOAD_FAILED
    let fileId: string | null = null
    try {
      const result = await commerce.uploadOrderPhoto(facilityId, file)
      if (result.ok && result.data.fileId) { fileId = result.data.fileId; failure = null }
      else if (!result.ok && result.notAvailable) failure = NOT_SWITCHED_ON
    } catch { failure = PHOTO_UPLOAD_FAILED }
    if (mine !== round.current) return null
    setUploading(false)
    if (failure || !fileId) { setError(failure ?? PHOTO_UPLOAD_FAILED); return null }
    const preview = URL.createObjectURL(file)
    previews.current.add(preview)
    return { preview, fileId }
  }, [facilityId])

  /** Lets a photo's preview go (Remove, or a new one chosen). */
  const release = useCallback((photo: UploadedPhoto | null) => {
    if (!photo) return
    URL.revokeObjectURL(photo.preview)
    previews.current.delete(photo.preview)
  }, [])

  const clearError = useCallback(() => setError(null), [])
  return { upload, uploading, error, release, clearError }
}

export type OrderPhotoUpload = ReturnType<typeof useOrderPhotoUpload>
