# Local prototype fonts

Unmodified TTF files obtained from the official Google Fonts CSS API and `fonts.gstatic.com`, 20 November 2026. Each family has its complete SIL Open Font License alongside it. No font CDN request is made by the application.

| Family | Weights | Official source/license |
| --- | --- | --- |
| Instrument Serif | 400 | https://github.com/google/fonts/tree/main/ofl/instrumentserif |
| IBM Plex Sans | 400, 500, 600 | https://github.com/google/fonts/tree/main/ofl/ibmplexsans |
| Noto Naskh Arabic | 400 | https://github.com/google/fonts/tree/main/ofl/notonaskharabic |
| IBM Plex Sans Arabic | 400, 500, 600, 700 | https://github.com/google/fonts/tree/main/ofl/ibmplexsansarabic |
| Plus Jakarta Sans | Variable 200–800 | https://github.com/google/fonts/tree/main/ofl/plusjakartasans |
| Inter | Variable 100–900, optical size 14–32 | https://github.com/google/fonts/tree/main/ofl/inter |

The public asset allowlist serves explicit font filenames. Readme/license text is retained in the repository for attribution. Practical system fallbacks and `font-display: swap` keep content usable with font loads blocked. The original agenda font files (about 1.55 MB) remain available for comparison; the typography review adds unmodified Inter/Jakarta variable files and Arabic 700. See `docs/typography-review.md`. Production font-format/subsetting optimization is a separate follow-up, not a deployment in this task.
