// GET /api/health — lightweight probe so the SPA can detect the API.
export default function handler(_req, res) {
  res.status(200).json({ ok: true, service: 'koro-api' })
}
