import Image from "next/image";
import { getT } from "@/lib/i18n";

type Testimonial = {
  quote: string;
  name: string;
  role: string;
  ceo?: boolean;
  avatar: string;
};

const testimonials: Testimonial[] = [
  {
    quote: "home.testimonials.q1",
    name: "Trusty",
    role: "home.testimonials.role1",
    avatar: "https://cdn.discordapp.com/avatars/1390335640079433889/18058f2711e083ea0fc9b1b352bab389.png?size=128",
  },
  {
    quote: "home.testimonials.q2",
    name: "clash",
    role: "home.testimonials.role2",
    avatar: "https://cdn.discordapp.com/avatars/1053167468832636949/a_17d3f92a8425e4a26797d69e60b210a1.png?size=128",
  },
  {
    quote: "home.testimonials.q3",
    name: "indra",
    role: "home.testimonials.role3",
    avatar: "https://cdn.discordapp.com/avatars/1289607530586312715/d00732aa5ec7690e6844493bd4addb37.png?size=128",
  },
  {
    quote: "home.testimonials.q4",
    name: "drg",
    role: "home.testimonials.role4",
    avatar: "https://cdn.discordapp.com/avatars/439443452107816963/7003c00fffcf35199ca66b011ffc4106.png?size=128",
  },
  {
    quote: "home.testimonials.q5",
    name: "Kurt Cobain",
    role: "home.testimonials.role5",
    avatar: "https://cdn.discordapp.com/avatars/1044800961618661386/0f0466ef590732c75c4106032ff9d6f3.png?size=128",
  },
  {
    quote: "home.testimonials.q6",
    name: "brunno",
    role: "CEO",
    ceo: true,
    avatar: "https://cdn.discordapp.com/avatars/73598582153805824/cd34b8880beb83efca4341db4f99bc5f.png?size=128",
  },
  {
    quote: "home.testimonials.q7",
    name: "Pillochh",
    role: "CEO",
    ceo: true,
    avatar: "https://cdn.discordapp.com/avatars/240555269673844737/cb64de41282e7af12ae73ee64048feb8.png?size=128",
  },
];

function TestimonialCard({
  t,
  translate,
}: {
  t: Testimonial;
  translate: (key: string) => string;
}) {
  return (
    <figure className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-sm">
      <blockquote className="text-sm leading-relaxed text-white/70">
        “{translate(t.quote)}”
      </blockquote>
      <figcaption className="mt-5 flex items-center gap-3">
        <Image
          src={t.avatar}
          alt={t.name}
          width={40}
          height={40}
          className="h-10 w-10 shrink-0 rounded-full object-cover"
        />
        <span className="flex flex-col">
          <span className="text-sm font-medium text-white">{t.name}</span>
          <span className="text-xs text-white/50">{t.ceo ? t.role : translate(t.role)}</span>
        </span>
      </figcaption>
    </figure>
  );
}

function Column({
  items,
  direction,
  duration,
  className = "",
  translate,
}: {
  items: Testimonial[];
  direction: "up" | "down";
  duration: number;
  className?: string;
  translate: (key: string) => string;
}) {
  // Duplicate the list so the vertical loop is seamless.
  const loop = [...items, ...items];
  return (
    <div className={`marquee-col ${className}`}>
      <div
        className={
          direction === "up" ? "animate-marquee-up" : "animate-marquee-down"
        }
        style={{ ["--marquee-duration" as string]: `${duration}s` }}
      >
        <div className="flex flex-col gap-4 pb-4">
          {loop.map((t, i) => (
            <TestimonialCard key={`${t.name}-${i}`} t={t} translate={translate} />
          ))}
        </div>
      </div>
    </div>
  );
}

export default async function Testimonials() {
  const t = await getT();
  const pick = (...xs: (Testimonial | undefined)[]) =>
    xs.filter((x): x is Testimonial => !!x);
  const col1 = pick(testimonials[0], testimonials[3], testimonials[6]);
  const col2 = pick(testimonials[1], testimonials[4], testimonials[7]);
  const col3 = pick(testimonials[2], testimonials[5], testimonials[8]);

  return (
    <section
      id="depoimentos"
      className="mx-auto w-full max-w-6xl scroll-mt-24 px-6 py-24"
    >
      <div className="mb-12 flex flex-col items-center text-center">
        <span className="mb-5 inline-flex items-center rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-medium text-white/70">
          {t("home.testimonials.badge")}
        </span>
        <h2 className="text-3xl font-semibold tracking-tight sm:text-5xl">
          {t("home.testimonials.heading")}
        </h2>
        <p className="mt-3 text-white/60">{t("home.testimonials.sub")}</p>
      </div>

      <div
        className="relative grid h-[600px] grid-cols-1 gap-4 overflow-hidden sm:grid-cols-2 lg:grid-cols-3"
        style={{
          maskImage:
            "linear-gradient(to bottom, transparent, black 12%, black 88%, transparent)",
          WebkitMaskImage:
            "linear-gradient(to bottom, transparent, black 12%, black 88%, transparent)",
        }}
      >
        <Column items={col1} direction="up" duration={36} translate={t} />
        <Column
          items={col2}
          direction="down"
          duration={44}
          className="hidden sm:block"
          translate={t}
        />
        <Column
          items={col3}
          direction="up"
          duration={40}
          className="hidden lg:block"
          translate={t}
        />
      </div>
    </section>
  );
}
