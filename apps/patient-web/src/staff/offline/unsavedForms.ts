/**
 * Which staff forms hold unsaved edits, for the shell's "Update now" gate (A7, A9): updating reloads the tab, and a
 * form in progress would be lost. A form counts from the first edit typed into it until it is reset (each form resets
 * after a save it made) or leaves the page. A form that keeps its text after a save stays counted until the person
 * leaves it: the gate errs towards waiting.
 */
const dirty = new Set<HTMLFormElement>()

function formOf(target: EventTarget | null): HTMLFormElement | null {
  return target instanceof HTMLElement ? target.closest('form') : null
}

/** Starts watching edits under `root`; returns the stop. */
export function trackUnsavedForms(root: Document | HTMLElement = document): () => void {
  const edited = (event: Event) => { const form = formOf(event.target); if (form) dirty.add(form) }
  const reset = (event: Event) => { if (event.target instanceof HTMLFormElement) dirty.delete(event.target) }
  root.addEventListener('input', edited, true)
  root.addEventListener('change', edited, true)
  root.addEventListener('reset', reset, true)
  return () => {
    root.removeEventListener('input', edited, true)
    root.removeEventListener('change', edited, true)
    root.removeEventListener('reset', reset, true)
    dirty.clear()
  }
}

/** Whether any form still on the page has unsaved edits. */
export function anyUnsavedForms(): boolean {
  for (const form of dirty) if (!form.isConnected) dirty.delete(form)
  return dirty.size > 0
}
