//! Skills library and the agent-profile read surfaces.
//!
//! Implements `docs/spec-agent-profile.md`: the on-disk contract for skills and
//! per-agent evals, the discovery rules each runtime actually follows, and the
//! write path (canonical copy → runtime symlinks → one git commit per skill).
//!
//! Every path this module touches goes through [`paths`], which allow-lists the
//! skill and eval directories. There is no command here that reads or writes an
//! arbitrary file.

pub mod contract;
pub mod discovery;
pub mod import;
pub mod names;
pub mod paths;
pub mod writer;

#[cfg(test)]
mod tests;
