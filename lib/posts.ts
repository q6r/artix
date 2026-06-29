// Structural metadata only. Translatable text (title, excerpt, category,
// date, body paragraphs, author) lives in lib/dict/blog.ts under the
// "blog.post.<slug>.*" keys and is resolved via getT() in the components.
export type Post = {
  slug: string;
  // Number of body paragraphs available as "blog.post.<slug>.body{n}" keys.
  bodyCount: number;
  // Locale-agnostic reading time.
  readTime: string;
};

export const posts: Post[] = [
  { slug: "como-escolher-sua-vps", bodyCount: 4, readTime: "6 min" },
  { slug: "anti-ddos-na-pratica", bodyCount: 3, readTime: "5 min" },
  { slug: "deploy-em-60-segundos", bodyCount: 3, readTime: "4 min" },
];

export function getPost(slug: string) {
  return posts.find((p) => p.slug === slug);
}
