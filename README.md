# 智晟｜綻放

「智晟｜綻放」以「路老師似顏繪」為核心體驗，是一套以 Next.js 與
OpenAI Image API 打造的相機到手機 AI 水彩人像服務。

## Experience

1. The booth opens the device camera and captures a square portrait.
2. The server creates a private, unguessable session that expires after 15 minutes.
3. The booth displays a QR code for the session.
4. Opening the QR link triggers one image-edit request.
5. The generated portrait appears on both the phone and booth screens.

The OpenAI key and image prompt are only read in server code. They are never
included in the browser bundle.

## Local setup

Copy the example environment file:

```bash
cp .env.example .env.local
```

Then set at least:

```dotenv
OPENAI_API_KEY=your_api_key
OPENAI_IMAGE_SYSTEM_PROMPT="Your image transformation instructions"
```

The remaining values in `.env.example` provide sensible defaults for model,
quality, output size, and the QR base URL.

Start the app:

```bash
npm run dev
```

Open [http://localhost:3059](http://localhost:3059).

## Testing QR codes on another device

A phone cannot reach `localhost` on the booth computer. Either:

- open the booth using the computer's LAN address, such as
  `http://192.168.1.20:3059`; or
- set `APP_BASE_URL` to an HTTPS tunnel or deployed application URL.

Camera access generally requires HTTPS, except on `localhost`. For physical
device testing, an HTTPS URL is recommended.

## Storage and deployment

The current implementation stores source and generated images under
`.data/sessions` on the local filesystem. This is suitable for local development
and a single persistent Node.js host.

Before a serverless or multi-instance production deployment, replace the
filesystem session layer with shared object storage and a shared database or
key-value store. Keep the session ID, 15-minute expiry, and server-only OpenAI
request boundaries unchanged.

## Validation

```bash
npm run lint
npx tsc --noEmit
npm run build
```
