"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Checkbox, Field, FormGrid, Input, Textarea } from "@/components/ui/form";
import { cn } from "@/lib/utils";
import { NamedIcon, TEAM_ICONS } from "../../_lib/icons";
import { HEX_RE, TEAM_COLORS } from "../../_lib/validate";
import { createTeam, updateTeam } from "../actions";

export type TeamFormValues = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  color: string;
  icon: string;
  manages_assets: boolean;
  auto_assign: boolean;
  active: boolean;
};

/** Create (admins) or edit (leads: look & auto-assign; admins: everything). */
export function TeamForm({ team, isAdmin }: { team?: TeamFormValues; isAdmin: boolean }) {
  const editing = Boolean(team);
  const [color, setColor] = useState(team?.color ?? TEAM_COLORS[0]);
  const [icon, setIcon] = useState(team?.icon && TEAM_ICONS[team.icon] ? team.icon : "life-buoy");
  const [key, setKey] = useState(team?.key ?? "");
  const [name, setName] = useState(team?.name ?? "");
  const validColor = HEX_RE.test(color);
  const idp = team ? `team-${team.id}` : "team-new";

  return (
    <ActionForm action={editing ? updateTeam : createTeam} resetOnSuccess={false} className="space-y-5">
      {team && <input type="hidden" name="id" value={team.id} />}

      {/* Live preview */}
      <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg text-white" style={{ backgroundColor: validColor ? color : "#94a3b8" }}>
          <NamedIcon name={icon} set={TEAM_ICONS} className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-800">{name || "Team name"}</p>
          <p className="text-xs text-slate-500">This is how the team appears to employees.</p>
        </div>
      </div>

      <FormGrid>
        {isAdmin ? (
          <Field label="Team name" htmlFor={`${idp}-name`} required>
            <Input id={`${idp}-name`} name="name" value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={60} required placeholder="e.g. Facilities" />
          </Field>
        ) : (
          <Field label="Team name" hint="Only desk admins can rename a team.">
            <Input value={name} disabled readOnly />
          </Field>
        )}
        <Field
          label="Short code"
          htmlFor={`${idp}-key`}
          required={!editing}
          hint={editing ? "The short code can't be changed." : "Lowercase letters, numbers, - or _. Used internally, e.g. “facilities”."}
        >
          <Input
            id={`${idp}-key`}
            name={editing ? undefined : "key"}
            value={key}
            onChange={(e) => setKey(e.target.value.toLowerCase().replace(/\s+/g, "-"))}
            disabled={editing}
            readOnly={editing}
            required={!editing}
            pattern="[a-z][a-z0-9_\-]{1,30}"
            maxLength={31}
            placeholder="facilities"
          />
        </Field>
      </FormGrid>

      <Field label="Description" htmlFor={`${idp}-desc`} hint="One line telling employees what this team helps with.">
        <Textarea id={`${idp}-desc`} name="description" defaultValue={team?.description ?? ""} maxLength={300} rows={2} placeholder="Desks, parking, access cards and office repairs." />
      </Field>

      <fieldset>
        <legend className="mb-1.5 block text-xs font-medium text-slate-600">Colour</legend>
        <div className="flex flex-wrap items-center gap-2">
          {TEAM_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              aria-label={`Use colour ${c}`}
              aria-pressed={color.toLowerCase() === c}
              className={cn("flex h-8 w-8 items-center justify-center rounded-full ring-offset-2 transition", color.toLowerCase() === c ? "ring-2 ring-slate-400" : "hover:scale-105")}
              style={{ backgroundColor: c }}
            >
              {color.toLowerCase() === c && <Check className="h-4 w-4 text-white" />}
            </button>
          ))}
          <label className="ml-1 flex items-center gap-2 text-xs text-slate-500">
            <span className="sr-only">Custom colour (hex)</span>
            <Input
              name="color"
              value={color}
              onChange={(e) => setColor(e.target.value.trim())}
              pattern="#[0-9a-fA-F]{6}"
              required
              maxLength={7}
              className={cn("h-8 w-28 font-mono text-xs", !validColor && "border-red-400 focus:border-red-500 focus:ring-red-500/20")}
              aria-invalid={!validColor}
            />
          </label>
        </div>
        {!validColor && <p className="mt-1 text-xs text-red-600">Use a hex colour like #2d48c8.</p>}
      </fieldset>

      <fieldset>
        <legend className="mb-1.5 block text-xs font-medium text-slate-600">Icon</legend>
        <input type="hidden" name="icon" value={icon} />
        <div className="grid grid-cols-6 gap-2 sm:grid-cols-12" role="radiogroup" aria-label="Team icon">
          {Object.keys(TEAM_ICONS).map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={icon === n}
              aria-label={n.replace(/-/g, " ")}
              title={n.replace(/-/g, " ")}
              onClick={() => setIcon(n)}
              className={cn(
                "flex h-9 items-center justify-center rounded-lg border transition",
                icon === n ? "border-primary-500 bg-primary-50 text-primary-700" : "border-slate-200 text-slate-500 hover:bg-slate-50",
              )}
            >
              <NamedIcon name={n} set={TEAM_ICONS} className="h-4 w-4" />
            </button>
          ))}
        </div>
      </fieldset>

      <div className="space-y-3 rounded-lg border border-slate-200 p-3">
        <div>
          <Checkbox name="auto_assign" defaultChecked={team?.auto_assign ?? false} label="Assign new tickets automatically" />
          <p className="ml-6 mt-0.5 text-xs text-slate-500">
            Each new ticket goes straight to the agent with the fewest open tickets, so nobody has to hand them out. Requests that need approval are assigned once
            approved. Leave this off if a lead prefers to assign tickets by hand.
          </p>
        </div>
        {isAdmin && (
          <div>
            <Checkbox name="manages_assets" defaultChecked={team?.manages_assets ?? false} label="This team manages company assets" />
            <p className="ml-6 mt-0.5 text-xs text-slate-500">Agents of this team can see and edit the asset register (laptops, phones, licences).</p>
          </div>
        )}
        {isAdmin && editing && (
          <div>
            <Checkbox name="active" defaultChecked={team?.active ?? true} label="Active" />
            <p className="ml-6 mt-0.5 text-xs text-slate-500">Inactive teams stop accepting new tickets from employees, and their agents lose access to the team. Existing tickets are kept.</p>
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <SubmitButton disabled={!validColor}>{editing ? "Save changes" : "Create team"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
