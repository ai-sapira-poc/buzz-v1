//! Publish the agent job lifecycle as Nostr events.
//!
//! Kinds 43001-43006 have existed in `buzz-core` since the agent job protocol
//! was defined, and the desktop feed already renders every one of them with its
//! own headline ("Job requested", "Job accepted", "Progress update", "Job
//! result", "Job cancelled", "Job failed"). Nothing ever emitted them, so the
//! consumer sat in front of an empty stream and the control plane's work stayed
//! invisible outside its own database.
//!
//! This is the producer. It is deliberately thin: the caller already knows the
//! state, so the command does not infer one. The kind IS the state, which keeps
//! readers from parsing prose to find out what happened.

use nostr::{EventBuilder, Kind, Tag};

use crate::client::{normalize_write_response, BuzzClient};
use crate::error::CliError;
use crate::validate::validate_hex64;

/// The six lifecycle states, as the CLI spells them.
const STATES: &[(&str, u16)] = &[
    ("requested", 43001),
    ("accepted", 43002),
    ("progress", 43003),
    ("result", 43004),
    ("cancelled", 43005),
    ("error", 43006),
];

fn kind_for(state: &str) -> Result<Kind, CliError> {
    STATES
        .iter()
        .find(|(name, _)| *name == state)
        .map(|(_, kind)| Kind::from(*kind))
        .ok_or_else(|| {
            let names: Vec<&str> = STATES.iter().map(|(name, _)| *name).collect();
            CliError::Usage(format!(
                "unknown state '{state}'; expected one of: {}",
                names.join(", ")
            ))
        })
}

/// Publish one lifecycle event for one job.
///
/// `owner` is what puts the event in a person's feed (the feed query scopes by
/// `#p`), `channel` is the NIP-29 group scope, and `job` correlates the whole
/// lifecycle of one assignment across its six possible states.
#[allow(clippy::too_many_arguments)]
pub async fn cmd_publish(
    client: &BuzzClient,
    state: &str,
    job: &str,
    owner: &str,
    channel: Option<&str>,
    role: Option<&str>,
    trace: Option<&str>,
    content: &str,
) -> Result<(), CliError> {
    let kind = kind_for(state)?;
    validate_hex64(owner)?;
    if job.is_empty() || job.len() > 160 {
        return Err(CliError::Usage(
            "job id must be 1..160 characters; it correlates one assignment's whole lifecycle"
                .into(),
        ));
    }
    if content.len() > 4000 {
        return Err(CliError::Usage(
            "content must be at most 4000 characters; cite an artifact instead of pasting it"
                .into(),
        ));
    }

    let mut tags = vec![
        Tag::parse(["p", owner]).map_err(|e| CliError::Usage(format!("invalid owner tag: {e}")))?,
        Tag::parse(["job", job]).map_err(|e| CliError::Other(format!("invalid job tag: {e}")))?,
    ];
    if let Some(channel) = channel {
        tags.push(
            Tag::parse(["h", channel])
                .map_err(|e| CliError::Usage(format!("invalid channel tag: {e}")))?,
        );
    }
    if let Some(role) = role {
        tags.push(
            Tag::parse(["role", role])
                .map_err(|e| CliError::Usage(format!("invalid role tag: {e}")))?,
        );
    }
    if let Some(trace) = trace {
        tags.push(
            Tag::parse(["trace", trace])
                .map_err(|e| CliError::Usage(format!("invalid trace tag: {e}")))?,
        );
    }

    let event = client.sign_event(EventBuilder::new(kind, content).tags(tags))?;
    let resp = client.submit_event(event).await?;
    println!("{}", normalize_write_response(&resp));
    Ok(())
}

pub async fn dispatch(cmd: crate::JobsCmd, client: &BuzzClient) -> Result<(), CliError> {
    use crate::JobsCmd;
    match cmd {
        JobsCmd::Publish {
            state,
            job,
            owner,
            channel,
            role,
            trace,
            content,
        } => {
            cmd_publish(
                client,
                &state,
                &job,
                &owner,
                channel.as_deref(),
                role.as_deref(),
                trace.as_deref(),
                &content,
            )
            .await
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_state_maps_to_its_own_kind() {
        // The kind IS the state. A reader that had to parse `content` to learn
        // what happened would be guessing, and the desktop feed already
        // switches on these six numbers.
        let expected = [
            ("requested", 43001),
            ("accepted", 43002),
            ("progress", 43003),
            ("result", 43004),
            ("cancelled", 43005),
            ("error", 43006),
        ];
        for (state, kind) in expected {
            assert_eq!(kind_for(state).unwrap().as_u16(), kind, "state {state}");
        }
    }

    #[test]
    fn an_unknown_state_lists_the_ones_that_exist() {
        // An error a caller cannot act on costs a round trip and teaches
        // nothing, so the refusal names every accepted value.
        let error = kind_for("finished").unwrap_err();
        let message = error.to_string();
        assert!(message.contains("finished"), "{message}");
        for state in [
            "requested",
            "accepted",
            "progress",
            "result",
            "cancelled",
            "error",
        ] {
            assert!(message.contains(state), "missing {state} in: {message}");
        }
    }

    #[test]
    fn the_six_states_stay_in_the_relay_job_range() {
        for (_, kind) in STATES {
            assert!((43001..=43006).contains(kind), "kind {kind} left the range");
        }
        assert_eq!(STATES.len(), 6, "the protocol has exactly six states");
    }
}
