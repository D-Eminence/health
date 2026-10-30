import { Workspace } from '../parts/Workspace'

/** A whole sample workspace (list, `new`, `:recordId`). Placeholder until the sample engine is built. */
export function SampleWorkspace({ id }: { id: string }) {
  return <Workspace path={id} sample><SampleList id={id} /></Workspace>
}

/** A sample workspace's list card (search and table), for use inside another workspace. Placeholder. */
export function SampleList(_props: { id: string }) {
  return null
}

/** A sample workspace's create page. Placeholder. */
export function SampleCreate(_props: { id: string }) {
  return null
}

/** A sample workspace's record page. Placeholder. */
export function SampleDetail(_props: { id: string }) {
  return null
}
