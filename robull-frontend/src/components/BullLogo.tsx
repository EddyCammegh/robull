// Full-body 8-bit pixel art bull — FRONT-FACING, angry & macho
// Wide horns · V-shaped fury brow · barrel chest cream patch
// Gold ∞ nose ring · four thick legs · solid hooves
// 24 × 24 pixel grid rendered as SVG rects

export default function BullLogo({ size = 40 }: { size?: number }) {
  // 0 = transparent
  // 1 = #ff4400  fire orange (main body)
  // 2 = #cc2200  deep red  (horns, shading)
  // 3 = #f5e0c0  cream     (chest patch, eye whites)
  // 4 = #1a0800  near-black (hooves, pupils, nostrils)
  // 5 = #882200  dark red  (V-brow anger lines)
  // 6 = #ffcc00  gold      (∞ nose ring)
  // 8 = #dd3300  medium red (snout / muzzle)
  const palette: Record<number, string> = {
    1: '#ff4400',
    2: '#cc2200',
    3: '#f5e0c0',
    4: '#1a0800',
    5: '#882200',
    6: '#ffcc00',
    8: '#dd3300',
  };

  // 24 columns (x=0 left … x=23 right) × 24 rows (y=0 top … y=23 bottom)
  // Bull faces CAMERA — symmetrical, charging stance
  const pixels = [
    // row 0 — horn tips (far left, far right)
    [0,0,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,0,0],
    // row 1 — horn shafts angling inward
    [0,2,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,2,0,0],
    // row 2 — horns base + forehead block
    [2,2,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,0,0,2,2,0,0],
    // row 3 — full skull width
    [0,2,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,2,0,0,0],
    // row 4 — ANGRY V-BROW: dark red flanks + slit pupils
    [0,0,5,5,1,1,4,1,1,1,1,1,1,1,1,4,1,1,5,5,0,0,0,0],
    // row 5 — eye whites (cream) recessed below brow
    [0,0,0,1,1,3,3,1,1,1,1,1,1,1,3,3,1,1,1,0,0,0,0,0],
    // row 6 — mid-face / broad cheeks
    [0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0],
    // row 7 — muzzle top (dark red block)
    [0,0,0,0,1,8,8,8,8,8,8,8,8,8,8,8,8,8,1,0,0,0,0,0],
    // row 8 — nostrils (4) + gold infinity ring (6)
    [0,0,0,0,1,8,4,8,8,6,6,6,6,6,8,8,4,8,1,0,0,0,0,0],
    // row 9 — muzzle bottom
    [0,0,0,0,1,8,8,8,8,8,8,8,8,8,8,8,8,8,1,0,0,0,0,0],
    // row 10 — thick neck
    [0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0],
    // row 11 — neck-chest join (cream patch begins)
    [0,0,0,1,1,1,1,1,3,3,3,3,3,3,1,1,1,1,1,0,0,0,0,0],
    // row 12 — barrel chest widens
    [0,0,1,1,1,1,3,3,3,3,3,3,3,3,3,3,1,1,1,1,0,0,0,0],
    // row 13 — MAX chest width (imposing mass)
    [0,1,1,1,1,1,3,3,3,3,3,3,3,3,3,3,3,1,1,1,1,0,0,0],
    // row 14 — body (still wide)
    [0,1,1,1,1,3,3,3,3,3,3,3,3,3,3,3,3,3,1,1,1,0,0,0],
    // row 15 — body lower
    [0,0,1,1,1,1,3,3,3,3,3,3,3,3,3,1,1,1,1,1,0,0,0,0],
    // row 16 — belly
    [0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0],
    // row 17 — belly bottom / leg roots (3 groups: outer·gap·inner·gap·outer)
    [0,0,0,0,2,1,1,0,0,2,2,2,2,0,0,1,1,2,0,0,0,0,0,0],
    // row 18 — upper legs
    [0,0,0,0,1,2,1,0,0,1,2,2,1,0,0,1,2,1,0,0,0,0,0,0],
    // row 19 — mid legs (alternating shading = depth)
    [0,0,0,0,2,1,2,0,0,2,1,1,2,0,0,2,1,2,0,0,0,0,0,0],
    // row 20 — lower legs
    [0,0,0,0,1,2,1,0,0,1,2,2,1,0,0,1,2,1,0,0,0,0,0,0],
    // row 21 — lower legs 2
    [0,0,0,0,2,1,2,0,0,2,1,1,2,0,0,2,1,2,0,0,0,0,0,0],
    // row 22 — hoof tops
    [0,0,0,0,4,4,4,0,0,4,4,4,4,0,0,4,4,4,0,0,0,0,0,0],
    // row 23 — solid hooves
    [0,0,0,0,4,4,4,0,0,4,4,4,4,0,0,4,4,4,0,0,0,0,0,0],
  ];

  const px = size / 24;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="pixel flex-shrink-0"
      aria-label="Robull — front-facing charging bull with infinity nose ring"
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
