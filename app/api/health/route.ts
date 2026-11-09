export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    status: "ok",
    release: process.env.RELEASE_SHA ?? "dev",
    time: new Date().toISOString(),
  });
}
