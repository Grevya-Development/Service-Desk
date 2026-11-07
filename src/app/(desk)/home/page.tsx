import { requireViewer } from "@/lib/auth";
import { PageHeader } from "@/components/ui";

export default async function HomePage() {
  const me = await requireViewer();
  return <PageHeader title={`Hi ${me.firstName}`} description="Placeholder home." />;
}
