import Link from "next/link";

import { paths } from "@/config/paths";
import { siteConfig } from "@/config/site";

export function GitHubIcon() {
  return (
    <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

const out = { target: "_blank", rel: "noopener noreferrer" } as const;

/** The Kleros footer: the product's links, Kleros's, and its socials. */
export function Footer() {
  return (
    <footer className="kb-footer">
      <div className="kb-page kb-footer-grid">
        <div>
          <a href="https://kleros.io" {...out} aria-label="Kleros" className="kb-wordmark">
            <span className="kb-brand-logo" />
          </a>
          <p className="mt-2">Refundable event deposits, with attendance disputes settled by Kleros Court.</p>
        </div>
        <div>
          <h3>{siteConfig.name}</h3>
          <ul>
            <li>
              <Link href={paths.organiseNew.getHref()}>Create an event</Link>
            </li>
            <li>
              <Link href={paths.organise.getHref()}>Organise</Link>
            </li>
            <li>
              <a href={siteConfig.repo} {...out}>
                GitHub
              </a>
            </li>
          </ul>
        </div>
        <div>
          <h3>Kleros</h3>
          <ul>
            <li>
              <a href="https://kleros.io" {...out}>
                kleros.io
              </a>
            </li>
            <li>
              <a href="https://court.kleros.io" {...out}>
                Kleros Court
              </a>
            </li>
            <li>
              <a href="https://docs.kleros.io" {...out}>
                Docs
              </a>
            </li>
            <li>
              <a href="https://blog.kleros.io" {...out}>
                Blog
              </a>
            </li>
          </ul>
        </div>
        <div>
          <h3>Community</h3>
          <ul>
            <li>
              <a href="https://x.com/kleros_io" {...out}>
                X
              </a>
            </li>
            <li>
              <a href="https://t.me/kleros" {...out}>
                Telegram
              </a>
            </li>
            <li>
              <a href="https://www.linkedin.com/company/kleros" {...out}>
                LinkedIn
              </a>
            </li>
            <li>
              <a href="https://github.com/kleros" {...out}>
                GitHub
              </a>
            </li>
          </ul>
        </div>
      </div>
      <div className="kb-page kb-footer-base">
        <span>
          {siteConfig.name} · Proof of Presence protocol · Powered by{" "}
          <a href="https://kleros.io" {...out}>
            Kleros
          </a>
        </span>
        <span>
          Open source,{" "}
          <a href={siteConfig.repo} {...out}>
            MIT
          </a>
        </span>
      </div>
    </footer>
  );
}
