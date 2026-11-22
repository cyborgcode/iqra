# Tanzil Quran text (source files)

These files are verbatim copies of what [Tanzil](https://tanzil.net/download/) publishes. They must not be edited; the
app's per-surah JSON files are generated from them by `npm run data`.

| File | Tanzil download options | SHA-256 |
| --- | --- | --- |
| `quran-uthmani.xml` | Uthmani, pause marks, sajdah signs, XML | `8c5aeae20363a98f6963720d29fce040ca8b56a8e75f8b564c257fce7f6d0417` |
| `quran-uthmani.txt` | same text, "Text (with aya numbers)" format; used only to cross-check the XML | `6933e133dd56db778c801bf738848454e43648105a151e8d84d86a7cae39ec5f` |
| `quran-data.xml` | [Quran metadata](https://tanzil.net/docs/quran_metadata): surah names and ayah counts | `8867c1d88191472adec9db694b3cd9f135b1a2ef580574d32cf888dcb22c5c7a` |

Downloaded on 2026-11-22 from `https://tanzil.net/pub/download/index.php?marks=true&sajdah=true&alef=true&tatweel=true&quranType=uthmani&outType=xml&agree=true`
(and `outType=txt-2` for the text file) and `https://tanzil.net/res/text/metadata/quran-data.xml`.

## License

Tanzil Quran Text (Uthmani, Version 1.1), Copyright (C) 2007-2026 Tanzil Project, License: Creative Commons
Attribution 3.0. Permission is granted to copy and distribute verbatim copies of this text, but changing it is not
allowed. The text can be used in any website or application, provided that its source (Tanzil Project) is clearly
indicated, and a link is made to tanzil.net to enable users to keep track of changes. The full copyright block is kept
at the top of `quran-uthmani.xml` and in every generated file.

To update the text, download the files again with the same options, replace them here, and run `npm run data`.
