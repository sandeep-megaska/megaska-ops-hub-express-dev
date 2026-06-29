This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## OTP provider environment variables

Set these server-side variables in Vercel/Next.js runtime:

- `OTP_PROVIDER` (optional): `twilio`, `msg91`, or `mock`

Twilio config (required when using Twilio):
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_VERIFY_SERVICE_SID`

MSG91 config (required when using MSG91):
- `MSG91_AUTH_KEY`
- `MSG91_TEMPLATE_ID`

Provider selection behavior:
- If `OTP_PROVIDER` is explicitly set and configured, that provider is used.
- If `OTP_PROVIDER` is explicitly set but missing required config, the API logs a warning and falls back.
- If `OTP_PROVIDER` is not set, fallback order is: `twilio` -> `msg91` -> `mock`.

Never expose OTP provider secrets as `NEXT_PUBLIC_*`.

## WhatsApp provider environment variables

The WhatsApp provider foundation uses Meta WhatsApp Cloud API and keeps credentials server-side only.

Provider:
- `META_CLOUD_API`

Meta Cloud API config:
- `WHATSAPP_META_ACCESS_TOKEN`
- `WHATSAPP_META_PHONE_NUMBER_ID`
- `WHATSAPP_META_BUSINESS_ACCOUNT_ID`
- `WHATSAPP_META_WEBHOOK_VERIFY_TOKEN`
- `WHATSAPP_META_GRAPH_VERSION` (optional; defaults to `v20.0`)

Never expose WhatsApp provider secrets as `NEXT_PUBLIC_*`.
