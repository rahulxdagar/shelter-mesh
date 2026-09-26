import { NextResponse, type NextRequest } from "next/server";

// Nominatim reverse geocoding (free; usage policy requires a UA and ≤1 req/s — responses are cached).
const cache = new Map<string, { address: string; at: number }>();

export async function GET(req: NextRequest) {
  const lat = Number(req.nextUrl.searchParams.get("lat"));
  const lng = Number(req.nextUrl.searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "lat and lng are required" }, { status: 400 });
  }
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 86_400_000) return NextResponse.json({ address: hit.address });

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&lat=${lat}&lon=${lng}`,
      {
        headers: { "User-Agent": "Cold-Grid/1.0 (Ottawa shelter triage)", "Accept-Language": "en-CA" },
        signal: AbortSignal.timeout(6000),
      },
    );
    if (!res.ok) throw new Error(`Geocoder upstream ${res.status}`);
    const d = await res.json();
    const a = d.address ?? {};
    const street = [a.house_number, a.road].filter(Boolean).join(" ");
    const area = a.neighbourhood || a.suburb || a.quarter || a.city_district;
    const city = a.city || a.town || a.village;
    const address = [street || d.name, area, city].filter(Boolean).join(", ") || d.display_name;
    if (!address) throw new Error("No address at this location");
    cache.set(key, { address, at: Date.now() });
    return NextResponse.json({ address });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
