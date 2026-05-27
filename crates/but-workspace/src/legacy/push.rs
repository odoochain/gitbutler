//! This module makes an attempt to build a push implementation that is as
//! non-legacy as possible without doing some larger re-plumbing around the
//! gitbutler-git crate.
//!
//! This module should avoid legacy data structures where possible.

use anyhow::{Context as _, Result};
use bstr::{BStr, BString, ByteVec};
use but_core::extract_remote_name_and_short_name;
use but_db::DbHandle;
use gitbutler_git::push_with_askpass;
use indexmap::IndexMap;

use crate::{RefInfo, ref_info::Segment, ui::PushStatus};

/// Push a given branch and it's ancestors
pub fn workspace_branch_and_ancestors_push(
    repo: &gix::Repository,
    ws: &but_graph::Workspace,
    ref_info: &RefInfo,
    db: &mut DbHandle,
    gerrit_mode: bool,
    with_force: bool,
    skip_force_push_protection: bool,
    force_push_protection: bool,
    branch: gix::refs::FullName,
    run_hooks: bool,
    push_opts: Vec<but_gerrit::PushFlag>,
) -> Result<()> {
    let graph = ws.graph;
    let mut to_push = IndexMap::new();

    let remote_names = repo.remote_names();
    let target_ref_name = ws
        .target_ref_name()
        .context("failed to get target reference name")?
        .to_owned();
    let push_remote = match ws
        .metadata
        .as_ref()
        .and_then(|metadata| metadata.push_remote.clone())
    {
        Some(push_remote) => push_remote,
        None => extract_remote_name_and_short_name(target_ref_name.as_ref(), &remote_names)
            .map(|(remote, _)| remote)
            .context("failed to get target push remote name")?,
    };

    for stack in &ref_info.stacks {
        let mut refname_found = false;
        for segment in &stack.segments {
            let Some(ref_name) = segment.ref_info.map(|r| r.ref_name.as_ref()) else {
                continue;
            };

            if ref_name == branch.as_ref() {
                refname_found = true;
            }

            if refname_found {
                to_push.insert(segment.id, segment);
            }
        }
    }

    for (sidx, segment) in to_push.iter().rev() {
        // this will always be set
        let Some(ref_name) = segment.ref_info.map(|r| r.ref_name.as_ref()) else {
            continue;
        };

        if matches!(
            segment.push_status,
            PushStatus::Integrated | PushStatus::NothingToPush
        ) {
            continue;
        }

        let Some(local_sha) = graph.tip_skip_empty(*sidx) else {
            continue;
        };

        let remote_refname = segment
            .remote_tracking_ref_name
            .unwrap_or_else(|| format_remote_refname(ref_name, &push_remote));

        if run_hooks {
            run_pre_push_hook(push_env, local_sha, &remote_refname)?;
        }

        let gerrit_push_args = gerrit_push_args(push_env, local_sha, push_flags);
        let push_output = push_with_askpass(
            repo,
            local_sha,
            &remote_refname,
            with_force,
            force_push_protection && !skip_force_push_protection,
            gerrit_push_args.refspec,
            // Historically we have tried to pass a stackId to the frontend when
            // doing askpass... but as far as I can tell, it's never used in a
            // meaningful way and doesn't seem to actually be required.
            Some(None),
            gerrit_push_args.push_opts,
        )?;

        maybe_record_gerrit_push_metadata(repo, db, gerrit_mode, segment, &push_output)?;
    }

    todo!()
}

struct GerritPushArgs {
    refspec: Option<String>,
    push_opts: Vec<String>,
}

fn gerrit_push_args(
    gerrit_mode: bool,
    head: gix::ObjectId,
    target_branch_name: &BStr,
    push_flags: &[but_gerrit::PushFlag],
) -> GerritPushArgs {
    if gerrit_mode {
        GerritPushArgs {
            refspec: Some(format!("{head}:refs/for/{}", target_branch_name)),
            push_opts: push_flags.iter().map(|flag| flag.to_string()).collect(),
        }
    } else {
        GerritPushArgs {
            refspec: None,
            push_opts: vec![],
        }
    }
}

fn maybe_record_gerrit_push_metadata(
    repo: &gix::Repository,
    db: &mut DbHandle,
    gerrit_mode: bool,
    segment: &Segment,
    push_output: &str,
) -> Result<()> {
    if !gerrit_mode {
        return Ok(());
    }

    let push_output = but_gerrit::parse::push_output(push_output)?;
    but_gerrit::record_push_metadata(
        repo,
        db,
        segment.commits.iter().map(|c| c.id).collect::<Vec<_>>(),
        push_output,
    )
}

fn format_remote_refname(
    reference: &gix::refs::FullNameRef,
    remote_name: &str,
) -> Result<gix::refs::FullName> {
    let mut out: BString = b"refs/remotes/".into();
    out.push_str(&format!("{remote_name}/"));
    out.push_str(&reference.shorten());

    Ok(out.try_into()?)
}
