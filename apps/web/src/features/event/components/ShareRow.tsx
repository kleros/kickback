"use client";

import { Button } from "react-aria-components";

import { CopyButton } from "@/components/ui/CopyButton";
import { ArrowUpIcon } from "@/components/ui/icons";

import { useShare } from "../hooks/useShare";
import { shareUrls } from "../model/socialShare";

const MARKS = { X: "𝕏", Farcaster: "", LinkedIn: "in", Telegram: "➤" };

function FarcasterIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M5 3h14v3h3v3h-2v11h2v2h-8v-2h2v-7a4 4 0 0 0-8 0v7h2v2H2v-2h2V9H2V6h3V3Z" />
    </svg>
  );
}

export function ShareRow({ text, luma, guestLink }: { text: string; luma: string; guestLink: string }) {
  const share = useShare(text, luma || guestLink);
  return (
    <div>
      <p className="receipt-share-label">Tell friends you&apos;re going (shares the Luma link)</p>
      <div className="receipt-share" aria-label="Share your deposit" data-testid="share-row">
        {share.native ? (
          <Button className="kb-icon-btn" aria-label="Share" onPress={() => void share.share()}>
            <ArrowUpIcon />
          </Button>
        ) : (
          Object.entries(shareUrls(text, luma, guestLink)).map(([name, href]) => (
            <a
              key={name}
              href={href}
              className="kb-icon-btn"
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Share on ${name}`}
            >
              {name === "Farcaster" ? <FarcasterIcon /> : <span aria-hidden>{MARKS[name as keyof typeof MARKS]}</span>}
            </a>
          ))
        )}
        <CopyButton value={text} label="Copy text" />
      </div>
      {share.error && (
        <p role="status" className="og-note">
          {share.error}
        </p>
      )}
    </div>
  );
}
