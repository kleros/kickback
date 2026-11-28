import type { Page } from "@playwright/test";

/** Every word a person can read or hear on the page: visible text plus labels, placeholders and tooltips. */
export function pageWords(page: Page) {
  return page.evaluate(() => {
    const extra = [...document.querySelectorAll("[aria-label],[placeholder],[title],[alt]")]
      .flatMap((el) => ["aria-label", "placeholder", "title", "alt"].map((a) => el.getAttribute(a)))
      .filter((v): v is string => !!v && !/^0x[0-9a-f]{40}$/i.test(v));
    return `TITLE: ${document.title}\n\n${document.body.innerText}\n\n--- labels, placeholders, tooltips ---\n${[...new Set(extra)].join("\n")}\n`;
  });
}
