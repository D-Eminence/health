/**
 * Sign-in screen.
 *
 * The form is deliberately not wired to a provider. Attaching one means
 * choosing an authentication architecture, and Health ID already has one — see
 * docs/OPEN-QUESTIONS.md, Q4. This renders the shape of the screen and the
 * boundary it will call through, and nothing more.
 */
export function SignIn() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-3 p-6">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="text-muted">
        Patient sign-in connects to the existing Health ID authentication architecture. That
        integration is pending confirmation of the provider boundary at the Gateway.
      </p>
    </main>
  )
}

