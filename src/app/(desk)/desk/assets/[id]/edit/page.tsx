import { notFound } from "next/navigation";
import { requireAssetManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { fetchLocations, fetchPeople, locationOptions, personOptions } from "../../_lib/data";
import { UUID_RE } from "../../_lib/shared";
import { AssetForm } from "../../_components/asset-form";
import { updateAsset } from "../../actions";

export const metadata = { title: "Edit asset" };

export default async function EditAssetPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAssetManager();
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const supabase = await createClient();
  const [{ data: asset }, people, locations] = await Promise.all([
    supabase.from("assets").select("*").eq("id", id).maybeSingle(),
    fetchPeople(supabase),
    fetchLocations(supabase),
  ]);
  if (!asset) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={`Edit ${asset.asset_tag}`}
        description={asset.name}
        breadcrumbs={[{ label: "Assets", href: "/desk/assets" }, { label: asset.asset_tag, href: `/desk/assets/${id}` }, { label: "Edit" }]}
      />
      <AssetForm
        action={updateAsset}
        asset={asset}
        people={personOptions(people)}
        locations={locationOptions(locations)}
        cancelHref={`/desk/assets/${id}`}
        submitLabel="Save changes"
      />
    </div>
  );
}
