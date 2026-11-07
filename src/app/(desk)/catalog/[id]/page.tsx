import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, Clock, PackageX, ShieldCheck } from "lucide-react";
import { requireViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isPriority } from "@/lib/constants";
import { Card, CardBody, CardHeader, EmptyState, PageHeader, buttonClass } from "@/components/ui";
import { RequestForm } from "../_components/request-form";
import { CatalogIcon } from "../_lib/icons";
import { parseFields } from "../_lib/fields";
import { UUID_RE, expectedDaysHint, tint } from "../_lib/copy";

export const metadata = { title: "Request a service" };

type Item = {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  fields: unknown;
  approval: string;
  default_priority: string;
  expected_days: number | null;
  active: boolean;
  team: { id: string; name: string; color: string; active: boolean } | null;
  category: { name: string } | null;
};

export default async function CatalogItemPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireViewer();
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const supabase = await createClient();
  const { data } = await supabase
    .from("catalog_items")
    .select("id, name, description, icon, fields, approval, default_priority, expected_days, active, team:teams(id, name, color, active), category:categories(name)")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const item = data as unknown as Item;
  const crumbs = [
    { label: "Home", href: "/home" },
    { label: "Request a service", href: "/catalog" },
    { label: item.name },
  ];

  if (!item.active || !item.team?.active) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title={item.name} breadcrumbs={crumbs} />
        <Card>
          <EmptyState
            icon={PackageX}
            title="This service is no longer available"
            description="It may have been replaced or retired. Have a look at the other services, or tell us what you need."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Link href="/catalog" className={buttonClass("outline")}>
                  Browse services
                </Link>
                <Link href="/requests/new" className={buttonClass("primary")}>
                  Describe what you need
                </Link>
              </div>
            }
          />
        </Card>
      </div>
    );
  }

  const team = item.team;
  const fields = parseFields(item.fields);
  const days = expectedDaysHint(item.expected_days);

  // Mirror the database's approval routing (tickets_after_insert).
  let approvalText: string | null = null;
  let approver: string | null = null;
  if (item.approval === "manager") {
    // Same rule as the database: a manager who has left doesn't count.
    const { data: managerId } = await supabase.rpc("active_manager_of", { p_emp: me.id });
    const { data: manager } = managerId ? await supabase.from("people").select("full_name, first_name").eq("id", managerId).maybeSingle() : { data: null };
    if (managerId) {
      approver = manager?.full_name ?? manager?.first_name ?? "your manager";
      approvalText = `Your manager, ${approver}, will be asked to approve this first.`;
    } else {
      approvalText = `You don't have an active manager on file, so a ${team.name} team lead will approve this first.`;
    }
  } else if (item.approval === "team_lead") {
    approvalText = `A ${team.name} team lead will approve this first.`;
  }

  const steps = [
    { title: "You submit the form", body: "You'll get a request number straight away." },
    ...(approvalText ? [{ title: approver ? `${approver} approves` : "A team lead approves", body: "We'll let you know if it's approved or not." }] : []),
    { title: `${team.name} gets it done`, body: days ? `${days}.` : "We'll keep you posted on the request page." },
    { title: "You're notified", body: "Check progress any time under My requests." },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: tint(team.color, 0.1), color: tint(team.color, 1) }}>
              <CatalogIcon name={item.icon} className="h-5 w-5" />
            </span>
            <span className="min-w-0">{item.name}</span>
          </span>
        }
        description={item.description ?? undefined}
        breadcrumbs={crumbs}
        actions={
          <Link href="/catalog" className={buttonClass("ghost")}>
            <ArrowLeft className="h-4 w-4" /> All services
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="overflow-hidden lg:col-span-2">
          <div aria-hidden className="h-1" style={{ backgroundColor: tint(team.color, 1) }} />
          <CardHeader title="Your request" description={fields.length ? "Answer a few questions so we can get this right." : "Add any details below and submit."} />
          <CardBody className="py-5">
            <RequestForm itemId={item.id} fields={fields} defaultPriority={isPriority(item.default_priority) ? item.default_priority : "medium"} />
          </CardBody>
        </Card>

        <aside className="space-y-4">
          <Card>
            <CardBody className="space-y-3">
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
                style={{ backgroundColor: tint(team.color, 0.1), color: tint(team.color, 1) }}
              >
                <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tint(team.color, 1) }} />
                {team.name}
                {item.category && <span className="opacity-70">· {item.category.name}</span>}
              </span>
              <div className="flex items-start gap-2.5 text-sm">
                {approvalText ? (
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden />
                ) : (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
                )}
                <p className="text-slate-700">{approvalText ?? `No approval needed. It goes straight to the ${team.name} team.`}</p>
              </div>
              {days && (
                <div className="flex items-start gap-2.5 text-sm">
                  <Clock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                  <p className="text-slate-700">{days}</p>
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="What happens next" />
            <CardBody>
              <ol className="relative space-y-4">
                {steps.map((s, i) => (
                  <li key={i} className="relative flex gap-3">
                    {i < steps.length - 1 && <span aria-hidden className="absolute left-3 top-7 h-[calc(100%-0.75rem)] w-px bg-slate-200" />}
                    <span className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-50 text-[11px] font-semibold text-primary-700 ring-1 ring-primary-100">
                      {i + 1}
                    </span>
                    <div className="min-w-0 pb-0.5">
                      <p className="text-sm font-medium text-slate-800">{s.title}</p>
                      <p className="text-xs text-slate-500">{s.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
        </aside>
      </div>
    </div>
  );
}
