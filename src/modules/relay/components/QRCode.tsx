import React, { useMemo, useId } from "react";
import { generateQrMatrix } from "./qr-generator";

export interface QRCodeProps {
  value: string;
  size?: number;
  title?: string;
  description?: string;
  ariaLabel?: string;
  className?: string;
}

export const QRCode: React.FC<QRCodeProps> = ({
  value,
  size = 180,
  title = "Remote Pairing QR Code",
  description = "Scan with your smartphone camera to tether mobile remote control.",
  ariaLabel,
  className = "",
}) => {
  const titleId = useId();
  const descId = useId();

  const { pathData, viewBoxSize } = useMemo(() => {
    if (!value || value.trim().length === 0) {
      return { pathData: "", viewBoxSize: 29 };
    }

    const matrix = generateQrMatrix(value);
    const matrixSize = matrix.length;
    const quietZoneModules = 4;
    const totalSize = matrixSize + quietZoneModules * 2;

    const pathSegments: string[] = [];
    for (let r = 0; r < matrixSize; r++) {
      for (let c = 0; c < matrixSize; c++) {
        if (matrix[r][c]) {
          const x = c + quietZoneModules;
          const y = r + quietZoneModules;
          pathSegments.push(`M${x},${y}h1v1h-1z`);
        }
      }
    }

    return {
      pathData: pathSegments.join(" "),
      viewBoxSize: totalSize,
    };
  }, [value]);

  return (
    <div
      className={`w-[var(--comp-qr-container-size,212px)] h-[var(--comp-qr-container-size,212px)] flex items-center justify-center bg-[var(--comp-qr-bg,#ffffff)] rounded-[var(--comp-qr-radius,6px)] border border-[var(--comp-qr-border,#d1d5db)] shadow-sm shrink-0 ${className}`}
    >
      <svg
        role="img"
        aria-label={ariaLabel || title}
        aria-labelledby={ariaLabel ? undefined : `${titleId} ${descId}`}
        width={size}
        height={size}
        viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
        className="w-[180px] h-[180px] block"
      >
        <title id={titleId}>{title}</title>
        <desc id={descId}>{description}</desc>
        <rect
          width={viewBoxSize}
          height={viewBoxSize}
          fill="var(--comp-qr-bg, #ffffff)"
        />
        {pathData ? (
          <path d={pathData} fill="var(--comp-qr-fg, #090d16)" />
        ) : (
          <text
            x={viewBoxSize / 2}
            y={viewBoxSize / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="var(--comp-qr-fg, #090d16)"
            className="text-[3px] font-mono"
          >
            No URL
          </text>
        )}
      </svg>
    </div>
  );
};
