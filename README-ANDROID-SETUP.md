# SAYROX 19.11.13 — راه‌اندازی از طریق گوشی اندروید

این بسته، Deploy Kit ریشه مخزن GitHub است و پروژه SAYROX 19.11.13 را از ZIP استخراج می‌کند. روی گوشی نیازی به ترمینال یا Node.js نیست.

## فایل‌های ریشه مخزن

این پنج فایل باید در ریشه مخزن `SAYROX` باشند:

1. `SAYROX-19.11.13-WORKER.zip`
2. `package.json`
3. `deploy.mjs`
4. `wrangler.jsonc`
5. `README-ANDROID-SETUP.md`

در این نسخه، `deploy.mjs` جایگزین نسخه قبلی می‌شود. ZIP داخلی پروژه همان نسخه 19.11.13 است و فایل‌های داخل آن بی‌دلیل تغییر داده نشده‌اند.

## Workers Builds

- Production branch: `main`
- Root directory: `/`
- Build command: `npm install --no-audit --no-fund && npm run build`
- Deploy command: `env -u WRANGLER_CI_OVERRIDE_NAME -u WRANGLER_CI_MATCH_TAG npm run deploy`
- Preview builds: خاموش تا زمان تأیید انتشار اصلی
- Build variable: `SAYROX_APP_ORIGIN` با Origin دقیق Worker اصلی، برای نمونه `https://sayrox.SUBDOMAIN.workers.dev`؛ بدون اسلش انتهایی. مقدار واقعی را از Overview همان Worker کپی کن.

هیچ API Key یا Secret نباید در ZIP، GitHub یا فایل‌های این بسته قرار بگیرد.

## ترتیب امن Build و Deploy

Build ابتدا ZIP را با کنترل مسیرها استخراج می‌کند، وابستگی‌ها را نصب می‌کند، Worker و SDK صوتی را می‌سازد، بررسی سایت را اجرا می‌کند و سپس تست‌های پروژه را اجرا می‌کند. فقط پس از موفقیت همه این مراحل، Exportهای سازگاری دو Durable Object قدیمی به Worker اصلی اضافه و رسید Build ثبت می‌شود.

در Deploy، مقدار `SAYROX_APP_ORIGIN` به `tasks-worker/wrangler.jsonc` منتقل و اعتبارسنجی می‌شود. سپس هر پنج پیکربندی و ورودی‌هایشان بررسی می‌شوند و برای هر پنج Worker یک `wrangler deploy --dry-run` انجام می‌شود. فقط اگر تمام Dry Runها موفق باشند، انتشار واقعی به این ترتیب شروع می‌شود:

1. `sayrox-auth-storage`
2. `sayrox-billing-storage`
3. `sayrox-usage-storage`
4. `sayrox-tasks-storage`
5. `sayrox`

**نکته مهم فنی:** انتشار Workerها عمداً با `npm exec -- wrangler deploy` انجام می‌شود، نه `npm run deploy:<worker>`. دستورهای `npm run` به‌طور خودکار Hookهای `predeploy:*` را اجرا می‌کنند. در این پروژه بعضی از آن Hookها دوباره تست/Build را بعد از اضافه‌شدن Exportهای سازگاری اجرا می‌کردند؛ همان چیزی که باعث شکست Deploy می‌شد. تست‌ها یک بار در Build، پیش از تغییر سازگاری، اجرا و موفقیتشان ثبت می‌شود. چک اختصاصی Scheduler هم جداگانه و قبل از اولین انتشار اجرا می‌شود.

هیچ Durable Object Namespace یا Binding موجودی حذف یا Rename نمی‌شود. این بسته D1 binding یا D1 migration اضافه نمی‌کند؛ ذخیره‌سازی داده‌ها از SQLite داخلی Durable Objects استفاده می‌کند.

## Secrets و تأیید پس از انتشار

Secretها را فقط در تنظیمات Cloudflare Worker ثبت کن:

- Worker `sayrox`: `GAPGPT_API_KEY`، `AUTH_SESSION_SECRET` و `TASKS_INTERNAL_SECRET`
- Worker `sayrox-tasks-storage`: همان `TASKS_INTERNAL_SECRET`
- اختیاری در `sayrox`: `TAVILY_API_KEY` و `ELEVENLABS_API_KEY`

پرداخت واقعی خاموش می‌ماند (`PAYMENTS_ENABLED=false`) تا اتصال و Callback زرین‌پال جداگانه آزمایش شوند. سبز شدن Deploy به‌تنهایی اثبات‌کننده کارکرد زنده API گپ، Secretها، ثبت‌نام، ورود، حافظه و زمان‌بندی نیست؛ پس از انتشار باید Smoke Test انجام شود.
