import { HomeScreen } from "@/features/home/components/HomeScreen";

import { HomeEvents } from "./_home/HomeEvents";

export default function HomePage() {
  return <HomeScreen events={<HomeEvents />} />;
}
