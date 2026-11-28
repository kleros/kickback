"use client";

import { useEffect } from "react";

import { GlassCard } from "@/components/ui/GlassCard";
import { GradientButton } from "@/components/ui/GradientButton";

/** A crash inside a page: a plain retry, never the error's own text. */
export default function ErrorPage({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Page error", error.digest ?? "");
  }, [error]);
  return (
    <div className="kb-narrow">
      <GlassCard as="section" className="kb-refusal" data-testid="page-error">
        <h1>Something went wrong</h1>
        <p>Reload the page to try again. If it happens again, try another browser or wallet.</p>
        <div className="mt-4">
          {/* a full reload also resets the wallet and the cached reads */}
          <GradientButton onPress={() => window.location.reload()}>Reload the page</GradientButton>
        </div>
      </GlassCard>
    </div>
  );
}
