# iqra · اقرأ

A free, non-commercial web app for practicing Quran recitation. It opens as a Mushaf: turn to any page, or none in
particular, press the microphone and recite. iqra finds where you are in the whole Quran, turns to that page,
follows you word by word as you recite, and marks which words you recited as written, missed, said differently, or
added.

- **The whole book, a page at a time.** All 604 pages of the Madani Mushaf, with surah headings, ayah ornaments,
  hizb-quarter signs, and juz and hizb divisions from Tanzil's metadata. Each page fills the screen like a printed
  page, with nothing to scroll; wide screens show two pages side by side, as an open Mushaf. Contents by surah, juz,
  hizb quarter, page number or `surah:ayah`; swipe, arrow keys or the page footer to turn pages. Ayah and page
  numbers are written 1 2 3 by default, or ١ ٢ ٣ (Settings → Numbers).
- **AMOLED black, in bleu ciel.** Dark mode, the default, keeps the page true black, with glisse's translucent glass
  for cards, sheets and controls (what passes beneath shows through, blurred), bleu ciel accents and black icons on
  bleu ciel buttons; a light mode is one tap away in Settings. Five theme colours (Sky, Emerald, Sand, Lavender,
  Graphite) are derived in OKLCH from one hue, so every palette keeps the same contrast: Quran text 17.6:1 on black
  (14:1 in light mode), secondary text above 6:1.
- **Start anywhere, follow along.** The first words you recite are looked up in all 77,433 words of the Quran. From
  then on the book follows you, turning pages as you go, with words lighting up while you recite them.
- **Recite from memory.** Hide the words; each one appears as you recite it. Press and hold an ayah to peek, or ask
  for the next word.
- **Private by design.** Speech recognition runs entirely in your browser (a Web Worker running Whisper through
  ONNX Runtime). Audio never leaves the device. There is no backend, no accounts, no analytics, no ads.
- **Installs as an app, works offline.** Add iqra to a phone's home screen or a computer as an app (More → Install
  the app; on iPhone and iPad, Share → Add to Home Screen). It keeps its own files on the device, so it opens without
  a connection, and reciting works offline too once the speech model has been downloaded.
- **Costs nothing to run.** A static site on Vercel's free Hobby plan. The only network traffic is loading the site
  and a one-time download of the speech model from the Hugging Face Hub, which the browser then caches.
- **Faithful text.** The Quran text is the Tanzil Project's Uthmani text, displayed exactly as published.

> The AI can make mistakes. It is not a replacement for a qualified teacher.

## Contents

- [Local setup](#local-setup)
- [Deploying to Vercel](#deploying-to-vercel)
- [Installing and working offline](#installing-and-working-offline)
- [How it works](#how-it-works)
- [Speech models and how they were converted](#speech-models-and-how-they-were-converted)
- [Quran text](#quran-text)
- [Project layout](#project-layout)
- [Limitations](#limitations)
- [Attributions and licenses](#attributions-and-licenses)

## Local setup

Requires Node.js 20.19 or newer.

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173. Recording needs a secure context, which `localhost` is.

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server (with the cross-origin isolation headers) |
| `npm test` | Unit tests (Vitest) |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript, all projects |
| `npm run check` | All three of the above |
| `npm run build` | Type-check and build the static site into `dist/` |
| `npm run preview` | Serve `dist/` with the exact production headers from `vercel.json` |
| `npm run data` | Regenerate the Quran JSON from the Tanzil files in `data/tanzil/` |
| `npm run licenses` | Regenerate `public/licenses/` from the installed packages |
| `npm run icons` | Redraw the app icons in `public/icons/` from `public/favicon.svg` (needs Playwright) |

## Deploying to Vercel

1. Push this repository to GitHub.
2. On [vercel.com](https://vercel.com) (Hobby plan), choose **Add New → Project** and import the repository.
3. Keep the detected settings: framework **Vite**, build command `npm run build`, output directory `dist`.
   No environment variables are needed.
4. Deploy.

`vercel.json` is the only configuration. It sets:

- **Cross-origin isolation** (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`).
  Multithreaded WebAssembly needs `SharedArrayBuffer`, which browsers only allow on cross-origin isolated pages.
  In testing, three threads transcribed a 15 s ayah in 1.8 s instead of 3.6 s on one thread, so the headers are
  worth it. The model still loads from the Hub under these headers, because Hugging Face serves its files with CORS
  headers (verified on both `huggingface.co` and its download CDN).
- **A strict Content Security Policy.** Scripts, workers, styles and fonts come only from the site itself. Network
  requests may go only to the site and to Hugging Face (`connect-src`).
- **Caching.** Hashed assets and the versioned speech engine are cached for a year, the per-surah text files for a
  day.
- **Routes.** `/page/1` … `/page/604`, `/settings` and `/about` are served by the single-page app.
- **The service worker** (`/sw.js`) is never cached, so a new version is picked up at once.

The deployment is about 43 MB, mostly the ONNX Runtime WebAssembly engine (served by the site instead of a
third-party CDN). It is only downloaded when the speech model is first prepared.

## Installing and working offline

iqra is a Progressive Web App. `public/manifest.webmanifest` names it and gives its icons: the logo for browsers
and desktops, and full-bleed squares for home screens that cut their own shape (Android's maskable icons, the Apple
touch icon). `npm run icons` draws them from `public/favicon.svg`, and a test keeps that file identical to the logo
the app draws.

Browsers that offer installation (Chrome, Edge, Samsung Internet and others on Android and desktop) get **Install
the app** in the More sheet instead of their own banner, which would cover the dock. On iPhone and iPad the same
item explains Share → Add to Home Screen.

A service worker ([`src/sw.js`](src/sw.js)) keeps the site's own files on the device:

- **What it keeps** (about 2.7 MB): the page, scripts, styles and fonts, the 114 surah files and the licence texts.
  The build lists them for it (`vite.config.ts`), with a version that changes whenever any of them does.
- **What it leaves alone:** the speech model, downloaded from the Hugging Face Hub on first use, and the ONNX
  Runtime engine (41 MB for both builds). Transformers.js keeps both in its own cache, which the service worker also
  reads from, so nothing is stored twice and the engine is only downloaded by those who use the microphone.
- **Pages** come from the network when it answers within 4 seconds, so a new version shows at once; otherwise from
  the kept copy, which serves every address of the app. **Other files** come from the kept copies first.
- **Updates:** a new version is downloaded in the background and kept alongside the old one until no open tab uses
  the old one, so a page that is open never loses the files it was built with.
- **Cross-origin isolation survives offline:** kept responses carry the same headers as the network's, so
  multithreaded recognition works offline too.
- After the speech model is downloaded, iqra asks the browser to keep its storage even when space runs low
  (`navigator.storage.persist()`).

## How it works

1. **Open the Mushaf.** Each page shows its ayahs (page boundaries from Tanzil's metadata), loaded from one small
   JSON file per surah, and is sized to the screen (below). In the background the remaining surah files are fetched
   and indexed for searching.
2. **Record.** `getUserMedia` feeds an AudioWorklet that resamples to 16 kHz mono Float32 as it records, after two
   low-pass filters to prevent aliasing. Denied permission, a missing or busy microphone and unsupported browsers
   get clear messages.
3. **Split at pauses.** Whisper hears at most 30 s at a time, and these Quran models were trained on one ayah per
   clip. The recording is cut at every pause of at least 0.35 s, so each segment is about one ayah or phrase;
   segments longer than 24 s (a long ayah with no pause) are cut at their quietest point.
4. **Transcribe as you go.** A Web Worker runs the model with Transformers.js: the encoder on WebGPU when the device
   has a real GPU adapter, everything else on multithreaded WebAssembly. Each finished segment is transcribed as
   soon as you start the next one. While the model has nothing finished to do, it also transcribes the phrase you
   are still reciting, about every second or two, so the words you are saying light up provisionally. Finished
   segments always go first.
5. **Find and follow.** Each finished segment is placed in the Quran (below) and its words are marked correct,
   different (wrong) or missed, plus any added words. Marks stay on the book until you clear them; the summary
   lists the ayahs to look at again and can start you on them.

### A whole page on the screen

Tanzil publishes where each page starts but not its line breaks, so the lines are flowed and justified by the
browser, and each page is sized like a printed one ([`src/components/fit.ts`](src/components/fit.ts)). For a page
box of height $H$ and the base line height $\lambda_0 = 2.05$ em, the font size is the largest that fits,

$$f^* = \max\Big\{\, f \le \frac{H}{15\,\lambda_0} \;:\; h(f, \lambda_0) \le H \Big\}$$

where $h$ is the height the browser lays the page out at, capped at the size where the Madani Mushaf's 15 lines fill
the page (9 lines on the two opening pages, which print sets larger). The line height is
then opened up, $\lambda \in [\lambda_0, 2.75]$, until $h(f^*, \lambda) = H$: line height moves only the height, not
the line breaks, so it is found by interpolation. Pages shown side by side share one font size. Marks never change
the layout (badges and added-word pins are drawn over the text), so a page keeps its size while it is recited.

Each trial size is a full layout of the page's Arabic text, the costly part of turning a page, so the search for
$f^*$ (to a tenth of a pixel) takes few: it starts from the size of the page fitted before, as neighbouring pages are
set alike, and since wrapped text grows with the square of its size, aims each next trial where the height meets
the box, $f' = f\sqrt{H/h(f)}$ (between the two sizes measured on either side once there are both), halving the
interval instead whenever two trials in a row fall on the same side, as they do where a line breaks differently and
$h$ jumps. A page takes about five layouts instead of fourteen, the page box is laid out on its own (CSS
containment), and a page fitted before, in the same box and settings, is set at once.

The end-of-ayah ornament is drawn by the Mushaf font from the sign U+06DD followed by the number. The font only
encloses Arabic-Indic digits, so for 1 2 3 its empty sign (always 1.28 em wide) is drawn and the number, in the
font's own Latin digits, is centred on it.

Across all 604 pages this gives 18–21 px text on a 390 × 844 phone, 14–17 px on a 360 × 640 one and about 28 px on
a tablet, with nothing to scroll. Where a page would need text smaller than 14 px (a phone held sideways), it
switches to 20 px text that scrolls, and Settings offers *Large* and *Extra large* text that scroll for anyone who
needs bigger letters.

### Why cut at every pause (and not fixed 30 s windows, or ayah by ayah)

Measured on real recitations (EveryAyah recordings, used only for testing):

- **Fixed 30 s windows with 5 s overlap** cut words in half at the window edges and, when merging the overlaps,
  silently dropped a phrase the reciter really repeated (Alafasy, 78:40): 95.9 % of words correct on ten long ayahs.
- **Packing several ayahs into one ≤ 28 s segment** made the model skip whole ayahs: on Al-Fatiha it left out the
  basmala and, in other runs, 1:3–1:4 or all of 1:7.
- **One segment per pause** transcribed every ayah of Al-Fatiha and scored 96.4–96.8 % on the long ayahs.
- **Recording ayah by ayah** would not avoid splitting: 12 of Husary's recordings of Al-Baqarah 1–30 are longer than
  30 s on their own (2:282 is 260 s), and tapping between ayahs interrupts recitation from memory.

### Mistake detection

All of this lives in [`src/lib/arabic/normalize.ts`](src/lib/arabic/normalize.ts),
[`src/lib/arabic/similarity.ts`](src/lib/arabic/similarity.ts) and
[`src/lib/recitation/align.ts`](src/lib/recitation/align.ts), with tests next to each.

**What the model writes.** Tested on 581 recitations: fully diacritized **standard (Imla'i) spelling**, not Uthmani
(`الْعَالَمِينَ` where Tanzil has `ٱلْعَـٰلَمِينَ`). It uses exactly 44 code points: the letters U+0621–U+064A
(including `ء آ أ ؤ إ ئ ة ى`) and the diacritics U+064B–U+0652. It never writes alef wasla, the superscript alef,
tatweel, U+0653/U+0654 or anything in U+06D6–U+06ED. The disjointed letters come out bare (`الم`, `كهيعص`), and some
words are split differently (`يَا أَيُّهَا` for `يَـٰٓأَيُّهَا`).

**Normalization** (in memory, for comparison only; the displayed text is never touched):

- strip harakat and Quranic marks (U+0610–U+061A, U+064B–U+065F, U+06D6–U+06ED) and tatweel;
- unify alef forms (`أ إ آ ٱ → ا`), `ى → ي`, `ة → ه`; hamza: a word-initial alef/hamza cluster becomes one `ا`,
  other `ء أ إ ؤ ئ` are dropped;
- bridge Uthmani spellings to standard ones: a superscript alef (U+0670) and letters marked silent (`۟ ۠`) become
  *optional* letters; a waw or alef maksura that only carries a superscript alef (`ٱلصَّلَوٰةَ`, `ٱلتَّوْرَىٰةَ`) becomes
  `ا`; `ۧ → ي`; the small waw/yeh lengthening a pronoun `ه` is dropped; `ٱلَّ` gets an optional second lam
  (`ٱلَّيْلِ` ~ `اللَّيْلِ`).

**Word similarity** is a weighted Levenshtein distance $d_w$ where optional letters cost nothing and a word-final
`ه`/`ت` swap costs 0.3:

$$\mathrm{sim}(e,h) = 1 - \frac{d_w(e,h)}{\max(|e|,\,|h|)}$$

A word counts as correct when $\mathrm{sim} \ge \theta$. The strictness slider sets $\theta$ (default 0.7).

**Alignment** is a Needleman–Wunsch style dynamic program over words:

$$
D_{i,j} = \min \begin{cases}
D_{i-1,j-1} + 1 - \mathrm{sim}(e_i, h_j) & \text{match or different word} \\
D_{i-1,j-k} + 1 - \mathrm{sim}(e_i,\, h_{j-k+1} \cdots h_j) + \varepsilon & \text{one word heard as } k = 2, 3 \\
D_{i-2,j-1} + 1 - \mathrm{sim}(e_{i-1} e_i,\, h_j) + \varepsilon & \text{two words heard as one} \\
D_{i,j-1} + 1 & \text{added word} \\
D_{i-1,j} + c_i & \text{missed word } (c_i = 0 \text{ for optional words})
\end{cases}
$$

A merge is only allowed when the merged words reach $\theta$ *and* fit better than any single one of them, so a
short added word next to a long one is reported instead of swallowed. The isti'ādha, the basmala (except in
Al-Fatiha, where it is ayah 1) and a closing *ṣadaqa-llāh* are optional. Pause marks are not words. Added words
that repeat nearby text are labelled *repeated*, and ties are broken so that when a reciter restarts a phrase, the
final attempt is the one compared. Results are attached to the original Uthmani words by index.

A recognition quirk is handled too: when audio ends unexpectedly the model sometimes loops on a word
(`الرَّحْمَنِ الرَّحْمَنِ الرَّحْمَنِ`). No ayah repeats a word three times in a row (a test checks all 6,236), so such runs
are collapsed to one word, which lets a skipped word still be reported as missed.

**Accuracy on real recordings** (tests in `src/lib/recitation/evaluate.test.ts` replay the model's real output):

| Set | Words | Correct at θ = 0.7 | Missed | Added |
| --- | --- | --- | --- | --- |
| 581 clean single-ayah recitations (Juz ʿAmma by Alafasy, Al-Baqarah 1–30 by Husary) | 2,464 | 99.6 % | 0 | 0 |
| 10 long ayahs (30–260 s) | 560 | 97.5 % | 0 | 9 (8 are real repetitions) |

The remaining "different" words are genuine recognition errors (e.g. `رَانَ` heard as `قَانَ`). With only the basic
normalization rules, 90.3 % of word pairs matched exactly; with the full rules, 98.4 %. That matters when the
slider is raised: at θ = 0.85 the basic rules would wrongly flag 169 correct words, the full rules 34.

### Finding and following a recitation

[`src/lib/recitation/locate.ts`](src/lib/recitation/locate.ts) and
[`src/lib/recitation/tracker.ts`](src/lib/recitation/tracker.ts), tested in the files next to them.

**Finding the first words anywhere.** Every word of the Quran gets a *skeleton*: its comparison key without alefs
and optional letters, the letters that Uthmani and standard spelling most often write differently. Runs of
$n = 1, 2, 3$ heard skeletons are looked up in an index of all 77,433 words; every hit votes for the offset
$\delta = p - i$ (word $p$ of the Quran lined up with heard word $i$), weighted by how rare the run is:

$$w = n \cdot \ln\!\left(1 + \frac{N}{\mathrm{postings}}\right), \qquad N = 77{,}433$$

Votes for offsets on an ayah's first word count 1.5 times (segments are cut at pauses, so they usually start an
ayah), nearby offsets are pooled (a missed or repeated word shifts them), and two heard words that Uthmani writes as
one (`يا أيها` ~ `يَـٰٓأَيُّهَا`) or a dropped `و`/`ف` also vote. The best eight offsets and the open page are then checked
with the word alignment below, and ranked by words matched, then the open page, then closeness of spelling, then a
span of whole ayahs. All 591 real transcripts in the tests are placed at their ayah or, for 15 of them, at an ayah
with identical words (the refrain of Al-Mursalat, 77:15 = 83:10, among others), in about 1.5 ms each. When words
occur in several places equally well and none is on the open page, iqra waits for the next ayah to decide.

**Following.** Once found, each segment is aligned *locally* around where the reciter is: the expected words from
the start of the previous ayah to two ayahs ahead. In local alignment the expected words before and after the
matched span cost nothing, and the span must start and end on a word close to the text. Then:

- words between where you were and where the segment starts were skipped, and are marked missed;
- a segment that starts earlier is a repetition: its words take the latest attempt, nothing is marked missed;
- a segment that fits nowhere nearby is looked up in the whole Quran again, which follows a jump to another page
  or surah without marking anything in between;
- the isti'ādha, the basmala (between surahs, or before starting mid-surah), *ṣadaqa-llāh* and *āmīn* are
  recognized and never reported as added words, unless they are the text itself (Al-Fatiha 1:1, 27:30, 16:98);
- when you stop one or two words before the end of an ayah, those words are marked missed.

On the real transcripts, An-Naba 1–40, ʿAbasa, Al-Fajr, Al-ʿĀdiyāt, Al-Ikhlāṣ and Al-Baqarah 1–12 are each found
from their first ayah and followed to the end with no word wrongly marked missed.

## Speech models and how they were converted

The app uses ONNX builds of [tarteel-ai/whisper-tiny-ar-quran](https://huggingface.co/tarteel-ai/whisper-tiny-ar-quran)
(default) and [tarteel-ai/whisper-base-ar-quran](https://huggingface.co/tarteel-ai/whisper-base-ar-quran) (the
optional "Higher accuracy" setting), both Apache-2.0. They are loaded at run time from the Hub, pinned to exact
commits in [`src/config/models.ts`](src/config/models.ts), and never bundled with the site.

| Setting | Repository | Files | Download (incl. engine) |
| --- | --- | --- | --- |
| Standard | [Rayen0/whisper-tiny-ar-quran-onnx](https://huggingface.co/Rayen0/whisper-tiny-ar-quran-onnx) | fp32 encoder + int8 decoder | ≈ 81 MB (≈ 94 MB with WebGPU) |
| Higher accuracy | [Rayen0/whisper-base-ar-quran-onnx](https://huggingface.co/Rayen0/whisper-base-ar-quran-onnx) | int8 encoder + int8 decoder | ≈ 94 MB |

Community ONNX conversions exist on the Hub, but none was a good fit. Compared with the original PyTorch models
on 45 recitations by four reciters:

- Fully int8 tiny builds (including Optimum's default quantization) differed on 4 of 45 clips and invented words
  (2:1 `الم` came out as `الر تَقْتُلُونَ`). Quantizing only the decoder kept all 45 identical, so the tiny encoder stays
  fp32.
- The base model tolerates int8 everywhere (45 of 45 identical).
- Existing base conversions either ship the exporter's English-only `generation_config.json` (Transformers.js then
  refuses `language: "arabic"`) or an "int8" decoder that is really the 314 MB fp32 graph.

The builds were made with Hugging Face Optimum. [`scripts/convert-model.sh`](scripts/convert-model.sh) runs all of it,
including the model cards in [`model-cards/`](model-cards) and the license. For the tiny model, the steps are:

```bash
pip install "optimum-onnx[onnxruntime]==0.1.0" torch
```

```bash
optimum-cli export onnx --model tarteel-ai/whisper-tiny-ar-quran --task automatic-speech-recognition-with-past export-tiny
```

```bash
optimum-cli onnxruntime quantize --onnx_model export-tiny --avx512 -o quant-tiny
```

```bash
mkdir -p whisper-tiny-ar-quran-onnx/onnx && cp export-tiny/*.json export-tiny/merges.txt whisper-tiny-ar-quran-onnx/ && cp export-tiny/encoder_model.onnx quant-tiny/decoder_model_merged_quantized.onnx whisper-tiny-ar-quran-onnx/onnx/
```

```bash
hf download openai/whisper-tiny generation_config.json --local-dir gen-tiny && cp gen-tiny/generation_config.json whisper-tiny-ar-quran-onnx/
```

```bash
hf upload your-hf-username/whisper-tiny-ar-quran-onnx whisper-tiny-ar-quran-onnx .
```

For the base model, replace `tiny` with `base` and copy `quant-base/encoder_model_quantized.onnx` instead of the fp32
encoder. To use other repositories, change `repo`, `revision` and the file sizes in `src/config/models.ts`.

## Quran text

[`data/tanzil/`](data/tanzil) holds Tanzil's files exactly as downloaded (with their copyright notice).
`npm run data` turns them into `public/quran/001.json` … `114.json` (each carrying the full notice),
`src/data/surahs.ts` (Arabic names, English transliterations, ayah counts) and `src/data/book.ts` (where each of the
604 pages, 30 juz and 240 hizb quarters starts, and the 15 ayahs of prostration). The XML export is used because Tanzil's
text export prefixes ayah 1 of most surahs with the basmala; the basmala is shown above those surahs instead.
Tests check that every one of the 6,236 ayahs is byte-identical to Tanzil's XML and agrees with its independent text
export, and that splitting ayahs into words for display never changes a character.

## Project layout

```
data/tanzil/             Tanzil source files (verbatim)
model-cards/             model cards of the ONNX builds on the Hub
public/quran/            generated per-surah text (verbatim, with Tanzil's notice)
public/licenses/         license texts shown from the About page
public/icons/            app icons (drawn by scripts/build-icons.mjs)
scripts/                 data, license, icon and model-conversion scripts
src/data/                generated surah metadata and Mushaf divisions
src/lib/arabic/          normalization and word similarity
src/lib/quran/           pages, juz and hizb; the whole text as one word sequence; ayah references
src/lib/recitation/      alignment, locating, following, optional phrases, live transcription
src/lib/audio/           recorder (AudioWorklet), pause segmentation
src/lib/asr/             page-side client for the speech worker
src/worker/              the speech-recognition Web Worker
src/state/               settings, the current page, the recitation in progress
src/components/          React UI (glisse components)
src/sw.js                the service worker (its file list is added by the build)
```

The interface uses the [glisse](https://github.com/0kzh/glisse) Liquid Glass components (Button, Glass, Input,
Menu, SearchField, SegmentedControl, Slider, Switch, TabBar). glisse lays out its sliding controls left to right,
so in Arabic they are rendered in left-to-right islands with their items in right-to-left order
([`src/components/Directional.tsx`](src/components/Directional.tsx)). Its segmented controls draw every segment
84 px wide; iqra widens them together so the longest label fits on one line, within the width available. With
$\ell$ the longest label's width, $W$ the width available and $n$ the number of segments, each segment is
$w = \min\big(\max(84,\ \ell + 24),\ \lfloor W/n \rfloor\big)$ px wide, and labels only wrap (in taller segments)
when $w < \ell + 4$.

### Motion

Changes of screen are [view transitions](https://developer.mozilla.org/docs/Web/API/View_Transition_API)
([`src/lib/motion.ts`](src/lib/motion.ts)): a page turn slides the page out, from wherever a swipe left it, as the next
one slides in from the other side; another view fades through; a change of theme, colour, language, numbers or text
size crossfades. Sheets rise in and sink out. Everything is still with the system's reduced-motion setting, and
browsers without view transitions get a simple slide for page turns.

The screen is frozen between the snapshot and the animation, so the work done there is kept small: only what
changes renders again (the Mushaf page and the views are memoized, and Settings and About exist only while shown),
the page fit above, and no glass images drawn. glisse draws each glass's rim (and in Chromium its refraction) as
images the size of the element, so the large still panes, cards and sheets, are drawn by CSS alone in the same look
([`src/components/Surface.tsx`](src/components/Surface.tsx)), and the rim's inputs are the same in both themes, so a
change of theme reuses the images already drawn. With the CPU slowed four times, a page turn starts within about
0.2 s (0.05 s for a page seen before) and a change of view within 0.25 s.

## Limitations

- Words are compared, not tajweed or vowel marks. A wrong vowel inside a correct word is not detected.
- Recognition errors happen, especially with background noise or very fast recitation. Single-letter differences
  are where recognition noise and real mistakes overlap; raise the strictness to catch more of them.
- If a reciter goes more than 24 s without any pause, that stretch is cut at its quietest point, which can split a
  word.
- Pages follow the Madani page boundaries but not its exact lines, which Tanzil does not publish: a line here
  holds a few more or fewer words than in print, and justification widens spaces rather than stretching letters.
- Following updates about every second or two, not with every syllable: the model needs that long to transcribe.
- An ayah whose words also occur elsewhere (refrains such as 55:13) is placed on the open page, or near where you
  were reciting; recited on its own from another page, it is placed at the first ayah with those words.
- Marks are kept in memory until the page is reloaded, and only the page you last opened is remembered (in
  `localStorage`). Nothing is saved anywhere else.

## Attributions and licenses

- **Quran text:** [Tanzil Project](https://tanzil.net). Tanzil Quran Text (Uthmani, Version 1.1), Copyright (C)
  2007-2026 Tanzil Project, License: Creative Commons Attribution 3.0. Permission is granted to copy and distribute
  verbatim copies of this text, but changing it is not allowed. The text can be used in any website or application,
  provided that its source (Tanzil Project) is clearly indicated, and a link is made to tanzil.net to enable users
  to keep track of changes. Surah names and ayah counts come from Tanzil's
  [Quran metadata](https://tanzil.net/docs/quran_metadata).
- **Speech models:** [tarteel-ai/whisper-tiny-ar-quran](https://huggingface.co/tarteel-ai/whisper-tiny-ar-quran) and
  [tarteel-ai/whisper-base-ar-quran](https://huggingface.co/tarteel-ai/whisper-base-ar-quran), fine-tuned from
  [OpenAI Whisper](https://github.com/openai/whisper). Licensed under the Apache License, Version 2.0; see
  [`public/licenses/Apache-2.0.txt`](public/licenses/Apache-2.0.txt). The ONNX builds and the changes made to them
  are described in [`model-cards/`](model-cards).
- **Font:** [Amiri Quran](https://github.com/aliftype/amiri), Copyright 2010-2022 The Amiri Project Authors, SIL Open
  Font License 1.1; see [`public/licenses/OFL-1.1-Amiri.txt`](public/licenses/OFL-1.1-Amiri.txt).
- **Software:** [Transformers.js](https://github.com/huggingface/transformers.js) (Apache-2.0),
  [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) (MIT), [React](https://react.dev) (MIT),
  [glisse](https://github.com/0kzh/glisse) (MIT), [Tailwind CSS](https://tailwindcss.com) (MIT) and
  [Vite](https://vite.dev) (MIT). Full texts: [`public/licenses/THIRD-PARTY.txt`](public/licenses/THIRD-PARTY.txt).
