import { useLayoutEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { isHidApiError, plainErrorText } from '@hid/http'
import type { PatientApi, PatientProfile } from '../api'
import { useSession } from '../session'
import { useAnnounceProfileChange } from '../profileChange'
import { PHOTO_SIDE, PhotoProblem, base64Of, reencodePhoto } from '../photoImage'
import { usePatientResource } from './usePatientResource'
import { useActionFocus } from './actionFocus'

const noPhoto = async (): Promise<Blob | null> => null

/** The photo's bytes, or null for none (404 PHOTO_NOT_FOUND). */
function photoSource(api: PatientApi) {
  return async (signal?: AbortSignal): Promise<Blob | null> => {
    try { return await api.photo(signal) } catch (caught) {
      if (isHidApiError(caught) && caught.status === 404) return null
      throw caught
    }
  }
}

/** A blob: URL for `blob` while it is shown, revoked as it changes or the view goes (on sign-out among them). */
export function useObjectUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useLayoutEffect(() => {
    if (!blob || typeof URL.createObjectURL !== 'function') { setUrl(null); return }
    const made = URL.createObjectURL(blob)
    setUrl(made)
    return () => { URL.revokeObjectURL(made); setUrl(current => current === made ? null : current) }
  }, [blob])
  return url
}

/**
 * The patient's photo for a view, read only when the profile says there is one (hid-system 0094), kept in memory for
 * the account under one name so the header and the page share it. Null while there is none or it can't be read.
 */
export function usePatientPhoto(hasPhoto: boolean) {
  const { api } = useSession()
  const load = useMemo(() => photoSource(api), [api])
  const photo = usePatientResource<Blob | null>(hasPhoto ? load : noPhoto, hasPhoto ? 'photo' : 'no-photo')
  const url = useObjectUrl(hasPhoto && !photo.error ? photo.data : null)
  // A removed photo's bytes are dropped from memory at once, not only at sign-out.
  const forget = () => { if (hasPhoto) photo.replace(null) }
  return { url, reload: photo.reload, forget }
}

/** "AE" for Ada Example: the first letters of the first and last names, as hid-1.0's pill showed them. */
export function initialsOf(profile: Partial<Pick<PatientProfile, 'firstName' | 'lastName' | 'fullName'>> | null | undefined): string {
  const names = [profile?.firstName, profile?.lastName].filter((name): name is string => typeof name === 'string' && name.trim() !== '')
  const words = names.length > 0 ? names : (typeof profile?.fullName === 'string' ? profile.fullName.trim().split(/\s+/) : [])
  const first = words[0]?.[0] ?? ''
  const last = words.length > 1 ? words.at(-1)?.[0] ?? '' : ''
  return `${first}${last}`.toUpperCase()
}

/** The photo, or the initials on a tinted disc when there is none. `alt` names the photo where it stands alone. */
export function Avatar({ profile, url, size, alt = '' }: {
  profile: Partial<Pick<PatientProfile, 'firstName' | 'lastName' | 'fullName'>> | null | undefined
  url: string | null
  size: 'small' | 'medium' | 'large'
  alt?: string
}) {
  if (url) return <img className={`patient-avatar patient-avatar-${size}`} src={url} alt={alt} width={PHOTO_SIDE} height={PHOTO_SIDE} />
  return <span className={`patient-avatar patient-avatar-${size}`} aria-hidden="true">{initialsOf(profile)}</span>
}

const PHOTO_REFUSED = 'This picture can’t be used. Choose a JPEG or PNG photo.'

/**
 * The profile photo, at the top of Bio-data (hid-1.0 parity B3; as hid-1.0 had it, the avatar itself is the control):
 * selecting the picture opens the file picker for a JPEG or PNG, shown cropped to a square to save; Remove photo
 * removes it. The page draws the picture afresh, at most 256 x 256, and sends only that JPEG (photoImage.ts), so nothing
 * the file itself held, such as where it was taken, is uploaded. Shown only where Identity says whether there is a photo.
 */
export function ProfilePhotoControl({ profile, onChanged }: { profile: PatientProfile; onChanged: () => Promise<unknown> }) {
  const { api } = useSession()
  const hasPhoto = profile.hasPhoto === true
  const photo = usePatientPhoto(hasPhoto)
  const announce = useAnnounceProfileChange()
  const [prepared, setPrepared] = useState<Blob | null>(null)
  const preview = useObjectUrl(prepared)
  const [busy, setBusy] = useState<'preparing' | 'saving' | 'removing' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const chooser = useRef<HTMLInputElement>(null)
  const focusAfter = useActionFocus()

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // The same file can be chosen again after a refusal or Cancel.
    event.target.value = ''
    if (!file) return
    setBusy('preparing'); setError(null); setNotice(null); setPrepared(null)
    try {
      setPrepared(await reencodePhoto(file))
      focusAfter(() => document.getElementById('profile-photo-save'))
    } catch (cause) {
      setError(cause instanceof PhotoProblem ? cause.message : PHOTO_REFUSED)
      focusAfter(() => chooser.current)
    } finally { setBusy(null) }
  }
  const save = async () => {
    if (!prepared || busy) return
    setBusy('saving'); setError(null); setNotice(null)
    try {
      await api.savePhoto(await base64Of(prepared))
      setPrepared(null)
      setNotice('Your photo was saved.')
      await onChanged()
      void photo.reload()
      announce()
      focusAfter(() => chooser.current)
    } catch (cause) {
      setError(isHidApiError(cause) && cause.code === 'PHOTO_INVALID' ? PHOTO_REFUSED
        : plainErrorText(cause, 'Your photo could not be saved. Try again.'))
      focusAfter(() => document.getElementById('profile-photo-save'))
    } finally { setBusy(null) }
  }
  const cancel = () => { setPrepared(null); setError(null); focusAfter(() => chooser.current) }
  const remove = async () => {
    if (busy) return
    setBusy('removing'); setError(null); setNotice(null)
    try {
      await api.removePhoto()
      photo.forget()
      setNotice('Your photo was removed.')
      await onChanged()
      announce()
      focusAfter(() => chooser.current)
    } catch (cause) {
      setError(plainErrorText(cause, 'Your photo could not be removed. Try again.'))
      focusAfter(() => document.getElementById('profile-photo-remove'))
    } finally { setBusy(null) }
  }

  return <div className="patient-photo" aria-busy={busy !== null || undefined}>
    <div className="patient-photo-row">
      {/* The picture is the control: its label wraps the hidden file field, which takes focus and opens the picker.
          While a new photo waits to be saved it is the picture only, and Save takes focus. */}
      {prepared ? <Avatar profile={profile} url={photo.url} size="large" alt={photo.url ? 'Your photo' : ''} />
        : <label className="patient-photo-control">
          <Avatar profile={profile} url={photo.url} size="large" alt={photo.url ? 'Your photo' : ''} />
          <input ref={chooser} type="file" accept="image/jpeg,image/png" className="patient-visually-hidden" disabled={busy !== null}
            aria-label={hasPhoto ? 'Change profile photo' : 'Add profile photo'}
            aria-describedby={error ? 'profile-photo-hint profile-photo-error' : 'profile-photo-hint'} onChange={event => void choose(event)} />
        </label>}
      <div className="patient-photo-actions">
        <p id="profile-photo-hint" className="patient-field-hint">Select the picture to {hasPhoto ? 'change your photo' : 'add a photo'}: a
          JPEG or PNG, cropped to a square.</p>
        {hasPhoto && !prepared && <button id="profile-photo-remove" type="button" disabled={busy !== null}
          onClick={() => void remove()}>{busy === 'removing' ? 'Removing…' : 'Remove photo'}</button>}
      </div>
    </div>
    {error && <p id="profile-photo-error" role="alert" className="patient-inline-error">{error}</p>}
    <div role="status">{notice && <p className="patient-inline-success">{notice}</p>}{busy === 'preparing' && <p>Preparing your photo…</p>}</div>
    {/* Save is shown in the commit that asks for focus on it; only the preview waits for its blob: URL. */}
    {prepared && <div className="patient-photo-preview">
      {preview && <img src={preview} alt="Your new photo, cropped to a square" width={PHOTO_SIDE} height={PHOTO_SIDE} />}
      <div className="patient-decision-actions">
        <button id="profile-photo-save" type="button" className="patient-primary-button" disabled={busy !== null} onClick={() => void save()}>
          {busy === 'saving' ? 'Saving…' : 'Save photo'}</button>
        <button type="button" className="patient-secondary-button" disabled={busy !== null} onClick={cancel}>Cancel</button>
      </div>
    </div>}
  </div>
}
