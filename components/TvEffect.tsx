// Old-TV / CRT overlay: animated static noise, scanlines, a rolling
// scan bar, a subtle flicker and a vignette. Pure CSS — render it on top
// of whatever you want to give the retro-broadcast look.

const NOISE_SVG = encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'>
     <filter id='n'>
       <feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/>
       <feColorMatrix type='saturate' values='0'/>
     </filter>
     <rect width='100%' height='100%' filter='url(#n)'/>
   </svg>`,
);

export default function TvEffect() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Static / grain dots */}
      <div
        className="tv-noise absolute -inset-1/2"
        style={{ backgroundImage: `url("data:image/svg+xml,${NOISE_SVG}")` }}
      />
      {/* Horizontal scanlines */}
      <div className="tv-scanlines absolute inset-0" />
    </div>
  );
}
