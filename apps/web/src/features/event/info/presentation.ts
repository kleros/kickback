import type { RegistrationPreview } from "@/lib/event-details";

import { dominantColour } from "../model/eventDetails";

export async function fetchRegistrationPreview(url: string, fetcher = globalThis.fetch): Promise<RegistrationPreview> {
  const response = await fetcher(`/api/preview?url=${encodeURIComponent(url)}`);
  if (!response.ok) throw new Error("Preview unavailable.");
  const data: unknown = await response.json();
  if (!data || typeof data !== "object") throw new Error("Invalid preview.");
  const value = data as Record<string, unknown>;
  return {
    title: typeof value.title === "string" ? value.title : "",
    siteName: typeof value.siteName === "string" ? value.siteName : "",
    image: typeof value.image === "string" && value.image.startsWith("/api/preview/image?url=") ? value.image : null,
  };
}

export function coverColour(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 32;
        const context = canvas.getContext("2d");
        if (!context) return resolve(null);
        context.drawImage(image, 0, 0, 32, 32);
        resolve(dominantColour(context.getImageData(0, 0, 32, 32).data));
      } catch {
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = url;
  });
}
