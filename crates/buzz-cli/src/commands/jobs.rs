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
//!
//! The kind is not always enough on its own: a failure that left a validated
//! deliverable and a failure that left nothing are both kind 43006. `--outcome`
//! carries that difference in an `outcome` tag, so it survives the wire instead
//! of living only in the content line.

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

/// The failure outcomes a reader can tell apart on the wire, as the CLI spells
/// them.
///
/// `failed_with_delivery` is the control plane's own name for the case
/// (`operator_updates.FAILED_WITH_DELIVERY`): the budget ran out with a
/// gate-validated deliverable on disk and nothing accepted. Kind 43006 says
/// "failed" for both, so a reader that only has the kind re-commissions work
/// already paid for. Reusing the control plane's word rather than inventing a
/// wire-only one is what keeps the two halves from drifting apart.
const OUTCOMES: &[&str] = &["failed", "failed_with_delivery"];

/// The only state an outcome describes: a job that failed. Named rather than
/// repeated as a literal at the check, so renumbering in [`STATES`] is one edit.
const FAILURE_KIND: u16 = 43006;

/// Resolve `--outcome` into the value that goes on the wire, or `None` when the
/// caller made no claim.
///
/// Refused on any state but `error`: an outcome tag that contradicts the kind is
/// worse than no tag, because the reader this exists for trusts it.
fn resolve_outcome(kind: Kind, outcome: Option<&str>) -> Result<Option<&'static str>, CliError> {
    let Some(outcome) = outcome else {
        return Ok(None);
    };
    let outcome = OUTCOMES
        .iter()
        .copied()
        .find(|name| *name == outcome)
        .ok_or_else(|| {
            CliError::Usage(format!(
                "unknown outcome '{outcome}'; expected one of: {}",
                OUTCOMES.join(", ")
            ))
        })?;
    if kind.as_u16() != FAILURE_KIND {
        return Err(CliError::Usage(
            "outcome describes how a job failed; it is only meaningful with --state error".into(),
        ));
    }
    Ok(Some(outcome))
}

/// Every tag one lifecycle event carries.
///
/// Split out of [`cmd_publish`] so the tags a reader actually sees can be
/// asserted without a relay. The regression this guards — the delivery
/// distinction silently falling off the wire — is invisible in prose and would
/// otherwise only be found by a reader who had already been misled by it.
fn lifecycle_tags(
    owner: &str,
    job: &str,
    channel: Option<&str>,
    role: Option<&str>,
    trace: Option<&str>,
    outcome: Option<&str>,
) -> Result<Vec<Tag>, CliError> {
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
    if let Some(outcome) = outcome {
        // A readable tag, not a single-letter companion: nothing subscribes by
        // outcome — the reader already holds the event, which is what makes it
        // the same event as the plain failure — and a `t` value would land in
        // the channel's topic list, which is for topics.
        tags.push(
            Tag::parse(["outcome", outcome])
                .map_err(|e| CliError::Other(format!("invalid outcome tag: {e}")))?,
        );
    }
    Ok(tags)
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
    outcome: Option<&str>,
    content: &str,
) -> Result<(), CliError> {
    let kind = kind_for(state)?;
    let outcome = resolve_outcome(kind, outcome)?;
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

    let tags = lifecycle_tags(owner, job, channel, role, trace, outcome)?;

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
            outcome,
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
                outcome.as_deref(),
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

    /// The value of the first tag named `name`, the way a relay reader reads it.
    fn tag_value<'a>(tags: &'a [Tag], name: &str) -> Option<&'a str> {
        tags.iter()
            .find(|tag| tag.as_slice().first().map(String::as_str) == Some(name))
            .and_then(|tag| tag.as_slice().get(1).map(String::as_str))
    }

    const OWNER: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    fn failure_tags(outcome: Option<&str>) -> Vec<Tag> {
        lifecycle_tags(
            OWNER,
            "job-1",
            None,
            Some("coder"),
            None,
            resolve_outcome(kind_for("error").unwrap(), outcome).unwrap(),
        )
        .unwrap()
    }

    #[test]
    fn a_failure_with_a_validated_delivery_says_so_on_the_wire() {
        // The reason this option exists: kind 43006 is the same event for
        // "delivered nothing" and "left a gate-validated artifact and ran out
        // of budget". Dropping the tag from `lifecycle_tags` must fail here.
        let tags = failure_tags(Some("failed_with_delivery"));
        assert_eq!(
            tag_value(&tags, "outcome"),
            Some("failed_with_delivery"),
            "tags: {tags:?}"
        );
    }

    #[test]
    fn a_plain_failure_can_say_that_too() {
        // The falsifiable half: if only the delivery case were expressible,
        // absence would have to mean "nothing delivered", and a producer that
        // never heard of the flag would read as a claim it did not make.
        assert_eq!(
            tag_value(&failure_tags(Some("failed")), "outcome"),
            Some("failed")
        );
    }

    #[test]
    fn no_outcome_means_no_claim_rather_than_nothing_delivered() {
        assert_eq!(tag_value(&failure_tags(None), "outcome"), None);
    }

    #[test]
    fn an_unknown_outcome_lists_the_ones_that_exist() {
        let error = resolve_outcome(kind_for("error").unwrap(), Some("delivered")).unwrap_err();
        let message = error.to_string();
        assert!(message.contains("delivered"), "{message}");
        for outcome in OUTCOMES {
            assert!(message.contains(outcome), "missing {outcome} in: {message}");
        }
    }

    #[test]
    fn an_outcome_outside_a_failure_is_refused() {
        // A tag that contradicts the kind would mislead exactly the reader this
        // exists for, so the caller is told before anything is signed.
        let error = resolve_outcome(kind_for("result").unwrap(), Some("failed")).unwrap_err();
        assert!(error.to_string().contains("--state error"), "{error}");
    }

    #[test]
    fn the_outcome_check_follows_the_error_kind() {
        assert_eq!(kind_for("error").unwrap().as_u16(), FAILURE_KIND);
    }
}
