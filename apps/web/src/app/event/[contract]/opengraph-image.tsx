import { ImageResponse } from "next/og";

import { serverEventCard } from "@/features/event/operations/serverEventCard";

export const runtime = "nodejs";
export const alt = "Kickback refundable event deposit";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage({ params }: { params: { contract: string } }) {
  const card = await serverEventCard(params.contract);
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        padding: 72,
        color: "#f8f9ff",
        backgroundColor: "#060a19",
        backgroundImage:
          "radial-gradient(ellipse at 15% 10%, #6c2ff288 0%, transparent 65%), radial-gradient(ellipse at 95% 90%, #3a5ef099 0%, transparent 65%)",
        justifyContent: "space-between",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", fontSize: 28 }}>Kickback</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div
          style={{
            display: "flex",
            fontSize: card.title.length > 90 ? 40 : 60,
            fontWeight: 600,
            lineHeight: 1.1,
            overflow: "hidden",
            maxHeight: 210,
          }}
        >
          {card.title}
        </div>
        <div style={{ display: "flex", fontSize: 28, maxHeight: 72, overflow: "hidden" }}>{card.date}</div>
      </div>
      <div style={{ display: "flex", fontSize: 36 }}>{card.deposit}</div>
    </div>,
    size,
  );
}
