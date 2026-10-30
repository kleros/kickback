import { linkPreview } from "@/features/event/info/preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    return Response.json(await linkPreview(new URL(request.url).searchParams.get("url") ?? ""), {
      headers: { "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" },
    });
  } catch {
    return Response.json({ error: "Preview unavailable." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
