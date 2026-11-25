"use client";

import { Button } from "react-aria-components";

import { CopyButton } from "@/components/ui/CopyButton";
import { ArrowUpIcon } from "@/components/ui/icons";

import { useShare } from "../hooks/useShare";
import { shareUrls } from "../model/socialShare";

const MARKS = { X: "𝕏", LinkedIn: "in", Telegram: "➤" };

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
              <span aria-hidden>{MARKS[name as keyof typeof MARKS]}</span>
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
