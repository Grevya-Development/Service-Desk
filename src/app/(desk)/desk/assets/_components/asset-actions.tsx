"use client";

import { Archive, PackageCheck, UserMinus, UserPlus, Wrench } from "lucide-react";
import { ActionButton } from "@/components/ui/action-button";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Dialog } from "@/components/ui/dialog";
import { Button, Field, Select } from "@/components/ui";
import { assignAsset, setAssetStatus, unassignAsset } from "../actions";

type Option = { id: string; label: string };

export function AssetQuickActions({
  id,
  tag,
  status,
  holderId,
  holderName,
  people,
}: {
  id: string;
  tag: string;
  status: string;
  holderId: string | null;
  holderName: string | null;
  people: Option[];
}) {
  const retired = status === "retired";
  return (
    <div className="flex flex-wrap gap-2">
      {!retired && (
        <Dialog
          title={holderId ? `Give ${tag} to someone else` : `Assign ${tag}`}
          description="They'll get a notification and see it under My assets."
          size="sm"
          trigger={
            <Button variant="primary" size="sm">
              <UserPlus className="h-3.5 w-3.5" /> {holderId ? "Reassign…" : "Assign to…"}
            </Button>
          }
        >
          <ActionForm action={assignAsset} className="space-y-4">
            <input type="hidden" name="id" value={id} />
            <Field label="Employee" htmlFor="assign-person" required>
              <Select id="assign-person" name="assigned_to" required defaultValue="">
                <option value="" disabled>
                  Choose a person
                </option>
                {people
                  .filter((p) => p.id !== holderId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
              </Select>
            </Field>
            <div className="flex justify-end">
              <SubmitButton size="sm">Assign</SubmitButton>
            </div>
          </ActionForm>
        </Dialog>
      )}

      {holderId && (
        <ActionButton action={unassignAsset} fields={{ id }} confirm={`Take ${tag} back from ${holderName ?? "the current holder"}?`}>
          <UserMinus className="h-3.5 w-3.5" /> Unassign
        </ActionButton>
      )}

      {status !== "in_repair" && !retired && (
        <ActionButton action={setAssetStatus} fields={{ id, status: "in_repair" }} confirm={`Mark ${tag} as in repair?`}>
          <Wrench className="h-3.5 w-3.5" /> Mark in repair
        </ActionButton>
      )}

      {(status === "in_repair" || status === "lost" || retired) && (
        <ActionButton
          action={setAssetStatus}
          fields={{ id, status: "in_stock" }}
          confirm={holderId ? `Put ${tag} back in stock? ${holderName ?? "The holder"} will no longer have it.` : `Put ${tag} back in stock?`}
        >
          <PackageCheck className="h-3.5 w-3.5" /> Back in stock
        </ActionButton>
      )}

      {!retired && (
        <ActionButton
          action={setAssetStatus}
          fields={{ id, status: "retired" }}
          variant="danger"
          confirm={holderId ? `Retire ${tag}? It will be taken back from ${holderName ?? "its holder"}.` : `Retire ${tag}? Use this when it's sold, scrapped or recycled.`}
        >
          <Archive className="h-3.5 w-3.5" /> Retire
        </ActionButton>
      )}
    </div>
  );
}
