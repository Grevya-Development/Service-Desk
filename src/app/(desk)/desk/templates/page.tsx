import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Lightbulb, MessageSquareText, Pencil, Plus, Search, Sparkles, Trash2 } from "lucide-react";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionButton } from "@/components/ui/action-button";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Dialog } from "@/components/ui/dialog";
import { Button, buttonClass, Card, CardBody, CardHeader, EmptyState, Input, PageHeader, Select } from "@/components/ui";
import { formatDate } from "@/lib/utils";
import { UUID_RE } from "../../status/_lib/incident";
import { TeamChip } from "../../status/_components/incident-bits";
import { PLACEHOLDERS, STARTERS, plainExcerpt } from "./_lib/templates";
import { TemplateEditor } from "./_components/template-editor";
import { addStarter, deleteTemplate } from "./actions";

export const metadata: Metadata = { title: "Reply templates" };

type SP = Record<string, string | string[] | undefined>;
type Filters = { team: string | null; q: string };
type TeamOption = { id: string; name: string; color: string };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function listHref({ team, q }: Filters) {
  const sp = new URLSearchParams();
  if (team) sp.set("team", team);
  if (q) sp.set("q", q);
  const s = sp.toString();
  return s ? `/desk/templates?${s}` : "/desk/templates";
}

/** Body excerpt with {{placeholders}} shown as small chips. */
function PreviewText({ text }: { text: string }) {
  const parts = text.split(/(\{\{[a-z_]+\}\})/g);
  return (
    <p className="line-clamp-2 text-xs leading-relaxed text-slate-500">
      {parts.map((p, i) =>
        /^\{\{[a-z_]+\}\}$/.test(p) ? (
          <code key={i} className="rounded bg-primary-50 px-1 font-mono text-[11px] text-primary-700">
            {p}
          </code>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </p>
  );
}

function StarterCards({ teams, defaultTeamId, keys }: { teams: TeamOption[]; defaultTeamId: string; keys: readonly string[] }) {
  const starters = STARTERS.filter((s) => keys.includes(s.key));
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {starters.map((s) => (
        <div key={s.key} className="flex flex-col rounded-lg border border-slate-200 bg-white p-3 text-left">
          <p className="text-sm font-medium text-slate-800">{s.title}</p>
          <div className="mt-1 flex-1">
            <PreviewText text={plainExcerpt(s.body, 140)} />
          </div>
          <ActionForm action={addStarter} className="mt-3 flex flex-col gap-2">
            <input type="hidden" name="key" value={s.key} />
            {teams.length > 1 ? (
              <>
                <label htmlFor={`starter-${s.key}-team`} className="sr-only">
                  Team
                </label>
                <Select id={`starter-${s.key}-team`} name="team_id" defaultValue={defaultTeamId} className="h-8 text-xs">
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      For {t.name}
                    </option>
                  ))}
                </Select>
              </>
            ) : (
              <input type="hidden" name="team_id" value={defaultTeamId} />
            )}
            <SubmitButton size="sm" variant="secondary">
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Add this template
            </SubmitButton>
          </ActionForm>
        </div>
      ))}
    </div>
  );
}

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await requireAgent();
  const sp = await searchParams;
  const rawTeam = first(sp.team);
  const filters: Filters = {
    team: rawTeam && UUID_RE.test(rawTeam) && me.agentTeamIds.includes(rawTeam) ? rawTeam : null,
    q: (first(sp.q) ?? "").trim().slice(0, 100),
  };
  const canonical = listHref(filters);
  const currentQs = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : v === undefined ? [] : [[k, v]]))).toString();
  if (canonical !== (currentQs ? `/desk/templates?${currentQs}` : "/desk/templates")) redirect(canonical);

  const supabase = await createClient();
  const none = ["00000000-0000-0000-0000-000000000000"];
  const scopeIds = filters.team ? [filters.team] : me.agentTeamIds.length ? me.agentTeamIds : none;

  const [{ data: teamRows }, { data: rows, error }] = await Promise.all([
    supabase.from("teams").select("id, name, color, active").in("id", me.agentTeamIds.length ? me.agentTeamIds : none).order("sort_order"),
    supabase
      .from("canned_responses")
      .select("id, title, body, team_id, use_count, updated_at, author:people!created_by(full_name)")
      .in("team_id", scopeIds)
      .order("use_count", { ascending: false })
      .order("title")
      .limit(500),
  ]);
  const teams: TeamOption[] = (teamRows ?? []).filter((t) => t.active).map((t) => ({ id: t.id, name: t.name, color: t.color }));
  const teamById = new Map((teamRows ?? []).map((t) => [t.id, t]));
  const editorTeams = teams.map((t) => ({ id: t.id, name: t.name }));
  const defaultTeamId = filters.team ?? teams[0]?.id ?? "";

  const all = rows ?? [];
  const needle = filters.q.toLowerCase();
  const visible = needle ? all.filter((t) => t.title.toLowerCase().includes(needle) || t.body.toLowerCase().includes(needle)) : all;
  const totalUses = all.reduce((n, t) => n + t.use_count, 0);

  // Starters not yet added (by title) to the team the agent is looking at.
  const titlesInDefault = new Set(all.filter((t) => t.team_id === defaultTeamId).map((t) => t.title.toLowerCase()));
  const missingStarters = STARTERS.filter((s) => !titlesInDefault.has(s.title.toLowerCase())).map((s) => s.key);

  const newDialog = teams.length ? (
    <Dialog
      title="New reply template"
      description="Write a reply you send often. Agents can insert it into any reply in one click."
      size="xl"
      trigger={
        <Button>
          <Plus className="h-4 w-4" aria-hidden />
          New template
        </Button>
      }
    >
      <TemplateEditor teams={editorTeams} defaultTeamId={defaultTeamId} agentName={me.name} />
    </Dialog>
  ) : null;

  return (
    <div>
      <PageHeader
        title="Reply templates"
        description="Ready-made replies for questions you answer often. Use them from the reply box on any ticket."
        breadcrumbs={[{ label: "Agent workspace", href: "/desk" }, { label: "Reply templates" }]}
        actions={newDialog}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <Card>
            {all.length > 0 && (
              <form action="/desk/templates" method="get" className="flex flex-col gap-2 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
                {teams.length > 1 && (
                  <>
                    <label htmlFor="tpl-team" className="sr-only">
                      Team
                    </label>
                    <Select id="tpl-team" name="team" defaultValue={filters.team ?? ""} className="sm:w-44">
                      <option value="">All my teams</option>
                      {teams.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </Select>
                  </>
                )}
                <div className="relative flex-1">
                  <label htmlFor="tpl-q" className="sr-only">
                    Search templates
                  </label>
                  <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input id="tpl-q" name="q" type="search" defaultValue={filters.q} placeholder="Search names and text" maxLength={100} className="pl-9" />
                </div>
                <div className="flex gap-2">
                  <button type="submit" className={buttonClass("secondary")}>
                    Search
                  </button>
                  {(filters.q || filters.team) && (
                    <Link href="/desk/templates" className={buttonClass("ghost")}>
                      Clear
                    </Link>
                  )}
                </div>
              </form>
            )}

            {error ? (
              <EmptyState icon={MessageSquareText} title="We couldn't load templates" description="Please refresh the page in a moment." />
            ) : all.length === 0 ? (
              <div className="px-4 py-8 text-center sm:px-6">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary-50 text-primary-600">
                  <Sparkles className="h-6 w-6" aria-hidden />
                </div>
                <p className="text-sm font-medium text-slate-800">
                  {filters.team ? `${teamById.get(filters.team)?.name ?? "This team"} has no reply templates yet` : "No reply templates yet"}
                </p>
                <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">Start with one of these. Add it in one click, then change the words to suit your team.</p>
                <div className="mt-5">{teams.length > 0 && <StarterCards teams={teams} defaultTeamId={defaultTeamId} keys={STARTERS.map((s) => s.key)} />}</div>
                <p className="mt-5 text-xs text-slate-500">Or write your own with the “New template” button.</p>
              </div>
            ) : visible.length === 0 ? (
              <EmptyState
                icon={Search}
                title="No templates match your search"
                description="Try a different word."
                action={
                  <Link href={listHref({ team: filters.team, q: "" })} className={buttonClass("outline", "sm")}>
                    Clear search
                  </Link>
                }
              />
            ) : (
              <ul className="divide-y divide-slate-100">
                {visible.map((t) => {
                  const team = teamById.get(t.team_id);
                  return (
                    <li key={t.id} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-start sm:px-5">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium text-slate-900">{t.title}</p>
                          {team && teams.length > 1 && <TeamChip name={team.name} color={team.color} />}
                        </div>
                        <div className="mt-1">
                          <PreviewText text={plainExcerpt(t.body, 180)} />
                        </div>
                        <p className="mt-1.5 text-[11px] text-slate-400">
                          {t.use_count === 0 ? "Not used yet" : `Used ${t.use_count.toLocaleString("en-IN")} ${t.use_count === 1 ? "time" : "times"}`} · Updated {formatDate(t.updated_at)}
                          {t.author?.full_name ? ` · by ${t.author.full_name}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <Dialog
                          title={`Edit “${t.title}”`}
                          size="xl"
                          trigger={
                            <Button variant="outline" size="sm">
                              <Pencil className="h-3.5 w-3.5" aria-hidden />
                              Edit
                            </Button>
                          }
                        >
                          <TemplateEditor template={{ id: t.id, title: t.title, body: t.body, team_id: t.team_id }} teams={editorTeams} agentName={me.name} />
                        </Dialog>
                        <ActionButton action={deleteTemplate} fields={{ id: t.id }} variant="ghost" confirm={`Delete “${t.title}”? Agents won't be able to use it any more.`} title={`Delete “${t.title}”`}>
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          <span className="sr-only sm:not-sr-only">Delete</span>
                        </ActionButton>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {all.length > 0 && missingStarters.length > 0 && teams.length > 0 && !filters.q && (
            <details className="group mt-4 rounded-xl border border-dashed border-slate-300 bg-white/60">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm text-slate-600 hover:text-slate-900 [&::-webkit-details-marker]:hidden">
                <Lightbulb className="h-4 w-4 text-amber-500" aria-hidden />
                Need ideas? Add a suggested template
              </summary>
              <div className="px-4 pb-4">
                <StarterCards teams={teams} defaultTeamId={defaultTeamId} keys={missingStarters} />
              </div>
            </details>
          )}
        </div>

        <aside className="space-y-5">
          <Card>
            <CardHeader title="Placeholders" description="Put these in a template. When you insert it into a reply, they're replaced for you." />
            <CardBody>
              <dl className="space-y-3">
                {PLACEHOLDERS.map((p) => (
                  <div key={p.token}>
                    <dt>
                      <code className="rounded bg-primary-50 px-1.5 py-0.5 font-mono text-xs text-primary-700">{p.token}</code>
                    </dt>
                    <dd className="mt-1 text-xs text-slate-600">
                      {p.label}
                      <span className="text-slate-400"> — e.g. “{p.sample || me.firstName}”</span>
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="mt-4 space-y-1 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <p>
                  <span className="text-slate-400">You write:</span> <span className="font-mono text-[11px]">Hi {"{{first_name}}"}, about {"{{ticket}}"}</span>
                </p>
                <p>
                  <span className="text-slate-400">They read:</span> Hi Priya, about SD-1234
                </p>
              </div>
            </CardBody>
          </Card>
          {all.length > 0 && (
            <Card>
              <CardBody className="flex items-center justify-between gap-3 text-sm">
                <span className="text-slate-500">{all.length === 1 ? "1 template" : `${all.length} templates`}</span>
                <span className="text-slate-700">
                  Used <span className="font-semibold tabular-nums">{totalUses.toLocaleString("en-IN")}</span> {totalUses === 1 ? "time" : "times"}
                </span>
              </CardBody>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
