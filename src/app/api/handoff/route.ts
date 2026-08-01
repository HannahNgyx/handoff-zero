import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Server Client-Credentials API removed for Phase 3.
 * Transmit / Accept / list now run on the authenticated browser MedplumClient
 * (SignIn + useSubscription). Add MEDPLUM_CLIENT_SECRET later if you need bots.
 */
export async function GET() {
  return NextResponse.json(
    {
      error:
        "Handoff reads moved to the Medplum client. Sign in on /ems or /hospital.",
    },
    { status: 410 },
  );
}

export async function POST() {
  return NextResponse.json(
    {
      error:
        "Handoff writes moved to the Medplum client. Sign in and use Transmit / Accept in the UI.",
    },
    { status: 410 },
  );
}
