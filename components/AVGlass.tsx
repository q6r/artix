"use client";

import s from "./AVGlas.module.css";

const parts = [
  "av-a-left",
  "av-a-right",
  "av-v-left",
  "av-v-right",
];

const sparks = [
  { path: "av-a-left", color: "#ffffff", r: 3.2, dur: "2.2s", begin: "-0.2s" },
  { path: "av-a-right", color: "#ff7a68", r: 2.4, dur: "2.8s", begin: "-1.4s" },
  { path: "av-v-left", color: "#8ea7ff", r: 2.7, dur: "2.4s", begin: "-0.8s" },
  { path: "av-v-right", color: "#ffffff", r: 3.0, dur: "2.6s", begin: "-1.8s" },
];

export default function AVGlassLogo() {
  return (
    <div className={s.wrap}>
      <svg
        className={s.svg}
        viewBox="0 0 702 416"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        shapeRendering="geometricPrecision"
      >
        <defs>
          {/* Paths do logo */}
          <path id="av-a-left" d="M225 262 L318 103" />
          <path id="av-a-right" d="M318 103 L395 262" />
          <path id="av-v-left" d="M371 103 L454 274" />
          <path id="av-v-right" d="M454 274 L536 103" />

          {/* Corpo de vidro */}
          <linearGradient
            id="av-body"
            x1="220"
            y1="260"
            x2="540"
            y2="100"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#11151d" />
            <stop offset="22%" stopColor="#f4f4f4" />
            <stop offset="38%" stopColor="#545b78" />
            <stop offset="55%" stopColor="#ffffff" />
            <stop offset="72%" stopColor="#252a46" />
            <stop offset="100%" stopColor="#ffffff" />
          </linearGradient>

          {/* Reflexo colorido/prismático */}
          <linearGradient
            id="av-prism"
            x1="220"
            y1="100"
            x2="540"
            y2="275"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="18%" stopColor="#ff8b62" />
            <stop offset="35%" stopColor="#8ca6ff" />
            <stop offset="52%" stopColor="#ffffff" />
            <stop offset="70%" stopColor="#b267ff" />
            <stop offset="86%" stopColor="#6ee7ff" />
            <stop offset="100%" stopColor="#ffffff" />
          </linearGradient>

          {/* Linha branca quente */}
          <linearGradient
            id="av-hot"
            x1="220"
            y1="100"
            x2="540"
            y2="275"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="transparent" />
            <stop offset="35%" stopColor="#ffffff" />
            <stop offset="50%" stopColor="#ffffff" />
            <stop offset="65%" stopColor="#b7c5ff" />
            <stop offset="100%" stopColor="transparent" />
          </linearGradient>

          {/* Bloom/glow dos brilhos */}
          <filter id="av-bloom" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="2.2" result="blur" />
            <feColorMatrix
              in="blur"
              type="matrix"
              values="
                1.4 0   0   0 0
                0   1.4 0   0 0
                0   0   1.8 0 0
                0   0   0   0.9 0
              "
              result="glow"
            />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Distorção leve de vidro */}
          <filter id="av-warp" x="-40%" y="-40%" width="180%" height="180%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.75"
              numOctaves="2"
              seed="8"
              result="noise"
            >
              <animate
                attributeName="baseFrequency"
                values="0.65;0.95;0.65"
                dur="4.56s"
                repeatCount="indefinite"
              />
            </feTurbulence>

            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale="0.8"
              xChannelSelector="R"
              yChannelSelector="B"
            />
          </filter>
        </defs>

        <g className={s.logo}>
          {/* Sombra/vidro apagado */}
          <g filter="url(#av-warp)">
            {parts.map((id) => (
              <use
                key={`shadow-${id}`}
                href={`#${id}`}
                className={`${s.seg} ${s.shadow}`}
              />
            ))}

            {parts.map((id) => (
              <use
                key={`body-${id}`}
                href={`#${id}`}
                className={`${s.seg} ${s.body}`}
              />
            ))}

            {parts.map((id) => (
              <use
                key={`edge-${id}`}
                href={`#${id}`}
                className={`${s.seg} ${s.edge}`}
              />
            ))}
          </g>

          {/* Aberração cromática nas bordas */}
          {parts.map((id) => (
            <use
              key={`red-${id}`}
              href={`#${id}`}
              className={`${s.seg} ${s.rgbRed}`}
            />
          ))}

          {parts.map((id) => (
            <use
              key={`blue-${id}`}
              href={`#${id}`}
              className={`${s.seg} ${s.rgbBlue}`}
            />
          ))}

          {/* Reflexos andando pela linha */}
          <g filter="url(#av-bloom)" className={s.screen}>
            {parts.map((id) => (
              <use
                key={`hot-a-${id}`}
                href={`#${id}`}
                className={`${s.seg} ${s.hot} ${s.hotA}`}
              />
            ))}

            {parts.map((id) => (
              <use
                key={`hot-b-${id}`}
                href={`#${id}`}
                className={`${s.seg} ${s.hot} ${s.hotB}`}
              />
            ))}

            {parts.map((id) => (
              <use
                key={`prism-${id}`}
                href={`#${id}`}
                className={`${s.seg} ${s.prism}`}
              />
            ))}
          </g>

          {/* Pontinhos/specular highlights viajando */}
          <g filter="url(#av-bloom)" className={s.screen}>
            {sparks.map((spark, index) => (
              <circle
                key={index}
                r={spark.r}
                fill={spark.color}
                className={s.spark}
              >
                <animateMotion
                  dur={spark.dur}
                  begin={spark.begin}
                  repeatCount="indefinite"
                  rotate="auto"
                >
                  <mpath href={`#${spark.path}`} />
                </animateMotion>
              </circle>
            ))}
          </g>
        </g>
      </svg>
    </div>
  );
}