import type { AssetReader, AssetView } from "../domain/adapter.js";
import { resolvedAsset, type ResolvedAsset } from "../domain/assets.js";
import { freezeData } from "../domain/catalog.js";
import { HarnessError } from "../domain/errors.js";
import { hash, relativePath } from "../domain/identity.js";

export function assetView(input: ResolvedAsset, reader: AssetReader): AssetView {
  const asset = freezeData(resolvedAsset(input));
  return Object.freeze({ manifest: asset.manifest, contentDigest: asset.contentDigest, inventory: asset.inventory,
    async readText(name: string) {
      const relative = relativePath(name);
      const entry = asset.inventory.find(item => item.path === relative && item.type === "file");
      if (!entry || entry.type !== "file") throw new HarnessError("INVALID_PLAN", "Adapter source is absent from the asset inventory.");
      const bytes = await reader.readAsset(asset, relative);
      if (hash(bytes) !== entry.digest) throw new HarnessError("CONTENT_MODIFIED", `Asset content changed: ${relative}`);
      try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
      catch (cause) { throw new HarnessError("INVALID_PLAN", "Adapter requires UTF-8 content.", {}, { cause }); }
    }
  });
}
