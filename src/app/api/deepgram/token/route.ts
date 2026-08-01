import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Mints a short-lived Deepgram JWT so the browser never sees DEEPGRAM_API_KEY. */
export async function GET() {
  const apiKey = process.env.DEEPGRAM_API_KEY?.trim() ?? "";

  if (!apiKey) {
    return NextResponse.json(
      { error: "DEEPGRAM_API_KEY is not set in .env.local" },
      { status: 503 },
    );
  }

  try {
    const res = await fetch("https://api.deepgram.com/v1/auth/grant", {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "application/json",
      },
      // Deepgram default TTL is 30s; keep short-lived for the browser.
      body: JSON.stringify({ ttl_seconds: 30 }),
    });

    const rawText = await res.text();
    let body: {
      access_token?: string;
      error?: string;
      message?: string;
      err_msg?: string;
      err_code?: string;
    } = {};
    try {
      body = JSON.parse(rawText) as typeof body;
    } catch {
      body = { message: rawText.slice(0, 200) };
    }

    if (!res.ok || !body.access_token) {
      const detail =
        body.err_msg ||
        body.error ||
        body.message ||
        body.err_code ||
        `Deepgram grant failed (${res.status})`;
      return NextResponse.json(
        {
          error:
            res.status === 403
              ? `${detail}. Use a Member (or higher) API key from console.deepgram.com`
              : detail,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({ access_token: body.access_token });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Deepgram grant request failed",
      },
      { status: 502 },
    );
  }
}
