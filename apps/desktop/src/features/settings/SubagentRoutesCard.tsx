import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type SubagentRouteSettings } from "../../shared/api";
import { useI18n } from "../../i18n/store";
import { useAppStore } from "../../shared/store/appStore";
import { Button } from "../../shared/ui/Button";
import { ModelSelect } from "../../shared/ui/ModelSelect";
import { TitledCard } from "../../shared/ui/TitledCard";
import { useMessage } from "../../shared/ui/message";
import controls from "../../shared/ui/Controls.module.scss";
import { configuredModelOptions } from "../../shared/utils/modelOptions";
import styles from "./SubagentRoutesCard.module.scss";

interface RouteDraft {
  kind: string;
  modelId: string;
}

function errorText(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

function routesToDraft(settings: SubagentRouteSettings): RouteDraft[] {
  return Object.entries(settings.routes).map(([kind, modelId]) => ({ kind, modelId }));
}

function draftToRoutes(draft: RouteDraft[]): SubagentRouteSettings {
  const routes: Record<string, string> = {};
  for (const row of draft) {
    const kind = row.kind.trim();
    const modelId = row.modelId.trim();
    if (kind && modelId) routes[kind] = modelId;
  }
  return { routes };
}

export function SubagentRoutesCard() {
  const { models, plugins } = useAppStore();
  const { locale } = useI18n();
  const message = useMessage();
  const [view, setView] = useState<SubagentRouteSettings | null>(null);
  const [draft, setDraft] = useState<RouteDraft[]>([]);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const loaded = await api.subagentRoutes();
        if (active) setView(loaded);
      } catch (cause) {
        if (active) message(errorText(cause));
      }
    })();
    return () => {
      active = false;
    };
  }, [message]);

  const persistedIds = useMemo(() => Object.values(view?.routes ?? {}), [view]);
  const modelOptions = useMemo(
    () => configuredModelOptions(models, plugins, locale, persistedIds),
    [locale, models, plugins, persistedIds],
  );

  const editRoutes = useCallback(() => {
    if (!view) return;
    setDraft(routesToDraft(view));
    setEditing(true);
  }, [view]);

  const cancelEdit = useCallback(() => {
    setDraft(routesToDraft(view ?? { routes: {} }));
    setEditing(false);
  }, [view]);

  const saveRoutes = useCallback(async () => {
    setSaving(true);
    try {
      const saved = await api.setSubagentRoutes(draftToRoutes(draft));
      setView(saved);
      setEditing(false);
    } catch (cause) {
      message(errorText(cause));
    } finally {
      setSaving(false);
    }
  }, [draft, message]);

  const updateRow = useCallback((index: number, patch: Partial<RouteDraft>) => {
    setDraft((rows) => rows.map((row, at) => (at === index ? { ...row, ...patch } : row)));
  }, []);

  const removeRow = useCallback((index: number) => {
    setDraft((rows) => rows.filter((_, at) => at !== index));
  }, []);

  const addRow = useCallback(() => {
    setDraft((rows) => [...rows, { kind: "", modelId: "" }]);
  }, []);

  const optionLabel = useCallback(
    (modelId: string) =>
      modelOptions.find((option) => option.value === modelId)?.label ?? modelId,
    [modelOptions],
  );

  const action = editing ? (
    <div className={styles.actionGroup}>
      <Button size="small" disabled={saving} onClick={cancelEdit}>{t("取消")}</Button>
      <Button variant="primary" size="small" disabled={saving} onClick={() => void saveRoutes()}>
        {saving ? t("保存中…") : t("保存")}
      </Button>
    </div>
  ) : (
    <div className={styles.actionGroup}>
      <button type="button" className={styles.textButton} disabled={!view} onClick={editRoutes}>
        {t("编辑")}
      </button>
    </div>
  );

  return (
    <TitledCard title={t("子 Agent 模型路由")} action={action}>
      <div className={styles.content}>
        {editing ? (
          <>
            {draft.map((row, index) => (
              <div className={styles.routeRow} key={index}>
                <input
                  className={styles.kindInput}
                  value={row.kind}
                  spellCheck={false}
                  aria-label={t("子 Agent 类型")}
                  placeholder={t("explore / review / 自定义 agent 名")}
                  onChange={(event) => updateRow(index, { kind: event.target.value })}
                />
                <div className={styles.modelSelect}>
                  <ModelSelect
                    mode="single"
                    value={row.modelId}
                    options={modelOptions}
                    disabled={saving}
                    label={t("路由模型")}
                    onChange={(modelId) => updateRow(index, { modelId })}
                  />
                </div>
                <button
                  type="button"
                  className={`${controls.iconButton} ${controls.danger}`}
                  aria-label={t("删除")}
                  disabled={saving}
                  onClick={() => removeRow(index)}
                >
                  ×
                </button>
              </div>
            ))}
            <div className={styles.addRow}>
              <button type="button" className={controls.secondary} onClick={addRow} disabled={saving}>
                {t("添加路由")}
              </button>
            </div>
          </>
        ) : (
          <>
            {view && Object.keys(view.routes).length > 0 ? (
              Object.entries(view.routes).map(([kind, modelId]) => (
                <div className={styles.routeRow} key={kind}>
                  <strong>{kind}</strong>
                  <span className={styles.value}>{optionLabel(modelId)}</span>
                </div>
              ))
            ) : (
              <div className={styles.empty}>
                {t("尚未配置路由，所有子 Agent 跟随 Cursor 请求的模型。")}
              </div>
            )}
          </>
        )}
      </div>
    </TitledCard>
  );
}
