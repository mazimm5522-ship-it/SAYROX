# SAYROX 19.11.36 — GitHub / Cloudflare Deploy Kit (Deploy hotfix)

این کیت پنج فایل ریشهٔ مخزن GitHub است. کل پنج فایل را هم‌زمان جایگزین کن؛ فایل‌های نسخه‌های قبلی را با این‌ها قاطی نکن.

## پنج فایل ریشهٔ مخزن

1. `SAYROX-19.11.36-WORKER.zip` — سورس کامل نسخهٔ 19.11.36
2. `package.json` — فرمان‌های Build/Deploy و نسخهٔ Node
3. `deploy.mjs` — استخراج امن، Build، تست، Dry Run و انتشار مرحله‌ای
4. `wrangler.jsonc` — پیکربندی منبع‌محور Worker اصلی، شامل Service Binding خصوصی Sandbox
5. `README-ANDROID-SETUP.md` — همین راهنما

## تنظیمات Workers Builds

- Root directory: `/`
- Build command: `npm install --no-audit --no-fund && npm run build`
- Deploy command: `env -u WRANGLER_CI_OVERRIDE_NAME -u WRANGLER_CI_MATCH_TAG npm run deploy`
- Node.js: نسخهٔ 22 یا جدیدتر (در `package.json` نیز enforce شده است)
- Build variable اجباری: `SAYROX_APP_ORIGIN`

`SAYROX_APP_ORIGIN` باید فقط Origin عمومی HTTPS Worker اصلی باشد؛ بدون path، query، fragment، credentials یا اسلش انتهایی. مقدار قبلی مستندشده در این پروژه `https://sayrox.mazimm5522.workers.dev` است؛ پیش از Build آن را با Hostname واقعی از داشبورد Cloudflare تطبیق بده. اسکریپت مقدار نمونه یا URL ناقص را رد می‌کند.

## نقص اتصال Sandbox که در 19.11.36 رفع شد

Worker اصلی از `env.CODE_SANDBOX.fetch()` استفاده می‌کرد، ولی Service Binding به Worker موجود `sayrox-code-sandbox-preview` در `wrangler.jsonc` اصلی ثبت نشده بود. اکنون این اتصال در فایل ریشه و ZIP داخلی یکسان ثبت شده است:

```json
"services": [
  { "binding": "CODE_SANDBOX", "service": "sayrox-code-sandbox-preview" }
]
```

Worker مقصد همچنان خصوصی (`workers_dev=false`) است. آن را در Dashboard دوباره دستی تعریف نکن؛ Wrangler منبع اصلی این Binding است.

## Secrets اجباری Sandbox

دو Secret زیر باید در دو Worker مجزا، با مقدار دقیقاً یکسان و حداقل ۳۲ نویسه ثبت شوند:

- Worker اصلی `sayrox`: `CODE_SANDBOX_INTERNAL_SECRET`
- Worker مقصد `sayrox-code-sandbox-preview`: `SAYROX_INTERNAL_SECRET`

این مقادیر را در GitHub، فایل ZIP، چت یا متغیرهای Text قرار نده؛ فقط از Cloudflare → Worker → Settings → Variables and Secrets به‌صورت Secret تنظیم کن. ثبت Binding به‌تنهایی برای فعال‌شدن اجرای Python کافی نیست؛ هر دو Secret لازم‌اند.

## رفتار Build و Deploy

1. `npm run build` سورس ZIP را استخراج، وابستگی‌ها را نصب، App/Worker/SDK صوتی را Build و تست‌ها را اجرا می‌کند.
2. پیش از Dry Run، Origin وظایف زمان‌بندی‌شده، Container schema، شش نام Worker، پنج Durable Object Binding و Service Binding Sandbox بررسی می‌شوند.
3. هر شش Worker ابتدا Dry Run می‌شوند؛ هیچ Deploy کامل آغاز نمی‌شود تا همهٔ Dry Runها موفق باشند.
4. در Deploy پیش‌فرض، Auth، Billing، Usage، Tasks و در آخر Worker اصلی منتشر می‌شوند؛ Python Sandbox موجود عمداً دوباره Deploy نمی‌شود، چون در 19.11.36 هیچ تغییری در Worker/DO/Container/Dockerfile آن وجود ندارد و فقط Service Binding در Worker اصلی اضافه شده است. Sandbox همچنان در کنترل‌های محلی Preflight بررسی می‌شود.
5. فقط وقتی کد Sandbox یا Dockerfile/image آن را واقعاً تغییر دادی، متغیر Build با نام `SAYROX_DEPLOY_SANDBOX` و مقدار `true` را اضافه کن تا Wrangler آن را هم Dry Run و Deploy کند. این مسیر به دسترسی/قابلیت فعال Containers در حساب Cloudflare نیاز دارد.

**محدودیت مهم Cloudflare Containers:** `wrangler deploy --dry-run` ساخت و Push نهایی Docker image را آزمایش نمی‌کند. هنگام Deploy کامل Container، Cloudflare Worker را قبل از تکمیل image فعال می‌کند و این دو مرحله تراکنشی نیستند. بنابراین اگر Sandbox در مرحلهٔ image build شکست بخورد، ممکن است کد Worker آن به‌روزرسانی شده باشد، ولی حلقهٔ Deploy Kit پیش از انتشار Worker اصلی متوقف می‌شود. پس از Deploy کامل، وضعیت image و اجرای Python را جداگانه Smoke Test کن.

## چرا Sandbox در Deploy پیش‌فرض رد می‌شود؟

در مقایسهٔ فایل‌های 19.11.35 و 19.11.36، محتوای `sandbox-worker/src`، Dockerfile، Container image definition، نام Worker، Durable Object class و تنظیمات SQLite تغییر نکرده‌اند؛ تنها مسیر `$schema` در فایل Sandbox اصلاح شده است. تغییر عملکردی این نسخه، افزودن `services: CODE_SANDBOX -> sayrox-code-sandbox-preview` در Worker اصلی است. بنابراین انتشار مجدد Container بدون تغییر واقعی، ریسک و تماس غیرضروری با API حساب Containers ایجاد می‌کرد. Worker اصلی به همان Sandbox موجود وصل می‌شود.

اگر Deploy خود Sandbox لازم شد و API درخواست `/accounts/<id>/containers/me` را رد کرد، متن کامل Wrangler error را بررسی کن. علت می‌تواند دسترسی API token به Containers یا entitlement/plan حساب باشد؛ از روی صرفِ URL نمی‌توان بین این موارد قطعیت داد. مجوزهای Cloudflare شامل `Containers Write` هستند. این Hotfix عمداً برای Deploy عادی، نیازی به تغییر پلن، Token یا Secret ایجاد نمی‌کند.

## کنترل پس از Deploy

- `https://<دامنه-واقعی-SAYROX>/api/health` را باز کن. `providers.codeSandbox` باید فقط در صورت وجود Binding و Secret سمت اصلی `true` باشد.
- با ابزار اجرای Python یک تست غیرحساس مثل `print(6 * 7)` اجرا کن؛ انتظار `42` است.
- اگر health مقدار `false` دارد، Secret سمت Worker اصلی یا Service Binding را بررسی کن. اگر health مقدار `true` دارد ولی اجرا 502 می‌دهد، Secret مقصد، Container image و لاگ Worker `sayrox-code-sandbox-preview` را بررسی کن.
- Deploy کامل/ساخت Image در این بسته از داخل این محیط انجام نشده است؛ سبز بودن تست محلی یا Dry Run به‌تنهایی موفقیت Runtime را ثابت نمی‌کند.

## Rollback

Worker اصلی را به آخرین نسخهٔ سالم برگردان. Namespace یا SQLite Durable Object Sandbox را حذف نکن. اگر کد Sandbox فعال شده ولی image مشکل دارد، تا زمان اصلاح image ابزار Python را فعال/سالم فرض نکن؛ Deploy Kit با ترتیب Sandbox قبل از Main، انتشار Main را در صورت شکست Sandbox متوقف می‌کند.

## اصلاحات نسخهٔ 19.11.35 — Cloudflare Container schema

- فیلد ناسازگار `max_instances` از Container با `scheduling_policy: "durable_object"` حذف شد؛ Preflight اختصاصی، بازگشت این فیلد را پیش از Wrangler رد می‌کند.
- سیاست زمان‌بندی، Worker، Durable Object، SQLite، named image و Dockerfile موجود حفظ شدند.
- این نسخه جایگزین راهنمای Deploy نسخهٔ 19.11.35 است؛ تنظیم Binding Sandbox در نسخهٔ 19.11.36 در Wrangler ثبت می‌شود و در Dashboard دوباره ساخته نمی‌شود.

## اصلاحات نسخهٔ 19.11.34 — Pre-Deploy Stabilization (Update 15)

- Service Worker فقط پاسخ `200 text/html` را به‌عنوان App Shell آفلاین ذخیره می‌کند؛ صفحهٔ خطا یا پاسخ غیر HTML نمی‌تواند نسخهٔ سالم cache را خراب کند و عملیات نوشتن Cache در طول عمر Fetch Event کامل می‌شود.
- Asset verifier دیگر کل پوشهٔ `/vendor/` را معاف نمی‌کند؛ فقط `elevenlabs-client.mjs` اختیاری، آن هم در `verify:dev`، می‌تواند غایب باشد.
- Deploy preflight دقیقاً یک `APP_ORIGIN` canonical از نوع HTTPS می‌پذیرد و whitespace، پورت غیر canonical، query، path، fragment، credentials و مقادیر تکراری را رد می‌کند.
- `fflate` در این Deploy Kit از `0.8.2` به `0.8.3` برای رفع CVE-2026-45820 ارتقا یافت؛ `esbuild` در سورس داخلی از `0.24.2` به `0.28.2` ارتقا یافت. Wrangler با pin دقیق `4.158.0` حفظ شد.
- تست پایهٔ سورس نسخهٔ قبل ۲۱۴/۲۱۴ بود؛ نسخهٔ 19.11.34 تست‌های رگرسیون Cache آفلاین، Asset policy، Origin و dependency baseline را اضافه می‌کند. SDK صوتی و Deploy واقعی در محیط ساخت هنوز نیازمند تأیید هستند.
- هیچ Worker، Agent، Provider، API، Tool Loop، Durable Object، Binding، Secret، جدول، migration یا D1 جدیدی اضافه نشده است.
- جزئیات و شواهد امنیتی در `docs/RELEASE-19.11.34.md` و `docs/DEPENDENCY-SECURITY.md` داخل ZIP سورس است.

## اصلاحات نسخهٔ 19.11.31 — Stream Reliability & Bounded SSE (Update 12)

- Reader مشترک SSE پاسخ را فقط پس از `[DONE]` یا `finish_reason` غیرتهی کامل می‌داند؛ قطع اتصال بدون علامت پایان به‌عنوان پاسخ ناقص اعلام می‌شود.
- سقف جریان ورودی ۱۴ میلیون نویسه، سقف هر event برابر ۱۰ میلیون نویسه و سقف متن پاسخ برابر ۵۰۰ هزار نویسه است.
- UTF-8 خراب و JSON نامعتبر رد می‌شوند؛ BOM و CRLF چندبخشی میان chunkها پشتیبانی می‌شوند.
- تست نهایی آن انتشار: **۲۰۵/۲۰۵ موفق**. SDK محلی ElevenLabs در محیط ساخت حاضر نبود؛ Live Voice بدون SDK ساخته‌شده فعال نمی‌شود.
- هیچ Worker، Agent، Tool Loop، Durable Object، Binding، Secret، جدول، migration یا D1 جدیدی اضافه نشد؛ Deploy واقعی/Provider Smoke Test انجام نشده بود.
- جزئیات و Rollback در `docs/RELEASE-19.11.31.md` و `docs/ROLLBACK.md` داخل ZIP سورس قرار دارد.

## اصلاحات نسخهٔ 19.11.30 — Security Hardening & Release Hygiene (Update 11)

- RPC داخلی Worker حساب با سقف ۱۶ KiB، کنترل اندازهٔ واقعی stream، Content-Type، UTF-8 سخت‌گیرانه و رد JSON نامعتبر محافظت شده است.
- Workerهای Auth، Billing، Usage، Tasks و Sandbox با `workers_dev: false` فقط از Bindingهای داخلی مصرف می‌شوند؛ Deploy preflight نیز این شرط را کنترل می‌کند.
- هیچ Worker/DO/Namespace/Binding/Secret/جدول/migration یا D1 جدیدی ساخته نشده است.
- تست کامل محلی: **۲۰۰/۲۰۰ موفق**؛ `build:app` و `build:worker` موفق؛ `verify:dev` نیز باید پیش از Build انتشار اجرا شود. SDK صوتی ElevenLabs هنوز خروجی build است.
- Cloudflare Deploy واقعی و آزمون Provider زنده در این محیط انجام نشده است.
- جزئیات فنی و rollback در `docs/RELEASE-19.11.30.md` و `docs/ROLLBACK.md` داخل ZIP سورس آمده است.

## اصلاحات نسخهٔ 19.11.29 — Multi-gateway Iranian AI (Update 10)

- درگاه‌های AvalAI و Hooshgar به همان Provider Registry، مسیر Chat Completions، SSE و Tool Loop موجود متصل شدند؛ Worker/Agent/DO یا دیتابیس موازی ایجاد نشده است.
- کاتالوگ مدل‌ها از endpoint واقعی هر درگاه و فقط با Secret سروری دریافت می‌شود. شناسه‌های مشابه بین درگاه‌ها namespace مستقل دارند و Worker شناسهٔ خام مدل را برای Provider ارسال می‌کند.
- وضعیت GapGPT، AvalAI و Hooshgar در تنظیمات نمایش داده می‌شود؛ کلیدها در پاسخ سلامت/کاتالوگ افشا نمی‌شوند. Base URL سفارشی به HTTPS معتبر و بدون userinfo/query/fragment محدود است.
- تست کامل سورس: ۱۹۴/۱۹۴ موفق. `build:code` و `verify:dev` موفق شدند؛ SDK محلی ElevenLabs در بستهٔ ساخت حاضر نیست و Live Voice بدون آن فعال نخواهد شد. Deploy واقعی و آزمون زندهٔ Provider با کلیدهای حساب کاربر انجام نشده است.
- Secretهای اختیاری `AVALAI_API_KEY` و `HOOSHGAR_API_KEY` را فقط در Cloudflare Worker Secrets وارد کن. متغیرهای `AVALAI_DEFAULT_MODEL` و `HOOSHGAR_DEFAULT_MODEL` باید شناسهٔ معتبر حساب خودت باشند. `AI_PROVIDER` در تنظیمات Worker درگاه اصلی را تعیین می‌کند.
- جزئیات کامل در `docs/RELEASE-19.11.29.md` و `docs/MODEL-CATALOG-19.11.29.md` درون ZIP سورس قرار دارد.

## سابقهٔ نسخهٔ 19.11.28 — Agent Response Craft & Visual Quality (Update 8)

- راهنمای نگارش Provider موجود برای پاسخ طبیعی، دقیق، متناسب با نوع درخواست و بازبینی کیفیت پیش از ارسال تقویت شد.
- Markdown مشترک اکنون calloutهای معنایی، نشان‌های وضعیت درون‌خطی، فهرست‌های task/checklist و هم‌ترازی ستون‌های جدول را پشتیبانی می‌کند.
- Renderer و CSS موجود، وضعیت‌ها را با رنگ‌های معناییِ سازگار با تم روشن/تیره نمایش می‌دهند؛ جدول‌ها روی موبایل قابل پیمایش‌اند و پشتیبانی RTL، صفحه‌کلید، forced-colors و reduced-motion حفظ شده است.
- DOCX و HTML همچنان از Parser مشترک استفاده می‌کنند؛ متن‌های نشان وضعیت و callout با DOM امن و `textContent` نمایش داده می‌شوند. HTML ورودی اجرا نمی‌شود.
- رنگ badge یا نماد فقط نمایش است و هرگز مدرک موفقیت عملیات محسوب نمی‌شود. مدل از نشان وضعیت تنها برای نتیجه‌ای استفاده می‌کند که واقعاً تأیید شده باشد.
- آزمون محلی **۱۸۲/۱۸۲** موفق؛ `build:app`، `build:worker` و `verify:dev` برای ۶۲ فایل موفق شدند. آزمون بصری روی دستگاه واقعی/مرورگر Cloudflare و Deploy واقعی در این محیط انجام نشده است.
- هیچ موتور پاسخ، Renderer، UI library، Worker، Durable Object، Binding، Namespace، جدول، migration یا D1 جدیدی اضافه نشده است.

پنج فایل قدیمی Deploy Kit را از ریشهٔ مخزن حذف و این پنج فایل جدید را در ریشه بارگذاری کن. ZIP داخلی Worker را استخراج نکن؛ باید ZIP باقی بماند. هیچ فایل Secret، `.env` یا کلید API را در GitHub قرار نده.

## اصلاحات نسخهٔ 19.11.25 — Advanced Browser Intelligence (Update 6)

- Browser Run موجود اکنون نشست را فقط در همان حساب و گفتگوی غیرموقت reconnect می‌کند؛ شناسهٔ نشست و targetها با AES-GCM در جدول افزایشی `agent_browser_sessions` داخل SQLite همان `UsageAccountObject` فعلی نگهداری می‌شوند.
- lease اتمیک برای هر گفتگو از کنترل هم‌زمان جلوگیری می‌کند؛ هر حساب حداکثر ۱۰ رکورد نشست فعال دارد و رکوردهای منقضی هنگام رزرو پاک می‌شوند.
- allowlist میزبان در طول نشست ثابت می‌ماند؛ برای مقصد جدید باید نشست جدیدی با درخواست صریح ساخته شود. اقدام تغییردهنده پیش از dispatch وضعیت `inFlight` را پایدار می‌کند و نتیجهٔ نامشخص خودکار تکرار نمی‌شود.
- ابزار بستن نشست اضافه شد و conversation ID در Approval Ticket حفظ می‌شود تا تعامل تأییدشده به همان گفتگوی اصلی متصل بماند.
- برای rollout، ابتدا `usage-worker` موجود و سپس Worker اصلی را منتشر کن؛ `AUTH_SESSION_SECRET` باید در هر دو سرویس یکسان و پایدار باشد. ترتیب Deploy Kit همین وابستگی را رعایت می‌کند.
- نشست دائمی نیست: رکورد برنامه پس از ۱۵ دقیقه منقضی می‌شود و Browser Run `keepAlive` حداکثر ۲۰ دقیقه دارد. نشست زندهٔ Cloudflare در این محیط تست نشده و Deploy واقعی انجام نشده است.
- **۱۷۳/۱۷۳ تست محلی موفق**؛ Build رابط و Worker و `verify:dev` موفق شدند. SDK محلی ElevenLabs در محیط ساخت حاضر نیست؛ Live Voice تا ساخت SDK غیرفعال می‌ماند.
- هیچ D1، Worker، Durable Object class، Namespace، Binding یا Browser Engine موازی اضافه نشده است؛ فقط جدول افزایشی در SQLite داخلی DO موجود ایجاد می‌شود.

پنج فایل قدیمی Deploy Kit را از ریشهٔ مخزن حذف و این پنج فایل جدید را در ریشه بارگذاری کن. ZIP داخلی Worker را استخراج نکن؛ باید همان‌طور ZIP باقی بماند. هیچ فایل Secret، `.env` یا کلید API را در GitHub قرار نده. در Cloudflare هیچ Worker، Durable Object، Namespace، Migration یا Secret قدیمی را حذف نکن.

## تنظیم Workers Builds

در Cloudflare → Workers & Pages → Worker `sayrox` → Builds، تنظیمات Production را حفظ کن:

- Branch: `main`
- Root directory: `/`
- Build command: `npm install --no-audit --no-fund && npm run build`
- Deploy command: `env -u WRANGLER_CI_OVERRIDE_NAME -u WRANGLER_CI_MATCH_TAG npm run deploy`
- Build variable: `SAYROX_APP_ORIGIN` = `https://sayrox.mazimm5522.workers.dev`

Deploy Kit پیش از هرگونه انتشار، Origin و `workers_dev=false` سرویس‌های داخلی را اعتبارسنجی می‌کند، شش Worker موجود (از جمله Python Sandbox موجود) را Dry Run می‌کند و اگر تست، ساخت SDK صوتی، بررسی پیکربندی یا هر Dry Run شکست بخورد، انتشار را متوقف می‌کند.

## اصلاحات نسخهٔ 19.11.24 — Advanced File Intelligence (Update 5)

- پیوست DOCX/PPTX در همان Composer به Readerهای محلی موجود وصل شد؛ PDF اسکن‌شده فقط در صورت نبود متن از OCR فارسی/انگلیسی موجود استفاده می‌کند.
- ابزار `create_file` خروجی PPTX را با موتور محلی موجود می‌سازد.
- در صورت درخواست صریح و تأیید اجرای Python، حداکثر دو متن استخراج‌شدهٔ پیوست به Sandbox موجود منتقل می‌شود؛ باینری، ماکرو/VBA یا فرمول اجرایی ارسال نمی‌شود. Sandbox ورودی را مجدداً اعتبارسنجی و متن را با نام ثابت داخل فضای موقت همان Job می‌نویسد.
- Deploy Kit برای Dry Run و استقرار کد Sandbox موجود نیز به‌روز شده است؛ این Worker و کلاس/SQLite آن از قبل وجود دارند و نام آن‌ها تغییر نکرده است. Service Binding `CODE_SANDBOX` و Secretهای مشترک در Wrangler اضافه/تغییر نشده‌اند؛ این اتصال همچنان طبق تنظیمات قبلی Cloudflare و بخش Sandbox در راهنمای پروژه فعال می‌شود.
- تست محلی ۱۷۳/۱۷۳ موفق، Build رابط و Worker موفق؛ OCR و Cloudflare Container واقعی زنده در این محیط تأیید نشده‌اند. Deploy واقعی انجام نشده است.
- هیچ D1، Namespace، DO class، migration یا Binding جدیدی اضافه نشده است.

## اصلاحات نسخهٔ 19.11.23 — بازیابی امن اجرای Agent (Update 4)

- Tool Loop قبلی Checkpoint/Resume را فقط در مرزهای امن اجرا پشتیبانی می‌کند؛ موتور، Scheduler یا Registry موازی ساخته نشده است.
- Checkpoint با AES-GCM رمز می‌شود و در جدول افزایشی `agent_run_checkpoints` داخل SQLite همان `UsageAccountObject` موجود ذخیره می‌شود.
- قبل از شروع هر Handler، ذخیرهٔ پایدار `in_flight` اجباری است؛ اگر ذخیره نشود، ابزار اجرا نخواهد شد. پس از هر نتیجه، مرز امن بعدی ذخیره می‌شود.
- Resume از endpoint احرازشدهٔ `/api/agent/resume` و دکمهٔ تاریخچه انجام می‌شود؛ lease اتمیک از اجرای هم‌زمان جلوگیری می‌کند و Provider/model اصلی pin می‌شوند.
- قطع Worker هنگام Handler با `CHECKPOINT_UNSAFE` مسدود می‌ماند تا اثر جانبی دوباره اجرا نشود. چت موقت، streaming و درخواست تصویری checkpoint نمی‌شوند. TTL سی دقیقه، lease سه دقیقه و سقف plaintext برابر ۵۱۲ کیلوبایت است. اگر ابزار الزامی واقعاً فراخوانی شود ولی سرویسش شکست بخورد، خطای آن به مدل داده می‌شود تا نتیجهٔ محدود و صادقانه ارائه کند؛ Tool Loop بی‌دلیل retry اجباری نمی‌کند.
- برای Rollout، ابتدا `usage-worker` موجود و سپس Worker اصلی را منتشر کن. `AUTH_SESSION_SECRET` بین سرویس‌ها باید یکسان و پایدار بماند.
- هیچ D1، Binding، Worker، Namespace، Durable Object class یا migration Cloudflare جدیدی اضافه نشده است؛ فقط یک جدول افزایشی در SQLite داخلی DO موجود ایجاد می‌شود.
- آزمون نهایی محلی ۱۷۰/۱۷۰ تست موفق شد؛ `build:app` و `build:worker` موفق شدند و `verify:dev` تعداد ۶۱ فایل را تأیید کرد. SDK محلی ElevenLabs ساخته نشده و Live Voice در این بسته غیرفعال می‌ماند. Deploy واقعی انجام نشده است و `APP_ORIGIN` در config هنوز نمونه است؛ پیش از انتشار باید مقدار دقیق HTTPS در Build variable `SAYROX_APP_ORIGIN` قرار گیرد.

## اصلاحات نسخهٔ 19.11.22 — مدیریت وظایف Agent (Update 3)

- Agent اکنون می‌تواند وظایف همان حساب را فهرست کند، pause/resume، اجرای فوری و ویرایش انجام دهد و با تأیید جداگانه وظیفه را حذف کند.
- به‌جای ساخت Scheduler یا موتور جدید، ابزارها به Tool Registry/Tool Loop، Approval Ticket و `TASKS_ACCOUNT` / `TaskAccountObject` موجود متصل شده‌اند.
- `updateTask` در همان Durable Object موجود، فیلدها را اعتبارسنجی و update را اتمیک می‌کند؛ اجرای فعال قفل تغییر/حذف را فعال می‌کند و اجرای فوری تکراری در صف deduplicate می‌شود.
- فهرست وظایف prompt خصوصی و متن کامل خروجی/خطای runها را افشا نمی‌کند. تغییرات با Ticket رمزنگاری‌شدهٔ یک‌بارمصرف و حذف با ریسک `delete` و تأیید جداگانه انجام می‌شود.
- ۱۶۷ تست محلی از ۱۶۷ تست موفق شدند. `build:app`، `build:worker`، کنترل همگامی و `verify:dev` موفق شدند. SDK صوت ElevenLabs در محیط محلی حاضر ساخته نشده و Live Voice تا ساخت آن غیرفعال می‌ماند.
- هیچ D1، Worker، Scheduler، Durable Object class، Namespace، Binding، جدول یا migration جدیدی اضافه نشده است. Deploy واقعی انجام نشده است.

## اصلاحات نسخهٔ 19.11.21 — تقویت هستهٔ Agent (Update 2)

- موتور، Runtime، Planner، Tool Loop و Tool Registry جدید ساخته نشده‌اند؛ همان مسیر اجرای Agent قبلی تقویت شده است.
- Provider Schema هر ابزار هنگام ثبت با شناسهٔ ابزار تطبیق داده می‌شود، اندازه و ساختار آن محدود است و نسخهٔ ثبت‌شده به‌صورت عمیق immutable می‌شود.
- پاسخ `{ ok: false }` در Handler دیگر موفقیت ابزار تلقی نمی‌شود؛ خطا به Tool Loop، رویدادهای زنده و تاریخچه با وضعیت شکست واقعی منتقل می‌شود.
- ۱۶۴ تست محلی موفق شدند؛ هیچ D1، Migration، Binding، Secret، جدول یا Durable Object class جدیدی اضافه نشده است. Deploy واقعی انجام نشده و اتصال Providerهای زنده باید جداگانه آزموده شود.

## اصلاحات نسخهٔ 19.11.20

- موتور مرورگر واقعی Cloudflare Browser Run به Agent موجود اضافه شد؛ `web_research`، `read_url`، Planner، Tool Loop، Registry، سهمیه و سیستم تأیید بازنویسی نشده‌اند.
- `browser_inspect` صفحات عمومی JavaScript را در حالت فقط‌خواندنی رندر و بررسی می‌کند؛ `browser_interact` برای کلیک، تکمیل فیلد، کلید و اسکرول به تأیید صریح وابسته است. کارت تأیید، مقصد و فهرست عملیات دقیق را پیش از اجرا نمایش می‌دهد.
- هر نشست از allowlist میزبان‌های دقیق استفاده می‌کند، حداکثر پنج زبانه و ده action دارد و پس از اتمام بسته می‌شود. نشست بین پیام‌ها پایدار نیست. سایت‌هایی که به CDN/API/font خارج از allowlist وابسته‌اند ممکن است ناقص رندر شوند.
- پیکربندی محلی `wrangler.jsonc` اکنون binding با نام `BROWSER` را اعلام می‌کند. پیش از Deploy باید دسترسی Browser Run در حساب Cloudflare موجود باشد؛ این کیت هیچ تنظیم زنده یا Secret را خودکار تغییر نمی‌دهد.
- ۱۶۰ تست از ۱۶۰ تست موفق شدند و `verify:dev` موفق شد. SDK صوتی در محیط ساخت فعلی تولید نشده است؛ قابلیت Live Voice در نبود آن غیرفعال می‌ماند. هیچ Deploy واقعی در این مرحله انجام نشده است.
- D1، ذخیره‌ساز موازی یا Worker جدیدی اضافه نشده است.

## اصلاحات نسخهٔ 19.11.19

- زیرصفحه‌های عمومی، امنیت، حریم خصوصی، فضای ذخیره‌سازی و تاریخچه با جزئیات بیشتر و کنترل‌های محلی واقعی تکمیل شدند؛ قابلیت‌هایی که API یا زیرساختشان موجود نیست، به‌روشنی غیرفعال اعلام می‌شوند.
- بایگانی همهٔ گفتگوهای محلی، بازیابی گفتگو و حذف موردی گفتگوهای بایگانی‌شده اضافه شد.
- ارسال پیام در حالت مهمان اکنون پیش‌نمایش محلی ثبت می‌کند و کاربر را به صفحهٔ ساخت حساب نمی‌فرستد؛ هیچ درخواست مدل یا API محافظت‌شده‌ای در این حالت ارسال نمی‌شود.
- دکمهٔ Google در صفحهٔ ورود نمایش داده می‌شود. جریان OAuth قبلی حفظ شده و با انتخاب حساب Google کار می‌کند؛ در صورت نبود Secretهای OAuth در Cloudflare، دکمه وضعیت پیکربندی‌نشده را اعلام می‌کند.
- فایل‌های Worker سمت سرور، تنظیمات Wrangler، Durable Objectها و `site/_worker.js` بدون تغییر مانده‌اند؛ D1 اضافه نشده است.
- ۱۵۹ تست از ۱۵۹ تست موفق شدند و `verify:dev` نیز موفق شد. SDK صوتی محلی در این محیط ساخته نشده است؛ Live Voice تا ساخت آن غیرفعال می‌ماند. انتشار واقعی Cloudflare از این محیط انجام نشده است.

## اصلاحات نسخهٔ 19.11.18

- تنها یک صفحهٔ حساب SAYROX باقی می‌ماند. ورود با ایمیل و ساخت حساب در همان صفحهٔ برند باز می‌شوند؛ صفحهٔ جداگانهٔ ورود/خوش‌آمدگویی ساخته نمی‌شود.
- ورود Google با جریان سمت سرور Authorization Code + PKCE پیاده‌سازی شده است.
- `state` امضاشده، `nonce`، PKCE S256، بررسی امضای RS256 کلیدهای Google و اعتبارسنجی `iss`، `aud`، `exp`، `iat` و `email_verified` انجام می‌شود.
- حساب ایمیل/رمز موجود فقط به‌خاطر برابر بودن آدرس ایمیل به Google متصل نمی‌شود، چون ثبت‌نام فعلی SAYROX اثبات مالکیت ایمیل ندارد. کاربر ابتدا با رمز قبلی وارد می‌شود و از «تنظیمات ← حساب کاربری ← اتصال حساب Google» اتصال را صریحاً آغاز می‌کند. Worker نشست موجود، شناسهٔ کاربر و برابر بودن ایمیل تأییدشدهٔ Google را کنترل می‌کند؛ شناسه، رمز و داده‌های حساب قبلی حفظ می‌شوند. حساب‌های جدید Google می‌توانند مستقیم ساخته و وارد شوند.
- نشست پس از callback با کوکی `HttpOnly; Secure; SameSite=Lax` ایجاد می‌شود. Access Token گوگل در مرورگر یا Durable Object ذخیره نمی‌شود.
- ستون nullable به نام `google_sub` با مهاجرت افزایشی در SQLite داخلی Durable Object حساب اضافه می‌شود. هیچ D1 یا سرویس دیتابیس جدیدی افزوده نشده است.
- دکمهٔ Google فقط وقتی نمایش داده می‌شود که هر دو مقدار OAuth در Worker ثبت شده باشند.
- Service Worker cache version و فایل‌های تولیدی با نسخهٔ `19.11.18` هماهنگ شده‌اند.

## ساخت و تنظیم OAuth در Google

در Google Cloud Console یک پروژه ایجاد کن و بخش Google Auth Platform / OAuth consent screen را تنظیم کن. سپس یک OAuth Client از نوع **Web application** بساز.

Authorized JavaScript origin:

```text
https://sayrox.mazimm5522.workers.dev
```

Authorized redirect URI (باید دقیقاً با دامنه‌ای که کاربر SAYROX را از آن باز می‌کند یکسان باشد):

```text
https://sayrox.mazimm5522.workers.dev/api/auth/google/callback
```

فقط scopeهای `openid`, `email`, `profile` استفاده می‌شوند. اگر Consent Screen در حالت Testing است، حساب Gmail خودت را در فهرست Test users اضافه کن. برای انتشار عمومی باید وضعیت برنامه و الزامات تأیید Google را تکمیل کنی.

پس از ساخت OAuth Client، در Cloudflare → Worker `sayrox` → Settings → Variables and Secrets این دو مقدار را اضافه کن:

- `GOOGLE_CLIENT_ID` — نوع **Text**؛ Client ID دریافتی از Google
- `GOOGLE_CLIENT_SECRET` — نوع **Secret**؛ Client Secret دریافتی از Google

این دو مقدار را در چت یا GitHub نفرست. `GOOGLE_CLIENT_SECRET` را فقط در Cloudflare وارد کن. نیازی به Supabase نیست؛ حساب‌ها و نشست‌ها در معماری موجود Worker + Durable Objects باقی می‌مانند.

پس از ثبت مقدارها، این نشانی را باز کن:

```text
https://sayrox.mazimm5522.workers.dev/api/health
```

در خروجی، `providers.auth` و `providers.googleAuth` باید `true` باشند. اگر `googleAuth` مقدار `false` دارد، یکی از دو مقدار OAuth در Worker اصلی ثبت نشده یا نامش دقیق نیست.

## تست‌ها و محدودیت بررسی محلی

در بررسی محلی این نسخه، **۱۵۵ تست از ۱۵۵ تست موفق** شدند؛ شامل تست شبیه‌سازی‌شدهٔ Google OAuth با کلید RSA، state، nonce، PKCE، جلوگیری از ادغام خودکار ناامن، اتصال صریح از نشست معتبر و حفظ رمز/شناسهٔ حساب موجود.

`build-app`, `build-worker`, کنترل همگامی فایل‌های تولیدشده و `verify:dev` موفق شدند. در محیط بررسی محلی دانلود npm برقرار نبود و فایل SDK صوتی ElevenLabs در این نشست ساخته نشد؛ به همین دلیل Build کامل Production را اینجا موفق اعلام نمی‌کنیم. Cloudflare Build وابستگی‌ها را نصب و SDK را می‌سازد و تا وقتی همهٔ کنترل‌ها موفق نشوند Deploy را متوقف می‌کند.

## ترتیب Workerها و داده‌ها

Deploy Kit تنظیمات موجود را نگه می‌دارد و این Workerها را مرحله‌ای Dry Run و Deploy می‌کند:

1. `sayrox-auth-storage`
2. `sayrox-billing-storage`
3. `sayrox-usage-storage`
4. `sayrox-tasks-storage`
5. `sayrox-code-sandbox-preview` (Python Sandbox موجود؛ همان DO و Container فعلی)
6. `sayrox`

هیچ Namespace یا Binding موجودی Rename یا حذف نمی‌شود. داده‌ها از SQLite داخلی Durable Objects استفاده می‌کنند و هیچ D1 database یا bindingی به پروژه اضافه نمی‌شود. استقرار Worker کانتینری و image آن کاملاً تراکنشی نیست: ممکن است کد Worker منتشر شود و سپس ساخت/انتشار image خطا بدهد. پس از Deploy وضعیت Container و اجرای Python را با یک درخواست آزمایشیِ غیرحساس بررسی کن؛ در صورت شکست rollout، قابلیت Sandbox را فعال فرض نکن و طبق Rollback به نسخهٔ سازگار برگرد.

پس از Deploy موفق، با ایمیل و رمز وارد حساب آزمایشی شو. سپس از تنظیمات ← حساب کاربری، Google را متصل کن. بعد خارج شو و با Google وارد شو؛ باید همان کاربر و داده‌های قبلی را ببینی. سپس یک پیام آزمایشی بفرست تا نشست و مسیر چت هم در محیط واقعی بررسی شوند. موفقیت تست محلی به‌تنهایی جای آزمایش زنده با OAuth Client واقعی را نمی‌گیرد.
