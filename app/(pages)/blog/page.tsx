import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";
import { posts } from "@/lib/posts";
import { getT } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Blog — ArtixCloud",
};

export default async function BlogPage() {
  const t = await getT();
  const [featured, ...rest] = posts;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-20">
        <div className="mb-12 text-center">
          <p className="text-sm font-medium text-white/40">
            {t("blog.eyebrow")}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-5xl">
            {t("blog.title")}
          </h1>
          <p className="mt-3 text-white/60">{t("blog.subtitle")}</p>
        </div>

        {/* Featured */}
        <Link
          href={`/blog/${featured.slug}`}
          className="group block overflow-hidden rounded-3xl border border-white/10 bg-white/[0.02] p-8 transition-colors hover:bg-white/[0.04] sm:p-10"
        >
          <span className="text-xs font-medium text-white/50">
            {t(`blog.post.${featured.slug}.category`)} · {featured.readTime}
          </span>
          <h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight sm:text-3xl">
            {t(`blog.post.${featured.slug}.title`)}
          </h2>
          <p className="mt-3 max-w-2xl text-white/60">
            {t(`blog.post.${featured.slug}.excerpt`)}
          </p>
          <span className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-white">
            {t("blog.readArticle")}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </span>
        </Link>

        {/* Grid */}
        <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {rest.map((p) => (
            <Link
              key={p.slug}
              href={`/blog/${p.slug}`}
              className="group flex flex-col rounded-2xl border border-white/10 bg-white/[0.02] p-6 transition-colors hover:bg-white/[0.04]"
            >
              <span className="text-xs font-medium text-white/50">
                {t(`blog.post.${p.slug}.category`)} · {p.readTime}
              </span>
              <h3 className="mt-3 text-lg font-semibold tracking-tight">
                {t(`blog.post.${p.slug}.title`)}
              </h3>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-white/55">
                {t(`blog.post.${p.slug}.excerpt`)}
              </p>
              <span className="mt-4 text-xs text-white/40">
                {t(`blog.post.${p.slug}.date`)}
              </span>
            </Link>
          ))}
        </div>
      </main>
      <Footer />
    </>
  );
}
