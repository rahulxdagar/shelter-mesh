import { NextResponse, type NextRequest } from "next/server";

// Free OSRM routing: walking via FOSSGIS (routing.openstreetmap.de), driving via the OSRM demo server.
const ENDPOINTS = {
  foot: "https://routing.openstreetmap.de/routed-foot/route/v1/foot",
  car: "https://router.project-osrm.org/route/v1/driving",
} as const;

type OsrmStep = {
  distance: number;
  duration: number;
  name: string;
  maneuver: { type: string; modifier?: string; exit?: number; bearing_after?: number };
};

const COMPASS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];
const heading = (deg?: number) => (deg == null ? null : COMPASS[Math.round(deg / 45) % 8]);

function coord(v: string | null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function instruction(step: OsrmStep): string {
  const { type, modifier, exit, bearing_after } = step.maneuver;
  const road = step.name ? ` onto ${step.name}` : " onto the path";
  switch (type) {
    case "depart":
      return `Head ${heading(bearing_after) ?? "out"}${step.name ? ` on ${step.name}` : ""}`;
    case "arrive":
      return "Arrive at destination";
    case "roundabout":
    case "rotary":
      return `At the roundabout, take exit ${exit ?? ""}${road}`.replace("  ", " ");
    case "turn":
    case "end of road":
    case "fork":
      if (modifier === "straight") return `Continue straight${road}`;
      if (modifier?.startsWith("slight ")) return `Bear ${modifier.slice(7)}${road}`;
      if (modifier === "uturn") return `Make a U-turn${road}`;
      return `Turn ${modifier ?? ""}${road}`.replace("  ", " ");
    case "continue":
    case "new name":
      return `Continue ${modifier && modifier !== "straight" ? modifier : "straight"}${road}`;
    default:
      return `${modifier ? `Go ${modifier}` : "Continue"}${road}`;
  }
}

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const profile = p.get("profile") === "car" ? "car" : "foot";
  const from = [coord(p.get("fromLng")), coord(p.get("fromLat"))];
  const to = [coord(p.get("toLng")), coord(p.get("toLat"))];
  if ([...from, ...to].some((v) => v === null)) {
    return NextResponse.json({ error: "fromLat, fromLng, toLat and toLng are required" }, { status: 400 });
  }

  const url = `${ENDPOINTS[profile]}/${from.join(",")};${to.join(",")}?overview=full&geometries=geojson&steps=true`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Cold-Grid/1.0 (Ottawa shelter triage)" },
      signal: AbortSignal.timeout(8000),
      next: { revalidate: 300 },
    });
    if (!res.ok) throw new Error(`Routing upstream ${res.status}`);
    const data = await res.json();
    const r = data.routes?.[0];
    if (!r) throw new Error("No route found");
    const steps = (r.legs?.[0]?.steps ?? []) as OsrmStep[];
    return NextResponse.json({
      distance_m: r.distance,
      duration_s: r.duration,
      geometry: r.geometry.coordinates as [number, number][],
      steps: steps
        .filter((s) => s.distance > 0 || s.maneuver.type === "arrive")
        .map((s) => ({ text: instruction(s), distance_m: s.distance, type: s.maneuver.type, modifier: s.maneuver.modifier ?? null })),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
