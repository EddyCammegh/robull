// Pixel art 8-bit bull with infinity nose ring, rendered in SVG
export default function BullLogo({ size = 40 }: { size?: number }) {
  // Each row is 16 pixels wide, each value is a colour index:
  // 0=transparent, 1=body (#ff4400), 2=dark (#cc3600), 3=white, 4=black, 5=gold (#f59e0b)
  const palette: Record<number, string> = {
    1: '#ff4400',
    2: '#cc3600',
    3: '#f0f0f0',
    4: '#111111',
    5: '#f59e0b',
  };

  const pixels = [
    [0,0,0,0,1,1,0,0,0,0,1,1,0,0,0,0],
    [0,0,0,1,1,1,0,0,0,0,1,1,1,0,0,0],
    [0,0,1,1,2,1,1,0,0,1,1,2,1,1,0,0],
    [0,1,1,2,2,2,1,1,1,1,2,2,2,1,1,0],
    [1,1,2,2,1,2,2,1,1,2,2,1,2,2,1,1],
    [1,2,2,1,1,1,2,2,2,2,1,1,1,2,2,1],
    [0,1,2,1,3,1,2,2,2,2,1,3,1,2,1,0],
    [0,0,1,1,1,1,2,2,2,2,1,1,1,1,0,0],
    [0,0,0,1,2,2,2,4,4,2,2,2,1,0,0,0],
    [0,0,0,1,1,2,2,5,5,2,2,1,1,0,0,0],
    [0,0,0,0,1,1,5,5,5,5,1,1,0,0,0,0],
    [0,0,0,0,0,5,5,0,0,5,5,0,0,0,0,0],
    [0,0,0,0,1,1,1,0,0,1,1,1,0,0,0,0],
    [0,0,0,1,1,0,1,0,0,1,0,1,1,0,0,0],
    [0,0,1,1,0,0,1,0,0,1,0,0,1,1,0,0],
    [0,1,1,0,0,0,0,0,0,0,0,0,0,1,1,0],
  ];

  const px = size / 16;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="pixel flex-shrink-0"
      aria-label="Robull bull logo"
    >
      {pixels.flatMap((row, y) =>
        row.map((cell, x) =>
          cell !== 0 ? (
            <rect
              key={`${x}-${y}`}
              x={x * px}
              y={y * px}
              width={px}
              height={px}
              fill={palette[cell]}
            />
          ) : null
        )
      )}
    </svg>
  );
}
