import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/form";
import { saveCategory } from "../actions";

type Category = { id: string; name: string; description: string | null; active: boolean };

/** Add (with `teamId`) or edit (with `category`) a category. */
export function CategoryForm({ teamId, category }: { teamId?: string; category?: Category }) {
  const idp = category ? `cat-${category.id}` : "cat-new";
  return (
    <ActionForm action={saveCategory} resetOnSuccess={!category} className="space-y-4">
      {category ? <input type="hidden" name="id" value={category.id} /> : <input type="hidden" name="team_id" value={teamId} />}
      <Field label="Name" htmlFor={`${idp}-name`} required hint="Short and plain, as employees would say it, e.g. “Laptop & hardware”.">
        <Input id={`${idp}-name`} name="name" defaultValue={category?.name} minLength={2} maxLength={60} required autoFocus />
      </Field>
      <Field label="Description" htmlFor={`${idp}-desc`} hint="Optional. Helps people pick the right category.">
        <Textarea id={`${idp}-desc`} name="description" defaultValue={category?.description ?? ""} maxLength={300} rows={2} />
      </Field>
      <div>
        <Checkbox name="active" defaultChecked={category?.active ?? true} label="Active" />
        <p className="ml-6 mt-0.5 text-xs text-slate-500">Only active categories can be chosen on new tickets.</p>
      </div>
      <div className="flex justify-end">
        <SubmitButton>{category ? "Save changes" : "Add category"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
