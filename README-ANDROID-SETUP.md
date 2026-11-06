# SAYROX 19.11.15 — راه‌اندازی امن از طریق GitHub و Cloudflare

این Deploy Kit پنج فایل ریشهٔ مخزن GitHub را فراهم می‌کند. از گوشی اندروید هم می‌توان آن را در GitHub بارگذاری کرد؛ برای ساخت و انتشار، Cloudflare Workers Builds از Node و Wrangler استفاده می‌کند.

## فایل‌های ریشهٔ مخزن

محتوای این بسته باید جایگزین فایل‌های Deploy Kit قبلی در ریشهٔ مخزن `SAYROX` شود:

1. `SAYROX-19.11.15-WORKER.zip` — سورس کامل پروژه و خروجی‌های تولیدشدهٔ رابط/Worker
2. `package.json` — وابستگی‌ها و فرمان‌های Deploy Kit
3. `deploy.mjs` — استخراج امن، نصب، Build، تست، بررسی Dry Run و انتشار مرحله‌ای
4. `wrangler.jsonc` — ورودی Worker اصلی و Static Assets
5. `README-ANDROID-SETUP.md` — همین راهنما

ZIP قدیمی `SAYROX-19.11.14-WORKER.zip` را از ریشهٔ مخزن حذف کن تا فقط نسخهٔ جدید مبنای Build باشد. هیچ Secret یا فایل `.env` را در مخزن قرار نده.

## Workers Builds

در Cloudflare → Workers & Pages → Worker `sayrox` → Builds، تنظیمات Production را این‌گونه نگه دار:

- Branch: `main`
- Root directory: `/`
- Build command: `npm install --no-audit --no-fund && npm run build`
- Deploy command: `env -u WRANGLER_CI_OVERRIDE_NAME -u WRANGLER_CI_MATCH_TAG npm run deploy`
- Build variable: `SAYROX_APP_ORIGIN` = Origin واقعی Worker اصلی، مانند `https://sayrox.SUBDOMAIN.workers.dev` بدون اسلش انتهایی
- Preview builds: تا تأیید انتشار Production خاموش بمانند

Origin را از Overview همان Worker بردار؛ مقدار نمونه را عیناً کپی نکن.

## Build و Deploy چه چیزی را بررسی می‌کند؟

Build ابتدا ZIP را با کنترل مسیرها استخراج می‌کند، وابستگی‌ها را نصب می‌کند، `site/src/app.js` و `site/_worker.js` را از سورس تولید می‌کند، SDK صوتی ElevenLabs را در مسیر same-origin می‌سازد، بررسی صحت assetها را انجام می‌دهد و سپس تست‌ها را اجرا می‌کند. در سورس این نسخه، مجموعهٔ تست‌ها **۱۴۱ آزمون** دارد و در محیط بررسی این بسته ۱۴۱ مورد موفق و صفر شکست ثبت شد. اگر ساخت SDK صوتی، بررسی سایت یا هر تستی شکست بخورد، رسید موفقیت ساخته نمی‌شود و Deploy متوقف می‌ماند.

پس از موفقیت تست‌ها، Deploy Kit سازگاری کلاس‌های Durable Object قدیمی را حفظ می‌کند، Origin زمان‌بندی را اعتبارسنجی می‌کند، هر پنج Worker را ابتدا با `--dry-run` می‌سنجد و فقط پس از موفقیت همهٔ Dry Runها آن‌ها را به ترتیب زیر منتشر می‌کند:

1. `sayrox-auth-storage`
2. `sayrox-billing-storage`
3. `sayrox-usage-storage`
4. `sayrox-tasks-storage`
5. `sayrox`

هیچ Namespace یا Binding موجودی حذف یا Rename نمی‌شود. هیچ D1، binding دیتابیس D1 یا migration مربوط به D1 در پروژه تعریف نشده است؛ داده‌های سرویس‌ها در SQLite داخلی Durable Objects نگهداری می‌شوند.

## Secrets و Variables

مقدار کلیدها را در چت، ZIP یا GitHub وارد نکن. فقط در Cloudflare Worker ثبت کن:

- Worker `sayrox`: Secret به نام `GAPGPT_API_KEY`
- Worker `sayrox`: Variable به نام `GAPGPT_DEFAULT_MODEL` با شناسهٔ دقیق مدلی که در حساب GapGPT فعال است
- Worker `sayrox`: Secretهای `AUTH_SESSION_SECRET` و `TASKS_INTERNAL_SECRET`
- Worker `sayrox-tasks-storage`: همان مقدار `TASKS_INTERNAL_SECRET`
- اختیاری در `sayrox`: `TAVILY_API_KEY` و `ELEVENLABS_API_KEY`

`AI_PROVIDER=gapgpt` و `GAPGPT_BASE_URL` در تنظیمات پروژه هستند. OpenRouter Provider اصلی چت نیست و در این پروژه برای گفتگو استفاده نمی‌شود؛ تنظیمات تصویری اختیاری از مسیر مستقل خود باقی مانده‌اند.

## قابلیت‌های رابط نسخه 19.11.15

- صفحهٔ ورود با هویت اختصاصی SAYROX و نشان حرف S؛ ورود/ثبت‌نام ایمیلی و حالت محلی از مسیرهای موجود استفاده می‌کنند. ورود Google تا زمان راه‌اندازی OAuth نمایش داده نمی‌شود.
- تنظیمات عمومی برای نام نمایشی محلی، بازخورد لمسی، سبک پاسخ، پاسخ سریع و جست‌وجوی وب.
- صفحات امنیت، حریم خصوصی، تاریخچه و فضای ذخیره‌سازی با وضعیت واقعی قابلیت‌ها؛ Passkey، MFA، PIN گفتگو، قفل زیستی و مدیریت نشست‌های چنددستگاهی تا زمان آماده‌شدن backend غیرفعال نشان داده می‌شوند.
- آمار مصرف Storage مرورگر، Local Storage، کتابخانهٔ فایل و گالری تصویر؛ حذف گالری تصویر فقط داده‌های تصویری محلی را پاک می‌کند.
- فضای نوشتار پیام بزرگ‌تر و مناسب‌تر برای موبایل.

## بررسی بعد از Deploy

سبزشدن Build و Deploy به‌تنهایی تأییدکنندهٔ کارکرد زندهٔ GapGPT یا ورود نیست. پس از انتشار، این موارد را جداگانه بررسی کن:

1. `/api/health` باید احراز هویت را آماده گزارش کند.
2. با حساب آزمایشی، ثبت‌نام، خروج و ورود مجدد را انجام بده.
3. پس از تنظیم `GAPGPT_API_KEY` و مدل معتبر، یک پیام آزمایشی بفرست و پاسخ واقعی دریافت کن.
4. ابتدا از حالت محلی و حساب آزمایشی استفاده کن؛ پرداخت واقعی عمداً خاموش باقی می‌ماند تا Callback زرین‌پال جداگانه آزموده شود.

هیچ تست محلی نمی‌تواند جای تست زنده با Secretها و سرویس Provider واقعی را بگیرد. در این بسته، صدور پرداخت واقعی فعال نمی‌شود و هیچ Secret جدیدی ساخته یا در ZIP ذخیره نشده است.
