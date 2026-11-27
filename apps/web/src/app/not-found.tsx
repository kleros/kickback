import Link from "next/link";

import { GlassCard } from "@/components/ui/GlassCard";

import { paths } from "@/config/paths";

/** Any unknown link: the site's own page, inside the header and footer. */
export default function NotFound() {
  return (
    <div className="kb-narrow">
      <GlassCard as="section" className="kb-refusal" data-testid="not-found">
        <h1>Page not found</h1>
        <p>This link does not lead to a page on this site. Check that you copied the whole link.</p>
        <p>
          <Link className="kb-link kb-tap" href={paths.home.getHref()}>
            Go to the home page
          </Link>
        </p>
      </GlassCard>
    </div>
  );
}
