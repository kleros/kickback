import { previewImage } from "@/features/event/info/preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const headers = {
    "Content-Security-Policy": "default-src 'none'",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "public, max-age=3600",
  };
  try {
    const { bytes, mime } = await previewImage(new URL(request.url).searchParams.get("url") ?? "");
    return new Response(new Uint8Array(bytes), { headers: { ...headers, "Content-Type": mime } });
  } catch {
    return Response.json(
      { error: "Preview image unavailable." },
      { status: 400, headers: { ...headers, "Cache-Control": "no-store" } },
    );
  }
}
