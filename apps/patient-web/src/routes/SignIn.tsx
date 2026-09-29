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
    <main className="patient-auth-page">
      <section className="patient-auth-content" aria-labelledby="sign-in-title">
        <p className="patient-eyebrow">Health ID</p>
        <h1 id="sign-in-title" className="patient-page-title">
          Sign in
        </h1>
        <p className="patient-page-copy">
          Patient sign-in connects to the existing Health ID authentication architecture. That
          integration is pending confirmation of the provider boundary at the Gateway.
        </p>
      </section>
    </main>
  )
}
