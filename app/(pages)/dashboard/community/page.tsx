import type { Metadata } from "next";
import CommunityClient from "@/components/CommunityClient";

export const metadata: Metadata = {
  title: "Community — ArtixCloud",
};

export default function CommunityPage() {
  return <CommunityClient />;
}
