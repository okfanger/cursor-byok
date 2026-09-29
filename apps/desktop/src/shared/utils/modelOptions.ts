import { pluginText, type Model, type PluginDescriptor } from "../api";
import type { ModelSelectOption } from "../ui/ModelSelect";
import { claudeIcon, flatColorOrganizationIcon, openAiIcon } from "../ui/icons";
import { modelProviderName } from "./modelProvider";

/**
 * Builds the ModelSelect options for choosing among already configured
 * models: built-in models keyed by `model_hash` and enabled models of
 * configured plugins keyed by their stable plugin model `id`.
 *
 * `persistedModelIds` keeps saved selections visible even when their models
 * have since been deleted; such entries render as the raw identifier under
 * the Cursor group.
 */
export function configuredModelOptions(
  models: Model[],
  plugins: PluginDescriptor[],
  locale: string,
  persistedModelIds: readonly string[] = [],
): ModelSelectOption[] {
  const options: ModelSelectOption[] = [];
  const seen = new Set<string>(persistedModelIds);
  for (const model of models) {
    seen.add(model.model_hash);
    options.push({
      value: model.model_hash,
      label:
        model.display_name && model.display_name !== model.model_id
          ? `${model.display_name}（${model.model_id}）`
          : model.display_name || model.model_id,
      group: modelProviderName(model),
      icon: model.type === "anthropic" ? claudeIcon : openAiIcon,
    });
  }
  for (const plugin of plugins) {
    for (const provider of plugin.providers) {
      if (!provider.configured) continue;
      const group = pluginText(provider.displayName, locale) || plugin.name;
      for (const model of provider.models.filter((model) => model.enabled)) {
        seen.add(model.id);
        options.push({
          value: model.id,
          label: model.displayName,
          group,
          iconSrc: model.icon || undefined,
          icon: model.icon ? undefined : flatColorOrganizationIcon,
        });
      }
    }
  }
  for (const persistedModelId of persistedModelIds) {
    if (persistedModelId && !seen.has(persistedModelId)) {
      seen.add(persistedModelId);
      options.push({ value: persistedModelId, label: persistedModelId, group: "Cursor" });
    }
  }
  return options;
}
