import { useEffect, useState } from "react";

/// A QR code for `value`, drawn as an SVG image inside the reserved `.ae-qr` plate (white,
/// fixed aspect ratio, so the dialog does not jump when the code arrives). The encoder is
/// loaded on demand - it is only needed on the two-step setup screen - and runs in the
/// browser: the secret it encodes is never sent to any other service.
export function QrCode({ value, label }: { value: string; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    import("qrcode")
      .then((qr) => qr.toString(value, { type: "svg", margin: 0, errorCorrectionLevel: "M" }))
      .then((svg) => !cancelled && setSrc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [value]);

  if (failed) return null; // the typed key shown beside it still works
  return <div className="ae-qr">{src && <img src={src} alt={label} />}</div>;
}
