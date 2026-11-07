import { requireAssetManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { fetchLocations, fetchPeople, locationOptions, personOptions } from "../_lib/data";
import { AssetForm } from "../_components/asset-form";
import { createAsset } from "../actions";

export const metadata = { title: "Add asset" };

export default async function NewAssetPage() {
  await requireAssetManager();
  const supabase = await createClient();
  const [people, locations] = await Promise.all([fetchPeople(supabase), fetchLocations(supabase)]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Add asset"
        description="Register a device or licence so you always know who has it."
        breadcrumbs={[{ label: "Assets", href: "/desk/assets" }, { label: "Add asset" }]}
      />
      <AssetForm action={createAsset} people={personOptions(people)} locations={locationOptions(locations)} cancelHref="/desk/assets" submitLabel="Add asset" />
    </div>
  );
}
