//! Resolves Cursor model selections to configured provider models.
use std::collections::HashMap;

use crate::{
    cursor::protocol::proto::agent::v1 as pb,
    model::{parse_token_count, ModelLatency, ModelSpec, ReasoningSpec, SubagentModelOverride},
    Error, Result,
};

pub fn requested_model(request: &pb::AgentRunRequest) -> Result<ModelSpec> {
    let details = request.model_details.as_ref();
    let model = if let Some(requested) = request.requested_model.as_ref() {
        from_requested(requested, details)?
    } else if let Some(model_id) = details
        .map(|model| model.model_id.as_str())
        .filter(|model| !model.is_empty())
    {
        ModelSpec {
            model_id: model_id.into(),
            display_name: details
                .map(|model| model.display_name.clone())
                .filter(|name| !name.is_empty()),
            reasoning: ReasoningSpec {
                enabled: details.is_some_and(|model| model.thinking_details.is_some()),
                effort: None,
            },
            latency: ModelLatency::Standard,
            max_output_tokens: None,
            context_window_tokens: None,
            supports_image_generation: false,
            extra_params: serde_json::json!({}),
        }
    } else {
        return Err(Error::Protocol("Cursor Run does not select a model".into()));
    };
    Ok(model)
}

pub fn overrides(request: &pb::AgentRunRequest) -> Result<HashMap<String, SubagentModelOverride>> {
    let mut overrides = HashMap::new();
    for value in &request.subagent_model_overrides {
        use pb::subagent_model_override::Selection;
        let selection = match value.selection.as_ref() {
            Some(Selection::Model(model)) => {
                if model.model_id == "default" {
                    SubagentModelOverride::Inherit
                } else {
                    SubagentModelOverride::Explicit(from_requested(model, None)?)
                }
            }
            Some(Selection::Inherit(true)) => SubagentModelOverride::Inherit,
            Some(Selection::Disabled(true)) => SubagentModelOverride::Disabled,
            None | Some(Selection::Inherit(false) | Selection::Disabled(false)) => {
                return Err(Error::Protocol(format!(
                    "Cursor subagent model override {} has no active selection",
                    value.subagent_type
                )))
            }
        };
        // An absent subagent type denotes the general-purpose subagent.
        let kind = match value.subagent_type.trim() {
            "" => GENERAL_PURPOSE_SUBAGENT.to_owned(),
            kind => kind.to_owned(),
        };
        overrides.insert(kind, selection);
    }
    Ok(overrides)
}

pub const GENERAL_PURPOSE_SUBAGENT: &str = "generalPurpose";

fn from_requested(
    model: &pb::RequestedModel,
    details: Option<&pb::ModelDetails>,
) -> Result<ModelSpec> {
    let mut spec = ModelSpec {
        model_id: model.model_id.clone(),
        display_name: details
            .map(|model| model.display_name.clone())
            .filter(|name| !name.is_empty()),
        reasoning: ReasoningSpec {
            enabled: model.max_mode
                || details.is_some_and(|model| model.thinking_details.is_some()),
            effort: None,
        },
        latency: ModelLatency::Standard,
        max_output_tokens: None,
        context_window_tokens: None,
        supports_image_generation: false,
        extra_params: serde_json::json!({}),
    };
    for parameter in &model.parameters {
        match parameter.id.as_str() {
            "effort" | "reasoning" => {
                let effort = parameter.value.trim();
                spec.reasoning.effort =
                    (effort != "none" && !effort.is_empty()).then(|| effort.to_string());
                spec.reasoning.enabled |= spec.reasoning.effort.is_some();
            }
            "thinking" => spec.reasoning.enabled |= parse_bool(parameter)?,
            "fast" => {
                if parse_bool(parameter)? {
                    spec.latency = ModelLatency::Fast;
                }
            }
            "context" => {
                spec.context_window_tokens =
                    Some(parse_token_count(&parameter.value).ok_or_else(|| {
                        Error::Protocol(format!(
                            "invalid Cursor context token count: {}",
                            parameter.value
                        ))
                    })?);
            }
            _ => {}
        }
    }
    Ok(spec)
}

fn parse_bool(parameter: &pb::requested_model::ModelParameterValue) -> Result<bool> {
    match parameter.value.as_str() {
        "true" => Ok(true),
        "false" => Ok(false),
        _ => Err(Error::Protocol(format!(
            "invalid Cursor boolean model parameter {}={}",
            parameter.id, parameter.value
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ignores_unknown_cursor_model_parameters() {
        let requested = pb::RequestedModel {
            model_id: "test-model".into(),
            parameters: vec![pb::requested_model::ModelParameterValue {
                id: "optimize_for".into(),
                value: "quality".into(),
            }],
            ..Default::default()
        };

        let model = from_requested(&requested, None).expect("unknown parameter should be ignored");

        assert_eq!(model.model_id, "test-model");
        assert_eq!(model.latency, ModelLatency::Standard);
        assert!(!model.reasoning.enabled);
    }

    #[test]
    fn overrides_key_by_subagent_type_and_resolve_selections() {
        let request = pb::AgentRunRequest {
            subagent_model_overrides: vec![
                pb::SubagentModelOverride {
                    subagent_type: "explore".into(),
                    selection: Some(pb::subagent_model_override::Selection::Model(
                        pb::RequestedModel {
                            model_id: "model-a".into(),
                            ..Default::default()
                        },
                    )),
                },
                pb::SubagentModelOverride {
                    subagent_type: String::new(),
                    selection: Some(pb::subagent_model_override::Selection::Disabled(true)),
                },
            ],
            ..Default::default()
        };

        let overrides = overrides(&request).expect("overrides should resolve");

        assert_eq!(overrides.len(), 2);
        assert_eq!(
            overrides["explore"],
            SubagentModelOverride::Explicit(ModelSpec::new("model-a"))
        );
        assert_eq!(overrides["generalPurpose"], SubagentModelOverride::Disabled);
    }
}
