import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";
import { getPost, posts } from "@/lib/posts";
import { getT } from "@/lib/i18n";

type Params = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return posts.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return { title: "Blog — ArtixCloud" };
  const t = await getT();
  return { title: `${t(`blog.post.${post.slug}.title`)} — ArtixCloud` };
}

export default async function PostPage({ params }: Params) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();

  const t = await getT();
  const body = Array.from({ length: post.bodyCount }, (_, i) =>
    t(`blog.post.${post.slug}.body${i + 1}`),
  );

  return (
    <>
      <SiteHeader />
      <article className="mx-auto w-full max-w-3xl px-6 py-16 sm:py-20">
        <Link
          href="/blog"
          className="inline-flex items-center gap-1.5 text-sm text-white/55 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("blog.back")}
        </Link>

        <p className="mt-8 text-sm font-medium text-white/45">
          {t(`blog.post.${post.slug}.category`)} · {post.readTime}
        </p>
        <h1 className="mt-2 text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
          {t(`blog.post.${post.slug}.title`)}
        </h1>
        <div className="mt-4 flex items-center gap-3 text-sm text-white/45">
          <span>{t("blog.author")}</span>
          <span className="h-1 w-1 rounded-full bg-white/30" />
          <span>{t(`blog.post.${post.slug}.date`)}</span>
        </div>

        <div className="mt-10 space-y-5">
          {body.map((p, i) => (
            <p key={i} className="text-pretty leading-relaxed text-white/70">
              {p}
            </p>
          ))}
        </div>

        <div className="mt-14 rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.08] to-white/[0.02] p-8 text-center">
          <h2 className="text-xl font-semibold tracking-tight">
            {t("blog.cta.title")}
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-white/60">
            {t("blog.cta.subtitle")}
          </p>
          <Link
            href="/register"
            className="mt-6 inline-flex h-11 items-center justify-center rounded-full bg-white px-6 text-sm font-medium text-black transition-colors hover:bg-white/85"
          >
            {t("blog.cta.button")}
          </Link>
        </div>
      </article>
      <Footer />
    </>
  );
}
