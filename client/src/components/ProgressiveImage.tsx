import { useState, type CSSProperties } from "react";

interface ProgressiveImageProps {
  /// Full-resolution asset to load in the background.
  src: string;
  alt: string;
  /// A tiny, already-downloaded low-quality thumbnail (a data: URI is the
  /// common case - a few hundred bytes, inlined so it paints on the very
  /// first frame with no network round trip of its own) shown blurred
  /// behind the real image until it finishes loading.
  placeholderSrc?: string;
  /// Dominant-color fallback for when there's no LQIP thumbnail at all
  /// (e.g. the color was computed server-side and stored instead of a
  /// thumbnail) - just a solid tint behind the fade-in rather than a blur.
  placeholderColor?: string;
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  className?: string;
  style?: CSSProperties;
}

/**
 * Blur-up progressive image (Section: Loading system). Renders instantly
 * with a placeholder - a blurred tiny thumbnail, or failing that a flat
 * dominant-color block - and cross-fades to the full asset once it's
 * actually finished downloading, so a slow connection shows *something*
 * shaped and colored like the real photo immediately instead of a blank
 * box that pops in all at once whenever the network gets around to it.
 *
 * Driven entirely by the native `<img onLoad>` event and CSS
 * transitions/opacity (`.ae-progressive-img-*`, index.css) - no polling, no
 * IntersectionObserver-driven state loop, nothing that touches the main
 * thread beyond the one load event.
 *
 * Currently unused: this app has no photographic assets yet (Products,
 * Receipts, etc. are all text/SVG) - built ahead of that need so a product
 * photo, user avatar, or similar can drop straight into this instead of a
 * bare `<img>` once one exists.
 */
export function ProgressiveImage({
  src,
  alt,
  placeholderSrc,
  placeholderColor = "var(--ae-bg-alt)",
  width,
  height,
  radius = 4,
  className = "",
  style,
}: ProgressiveImageProps) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div
      className={`ae-progressive-img-wrap ${className}`.trim()}
      style={{ width, height, borderRadius: radius, background: placeholderColor, ...style }}
    >
      {placeholderSrc && (
        <img
          aria-hidden="true"
          alt=""
          src={placeholderSrc}
          className="ae-progressive-img-placeholder"
          style={{ opacity: loaded ? 0 : 1 }}
        />
      )}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        className={`ae-progressive-img-full${loaded ? " is-loaded" : ""}`}
      />
    </div>
  );
}
