import { ASSET_TYPES } from "@/lib/constants";

export const assetTypeLabel = (type: string) => ASSET_TYPES[type as keyof typeof ASSET_TYPES] ?? type;
