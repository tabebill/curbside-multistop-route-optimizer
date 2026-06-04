import { PinWorkspace } from "@/components/pin-workspace";

export default function Home() {
  const googleMapsBrowserKey =
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY ??
    process.env.GOOGLE_MAPS_API_KEY ??
    "";

  return <PinWorkspace googleMapsBrowserKey={googleMapsBrowserKey} />;
}
