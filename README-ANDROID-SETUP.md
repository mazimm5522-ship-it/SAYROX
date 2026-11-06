# راه‌اندازی SAYROX از طریق گوشی اندروید

این بسته برای راه‌اندازی مستقل SAYROX در یک اکانت تازه Cloudflare و انتشار Worker اصلی با نام `sayrox` از طریق Cloudflare Workers Builds آماده شده است. Workerهای ذخیره‌سازی موردنیاز نیز با نام‌های جدید SAYROX ساخته می‌شوند و به هیچ Worker اکانت قبلی وابسته نیستند. هیچ دستور ترمینال یا Node.js روی گوشی لازم نیست.

## فایل‌های این بسته

این پنج فایل باید در ریشهٔ مخزن GitHub با نام `SAYROX` قرار بگیرند. چون مخزن شما Public است، قبل از هر Commit مطمئن شو هیچ Secret، API Key، Token، فایل `.env` یا اطلاعات شخصی در آن وجود ندارد؛ کلیدها فقط در تنظیمات Cloudflare Worker ثبت می‌شوند:

1. `SAYROX-19.11.13-WORKER.zip`
2. `package.json`
3. `deploy.mjs`
4. `wrangler.jsonc`
5. `README-ANDROID-SETUP.md`

## تنظیمات Cloudflare Workers Builds

پس از آپلود پنج فایل در ریشه مخزن GitHub و اتصال مخزن به Worker جدید `sayrox` از مسیر **Settings → Builds → Connect**، این مقادیر را وارد کن:

- Production branch: `main`
- Root directory: خالی / ریشهٔ مخزن
- Build command:
  `npm install --no-audit --no-fund && npm run build`
- Deploy command:
  `npm run deploy`
- Preview command: خالی یا غیرفعال تا قبل از تأیید انتشار اصلی
- Build environment variable با نام `SAYROX_APP_ORIGIN` و مقدار Origin دقیق Worker جدید؛ نمونه شکل مقدار: `https://sayrox.SUBDOMAIN.workers.dev` (بدون اسلش انتهایی). این مقدار را از صفحه Overview همان Worker کپی کن؛ `SUBDOMAIN` را حدس نزن.

Cloudflare باید دسترسی ساخت/انتشار Worker را با Build token خودش ایجاد کند. هیچ API Token را در مخزن یا ZIP قرار نده.

## ترتیب انتشار

اسکریپت اول ZIP را با کنترل مسیرها استخراج می‌کند، وابستگی‌های پروژه را نصب می‌کند، تست‌ها را اجرا می‌کند و سپس Build کامل شامل SDK صوتی را انجام می‌دهد. فقط اگر تمام مراحل Build موفق شوند، مرحلهٔ Deploy اجرا می‌شود.

ترتیب Deploy خودکار و مخصوص اکانت تازه است:

1. ساخت Worker جدید `sayrox-auth-storage` برای حساب‌ها، نشست‌ها و محدودیت تلاش ورود.
2. ساخت Worker جدید `sayrox-billing-storage` برای دفتر سفارش‌ها و اشتراک‌ها.
3. ساخت Worker جدید `sayrox-usage-storage` برای سهمیه، تاریخچه Agent و تأیید عملیات.
4. ساخت Worker جدید `sayrox-tasks-storage` برای زمان‌بندی؛ آدرس Worker اصلی از متغیر `SAYROX_APP_ORIGIN` تزریق می‌شود.
5. انتشار Worker اصلی `sayrox` همراه فایل‌های Static Assets.

هیچ‌کدام از این Workerها به اکانت قبلی یا Workerهای قدیمی وابسته نیستند. این بسته هیچ D1 binding یا D1 migration تعریف نمی‌کند؛ ذخیره‌سازی Durable Object با SQLite داخلی خودش انجام می‌شود. پرداخت واقعی خاموش می‌ماند.

## مواردی که بعد از اولین انتشار باید تأیید شوند

- `GAPGPT_API_KEY` و `GAPGPT_DEFAULT_MODEL` باید در تنظیمات Worker اصلی `sayrox` ثبت شوند. مقدار Secret را هرگز در GitHub، ZIP یا گفت‌وگو قرار نده.
- `AUTH_SESSION_SECRET` باید یک Secret تصادفی پایدار در Worker اصلی باشد؛ آن را در انتشارهای بعدی بی‌دلیل عوض نکن، چون نشست‌های کاربران را باطل می‌کند.
- `TASKS_INTERNAL_SECRET` باید یک مقدار تصادفی حداقل ۳۲ نویسه‌ای و یکسان در دو Worker `sayrox` و `sayrox-tasks-storage` باشد.
- `TAVILY_API_KEY` و `ELEVENLABS_API_KEY` اختیاری‌اند؛ بدون آن‌ها جست‌وجوی زنده و صدای زنده آمادهٔ استفاده نخواهند بود.
- پیش از فعال‌کردن پرداخت واقعی، اتصال و Callback زرین‌پال باید جداگانه آزمایش شود. `PAYMENTS_ENABLED=false` باقی می‌ماند.

## مهم

این بسته کد را منتشر می‌کند، اما تا وقتی Secretهای واقعی ثبت و آزمون زندهٔ Provider انجام نشده‌اند، نباید SAYROX را آمادهٔ عرضهٔ عمومی دانست. ساخت حساب‌ها و ذخیره‌سازی از صفر انجام می‌شود؛ هیچ داده‌ای از اکانت قبلی منتقل نمی‌شود.
Cloudflare Workers Builds connection check.
