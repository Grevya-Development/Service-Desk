import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { buttonClass, Card, EmptyState } from "@/components/ui";

export default function ArticleNotFound() {
  return (
    <Card className="mx-auto mt-8 max-w-xl">
      <EmptyState
        icon={FileQuestion}
        title="We couldn't find that article"
        description="It may have been moved, renamed or taken down, or you may not have access to it."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Link href="/kb" className={buttonClass("primary")}>
              Search the knowledge base
            </Link>
            <Link href="/requests/new" className={buttonClass("outline")}>
              Report an issue
            </Link>
          </div>
        }
      />
    </Card>
  );
}
