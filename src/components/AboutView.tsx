import { Glass } from "glisse";
import { MODELS } from "../config/models";
import { useSettings } from "../state/settings";

function External({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="link" dir="ltr">
      {children}
    </a>
  );
}

export function AboutView() {
  const { t } = useSettings();
  return (
    <div className="flex flex-col gap-5">
      <h1 className="page-title">{t.aboutTitle}</h1>

      <Glass className="card prose-card">
        <p>{t.aboutIntro}</p>
        <h2>{t.aboutPrivacyTitle}</h2>
        <p>{t.aboutPrivacy}</p>
        <h2>{t.aboutOfflineTitle}</h2>
        <p>{t.aboutOffline}</p>
        <h2>{t.aboutLimitsTitle}</h2>
        <p>{t.aboutLimits}</p>
        <p className="disclaimer">{t.disclaimer}</p>
      </Glass>

      <Glass className="card prose-card" id="licenses">
        <h2>{t.creditsTitle}</h2>

        <h3>{t.creditTanzilTitle}</h3>
        <p>{t.creditTanzil}</p>
        <p className="notice" dir="ltr" lang="en">
          Tanzil Quran Text (Uthmani, Version 1.1)
          <br />
          Copyright (C) 2007-2026 Tanzil Project
          <br />
          License: Creative Commons Attribution 3.0
        </p>
        <p className="text-sm">{t.creditTanzilTerms}</p>
        <p>
          <External href="https://tanzil.net">tanzil.net</External>
        </p>

        <h3>{t.creditModelsTitle}</h3>
        <p>{t.creditModels}</p>
        <ul className="link-list" dir="ltr">
          <li>
            <External href={`https://huggingface.co/${MODELS.standard.source}`}>{MODELS.standard.source}</External>
          </li>
          <li>
            <External href={`https://huggingface.co/${MODELS.accurate.source}`}>{MODELS.accurate.source}</External>
          </li>
        </ul>
        <p className="text-sm">{t.convertedModels}</p>
        <ul className="link-list" dir="ltr">
          {Object.values(MODELS).map((m) => (
            <li key={m.id}>
              <External href={`https://huggingface.co/${m.repo}`}>{m.repo}</External>
            </li>
          ))}
        </ul>
        <p className="notice" dir="ltr" lang="en">
          {t.apacheNotice}
        </p>
        <p>
          <a href="/licenses/Apache-2.0.txt" className="link">
            {t.readLicense} (Apache-2.0)
          </a>
        </p>

        <h3>{t.creditFontTitle}</h3>
        <p>{t.creditFont}</p>
        <p>
          <a href="/licenses/OFL-1.1-Amiri.txt" className="link">
            {t.readLicense} (SIL OFL 1.1)
          </a>
        </p>

        <h3>{t.creditSoftwareTitle}</h3>
        <p>{t.creditSoftware}</p>
        <p>
          <a href="/licenses/THIRD-PARTY.txt" className="link">
            {t.readLicense}
          </a>
        </p>
      </Glass>
    </div>
  );
}
