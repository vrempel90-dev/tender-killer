/**
 * QR-код как SVG. Путь рассчитан на сервере (src/lib/auth/mfa/qr.ts),
 * здесь только разметка — готовый HTML в документ не вставляется.
 */
export function MfaQr({
  size,
  path,
  label,
}: {
  size: number;
  path: string;
  label: string;
}) {
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      className="size-44 shrink-0 rounded-lg border border-ink-200 bg-white p-1"
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#101828" />
    </svg>
  );
}
