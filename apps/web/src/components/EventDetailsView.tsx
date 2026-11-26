"use client";

import Image from "next/image";
import { useState, type CSSProperties } from "react";

import { GlassCard } from "@/components/ui/GlassCard";
import { ExternalIcon } from "@/components/ui/icons";

import {
  venueMap,
  visibleLink,
  type EventDetailsData,
  type EventLink,
  type RegistrationPreview,
} from "@/lib/event-details";

export interface EventDetailsProps {
  details: EventDetailsData;
  description: string;
  coverUrl?: string;
  links: EventLink[];
  preview?: RegistrationPreview;
  tint?: string;
  /** The event is over: the Luma card points to the event page, not to registration. */
  ended?: boolean;
}

function Venue({ where }: { where: string }) {
  const url = venueMap(where);
  return (
    <GlassCard as="section" className="ed-venue">
      <h3>Venue</h3>
      <p>{where}</p>
      {url && (
        <iframe
          title={`Map of ${where}`}
          src={url}
          loading="lazy"
          sandbox="allow-scripts allow-same-origin allow-popups"
          referrerPolicy="no-referrer"
        />
      )}
    </GlassCard>
  );
}

export function EventDetailsView({ details, description, coverUrl, links, preview, tint, ended }: EventDetailsProps) {
  const registration = visibleLink(details.link);
  const isLuma = !!registration && /^(?:www\.)?(?:lu\.ma|luma\.com)$/.test(registration.domain);
  const title = details.title ?? details.name;
  // a long description is cut at the last space before 240 characters, then shown whole on "Read more"
  const [more, setMore] = useState(false);
  const cut = description.length > 240 ? description.slice(0, 241).search(/\s\S*$/) : -1;
  const long = cut > 0;
  if (
    !title &&
    !details.when &&
    !details.where &&
    !details.hosts.length &&
    !registration &&
    !description &&
    !coverUrl &&
    !links.length
  )
    return null;
  return (
    <section
      className="ed-section"
      aria-label="Event details"
      data-testid="event-details"
      style={{ "--ed-tint": tint } as CSSProperties}
    >
      <div className="kb-narrow ed-content">
        {coverUrl && (
          <GlassCard as="header" className="ed-poster">
            {coverUrl && <Image className="ed-cover" src={coverUrl} alt="" width={800} height={1000} unoptimized />}
            <div className="ed-poster-text">
              {title && <h2>{title}</h2>}
              {details.when && <p>{details.when}</p>}
            </div>
          </GlassCard>
        )}
        {!title && !coverUrl && details.when && <p>{details.when}</p>}
        {description && (
          <div className="ed-description">
            <p>{long && !more ? `${description.slice(0, cut).trimEnd()}…` : description}</p>
            {long && (
              <button type="button" className="kb-link ed-more" aria-expanded={more} onClick={() => setMore((v) => !v)}>
                {more ? "Show less" : "Read more"}
              </button>
            )}
          </div>
        )}
        {details.hosts.length > 0 && (
          <div className="ed-hosts" aria-label="Hosts">
            <span className="ed-label">Hosted by</span>
            {details.hosts.map((host, i) => (
              <span className="kb-chip" key={i}>
                {host}
              </span>
            ))}
          </div>
        )}
        {registration && (
          <GlassCard className="ed-registration" interactive>
            <a
              href={registration.href}
              target="_blank"
              rel="noopener noreferrer"
              className="ed-preview"
              aria-label={`${preview?.title || (isLuma ? "Luma event page" : "Event page")} ${isLuma ? "(opens Luma in a new tab)" : "(opens in a new tab)"}`}
            >
              {preview?.image && <Image src={preview.image} alt="" width={960} height={540} unoptimized />}
              <span className="ed-preview-text">
                <span className="ed-label">{preview?.siteName || (ended ? "Event" : "Registration")}</span>
                <strong>
                  {preview?.title || (isLuma ? "Luma event page" : "Event page")}{" "}
                  <ExternalIcon size={14} aria-hidden="true" />
                </strong>
                <span className="ed-domain">{registration.domain}</span>
              </span>
            </a>
          </GlassCard>
        )}
        {details.where && <Venue key={details.where} where={details.where} />}
        {links.length > 0 && (
          <div className="ed-links" aria-label="Extra links">
            {links.map((link, i) => {
              const safe = visibleLink(link.url);
              return (
                safe && (
                  <a className="kb-chip kb-link" key={i} href={safe.href} target="_blank" rel="noopener noreferrer">
                    {link.label} <span className="ed-domain">{safe.domain}</span>
                  </a>
                )
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
