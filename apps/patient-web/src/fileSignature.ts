/**
 * What a photo or file the patient adds must start with ("Add a record", BACKEND-NEEDS.md §1): the leading bytes of the
 * type it says it is. A JPEG starts FF D8 FF, a PNG with its 8-byte signature (89 50 4E 47 0D 0A 1A 0A), a PDF with
 * "%PDF-" (25 50 44 46 2D). The drawer reads a file's first 8 bytes before it is listed and refuses it, sending nothing,
 * when they are not its type's ("This file isn't a JPEG, PNG or PDF."): a program or anything else renamed scan.png is
 * never listed, so never sent. The upload checks the bytes it sends again (api.uploadOwnRecordDocument), and the server
 * checks the stored object's leading bytes at the confirm. A JPEG or PNG is then walked to take out its metadata
 * (photoMetadata.ts), which refuses one that can't be walked cleanly.
 *
 * Pure apart from fileStartsAsItsType, which reads only those 8 bytes of the file; nothing here keeps or sends anything.
 */

export type SignedFileType = 'image/jpeg' | 'image/png' | 'application/pdf'

/** Each type's leading bytes. */
export const FILE_SIGNATURES: Readonly<Record<SignedFileType, readonly number[]>> = {
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'application/pdf': [0x25, 0x50, 0x44, 0x46, 0x2d],
}

/** How many bytes are read from a file's start to tell its type by: the longest signature's. */
export const SIGNATURE_BYTES = 8

const isSignedFileType = (value: string): value is SignedFileType => Object.hasOwn(FILE_SIGNATURES, value)

/**
 * Whether `head` (a file's first bytes, or all of them) starts with the leading bytes of `mediaType`. False for a type
 * that is not a JPEG, PNG or PDF, and for bytes too few to hold the signature.
 */
export function startsAsType(head: Uint8Array, mediaType: string): boolean {
  if (!isSignedFileType(mediaType)) return false
  const signature = FILE_SIGNATURES[mediaType]
  return head.length >= signature.length && signature.every((byte, index) => head[index] === byte)
}

/** Whether `file`'s first 8 bytes start as the type it says it is (`file.type`): only those bytes are read. */
export async function fileStartsAsItsType(file: File): Promise<boolean> {
  return startsAsType(new Uint8Array(await file.slice(0, SIGNATURE_BYTES).arrayBuffer()), file.type)
}
