"use client";

import { useEffect, useMemo, useState } from "react";

import { eventCoverObjectUrl, eventDetailsFromCase, fetchEventInfo, renderCase, type EventCover } from "@kickback/core";
import { useQuery } from "@tanstack/react-query";
import { zeroAddress } from "viem";

import { visibleLink } from "@/lib/event-details";

import type { KickbackEvent } from "../api/useEvent";
import { coverColour, fetchRegistrationPreview } from "../info/presentation";
import { contractTint } from "../model/eventDetails";

export function useVerifiedCover(cover: EventCover | undefined) {
  const [loaded, setLoaded] = useState<{ path: string; url: string; colour: string | null }>();
  const path = cover?.path,
    mime = cover?.mime,
    bytes = cover?.bytes;
  useEffect(() => {
    if (!path || !mime || !bytes) return;
    let cancelled = false;
    let objectUrl: string | undefined;
    void eventCoverObjectUrl({ path, mime, bytes })
      .then(async (url) => {
        objectUrl = url;
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        setLoaded({ path, url, colour: null });
        const colour = await coverColour(url);
        if (!cancelled) setLoaded({ path, url, colour });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path, mime, bytes]);
  return loaded?.path === path ? loaded : undefined;
}

export function useEventInfo(event: KickbackEvent) {
  const details = useMemo(
    () => eventDetailsFromCase(renderCase(event.metaEvidenceTemplate, zeroAddress, event.contract)),
    [event.metaEvidenceTemplate, event.contract],
  );
  const info = useQuery({
    queryKey: ["event-info", details.infoPath],
    queryFn: () => fetchEventInfo(details.infoPath!),
    enabled: !!details.infoPath,
    staleTime: Infinity,
    retry: false,
  });
  return { details, info: info.data };
}

/** The on-chain registration link, or the app's known Luma page when the case template carries none. */
export function withRegistrationLink<T extends { link: string | null }>(details: T, lumaUrl: string | undefined): T {
  return details.link || !lumaUrl ? details : { ...details, link: lumaUrl };
}

export function useEventDetails(event: KickbackEvent) {
  const { details: onChain, info } = useEventInfo(event);
  const details = useMemo(() => withRegistrationLink(onChain, event.lumaUrl), [onChain, event.lumaUrl]);
  const cover = useVerifiedCover(info?.cover);
  const link = visibleLink(details.link);
  const preview = useQuery({
    queryKey: ["registration-preview", link?.href],
    queryFn: () => fetchRegistrationPreview(link!.href),
    enabled: !!link,
    staleTime: 60 * 60_000,
    retry: false,
  });
  const tint = cover?.colour ?? contractTint(event.contract);
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--kb-route-tint", tint);
    return () => {
      root.style.removeProperty("--kb-route-tint");
    };
  }, [tint]);
  return {
    details,
    description: info?.description ?? "",
    links: info?.links ?? [],
    coverUrl: cover?.url,
    preview: preview.data,
    tint,
  };
}
