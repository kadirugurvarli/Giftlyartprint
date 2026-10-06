# Giftly Content Studio

Private content operations dashboard for Giftly Art Print.

## v0.1 scope
- Content dashboard
- Platform labels
- Website Recent Work toggle
- Prompt-based edit workflow shell
- Schedule / publish confirmation workflow
- Responsive, square-corner UI (no border radius)
- Environment-variable placeholders for Google Drive, Shopify, Metricool and AI

## Security
Do not commit real API keys or access tokens. Use deployment environment variables.

## Next integration steps
1. Deploy privately on Vercel.
2. Add authentication.
3. Connect Google Drive upload/source folder and Content Tracker.
4. Connect AI image-edit endpoint.
5. Connect Metricool for Instagram/Facebook scheduling and publishing.
6. Connect Shopify Recent Work publishing.
7. Add audit log and publish history.

## Local development
```bash
npm install
npm run dev
```
Open http://localhost:3000
