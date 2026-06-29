import type { Metadata } from "next";
import Link from "next/link";
import styles from "./not-found.module.css";

export const metadata: Metadata = {
  title: "404 — ArtixCloud",
};

export default function NotFound() {
  return (
    <main className={styles.page}>
      <section className={styles.wrapper}>
        <svg
          className={styles.art}
          viewBox="0 0 900 340"
          role="img"
          aria-label="Erro 404 — página não encontrada"
        >
          <defs>
            {/* Distressed, watercolor-ish edges for the numbers */}
            <filter id="roughText" x="-10%" y="-10%" width="120%" height="120%">
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.012 0.03"
                numOctaves="4"
                seed="7"
                result="noise"
              />
              <feDisplacementMap
                in="SourceGraphic"
                in2="noise"
                scale="7"
                xChannelSelector="R"
                yChannelSelector="G"
              />
            </filter>

            <filter id="inkBleed" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="6" />
            </filter>

            {/* Gentle, LOW-frequency wobble: big smooth waves = organic blob
                edge (not high-freq static), then a soft blur for the bleed. */}
            <filter id="wobble" x="-60%" y="-60%" width="220%" height="220%">
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.006"
                numOctaves="2"
                seed="6"
                result="n"
              />
              <feDisplacementMap in="SourceGraphic" in2="n" scale="16" result="d" />
              <feGaussianBlur in="d" stdDeviation="2.4" />
            </filter>

            <filter id="wobbleSoft" x="-80%" y="-80%" width="260%" height="260%">
              <feGaussianBlur stdDeviation="7" />
            </filter>

            {/* Watercolor blob: light center, pigment pooled toward the rim,
                soft fade-out (smooth alpha — reads as water, not noise). */}
            <radialGradient id="washRing" cx="46%" cy="42%" r="58%">
              <stop offset="0%" stopColor="#8a8a8a" stopOpacity="0.06" />
              <stop offset="55%" stopColor="#7a7a7a" stopOpacity="0.14" />
              <stop offset="82%" stopColor="#565656" stopOpacity="0.42" />
              <stop offset="100%" stopColor="#565656" stopOpacity="0" />
            </radialGradient>

            {/* A pigment concentration (soft droplet). */}
            <radialGradient id="washBlob" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#4f4f4f" stopOpacity="0.36" />
              <stop offset="70%" stopColor="#4f4f4f" stopOpacity="0.16" />
              <stop offset="100%" stopColor="#4f4f4f" stopOpacity="0" />
            </radialGradient>

            {/* Tiny ink droplet for the specks. */}
            <radialGradient id="dropGrad" cx="42%" cy="38%" r="60%">
              <stop offset="0%" stopColor="#2b2b2b" stopOpacity="0.85" />
              <stop offset="70%" stopColor="#1c1c1c" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#1c1c1c" stopOpacity="0" />
            </radialGradient>

            {/* Grunge specks that "eat" the ink of the numbers */}
            <mask id="damageMask">
              <rect width="900" height="340" fill="white" />
              <circle cx="225" cy="150" r="26" fill="black" opacity="0.22" />
              <circle cx="350" cy="92" r="30" fill="black" opacity="0.26" />
              <circle cx="300" cy="205" r="34" fill="black" opacity="0.2" />
              <circle cx="600" cy="140" r="22" fill="black" opacity="0.2" />
              <circle cx="700" cy="205" r="34" fill="black" opacity="0.24" />
              <circle cx="640" cy="95" r="20" fill="black" opacity="0.18" />
            </mask>
          </defs>

          {/* Numbers */}
          <g mask="url(#damageMask)">
            <text className={styles.bleed} x="450" y="245" textAnchor="middle" filter="url(#inkBleed)">
              404
            </text>
            <text className={styles.code} x="450" y="245" textAnchor="middle" filter="url(#roughText)">
              404
            </text>
          </g>

          {/* Watercolor "moon" over the top of the middle 0 — translucent
              pigment in water, layered with `multiply` so it sits on the paint. */}
          <g className={styles.wash}>
            {/* soft diffuse bloom underneath */}
            <circle cx="452" cy="120" r="46" fill="url(#washBlob)" filter="url(#wobbleSoft)" />
            {/* main blob: pooled rim, light center, organic edge */}
            <circle cx="452" cy="118" r="58" fill="url(#washRing)" filter="url(#wobble)" />
            {/* pigment concentrations (water settling unevenly) */}
            <circle cx="436" cy="106" r="26" fill="url(#washBlob)" filter="url(#wobble)" />
            <circle cx="472" cy="132" r="20" fill="url(#washBlob)" filter="url(#wobble)" />
            <circle cx="460" cy="100" r="13" fill="url(#washBlob)" filter="url(#wobble)" />
          </g>

          {/* Ink droplets */}
          <g className={styles.wash}>
            <circle cx="86" cy="168" r="4" fill="url(#dropGrad)" filter="url(#wobble)" />
            <circle cx="180" cy="288" r="6" fill="url(#dropGrad)" filter="url(#wobble)" />
            <circle cx="250" cy="78" r="3.5" fill="url(#dropGrad)" filter="url(#wobble)" />
            <circle cx="540" cy="80" r="4" fill="url(#dropGrad)" filter="url(#wobble)" />
            <circle cx="690" cy="70" r="6.5" fill="url(#dropGrad)" filter="url(#wobble)" />
            <circle cx="800" cy="130" r="4.5" fill="url(#dropGrad)" filter="url(#wobble)" />
            <circle cx="120" cy="250" r="4.5" fill="url(#dropGrad)" filter="url(#wobble)" />
          </g>
        </svg>

        <h1 className={styles.title}>OOOPS! WE GONE TOO FAR</h1>
        <p className={styles.subtitle}>No signal here!</p>

        <Link href="/" className={styles.home}>
          ← voltar para o início
        </Link>
      </section>
    </main>
  );
}
