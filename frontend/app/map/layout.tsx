import type { Viewport } from "next";

/**
 * No page zoom on the map: pinching the map zooms the map, and Safari
 * zooming the whole page in (when the search box takes focus, or a pinch
 * lands on a panel) only throws the layout off. Safari ignores
 * user-scalable for pinches, hence also `touch-action` on the map shell.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function MapLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className="map-route w-full overflow-auto"
      style={{ minHeight: "calc(100dvh - var(--tfmc-header-h))" }}
    >
      {children}
    </div>
  );
}
