"use client";

import { IconCloud } from "@/components/ui/icon-cloud";

const slugs = [
  "ubuntu",
  "debian",
  "docker",
  "nginx",
  "nodedotjs",
  "python",
  "php",
  "mysql",
  "postgresql",
  "redis",
  "wordpress",
  "cloudflare",
  "git",
  "linux",
  "go",
  "rust",
];

const images = slugs.map((s) => `https://cdn.simpleicons.org/${s}/white`);

export default function TechCloud() {
  return <IconCloud images={images} />;
}
