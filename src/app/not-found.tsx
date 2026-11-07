import Link from "next/link";
import Image from "next/image";
import { buttonClass } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <div className="text-center">
        <Image src="/grevya-mark.png" alt="" width={56} height={56} className="mx-auto h-14 w-14 opacity-90" />
        <p className="mt-6 text-sm font-semibold text-primary-600">404</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">We couldn&apos;t find that page</h1>
        <p className="mt-2 text-sm text-slate-500">It may have moved, or you may not have access to it.</p>
        <Link href="/home" className={buttonClass("primary", "md", "mt-6")}>
          Back to Home
        </Link>
      </div>
    </div>
  );
}
