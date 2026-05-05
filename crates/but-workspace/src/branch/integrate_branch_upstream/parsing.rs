//! Parsing helpers for editable branch-upstream integration scripts.

use anyhow::{Context as _, Result, bail};

use super::{InteractiveIntegration, InteractiveIntegrationStep};

impl InteractiveIntegration {
    /// Parse a textual integration script into an [`InteractiveIntegration`].
    ///
    /// Blank lines and comment lines starting with `#` are ignored.
    pub fn parse(input: &str) -> Result<Self> {
        let mut merge_base = None;
        let mut steps = Vec::new();

        for (line_idx, raw_line) in input.lines().enumerate() {
            let line_no = line_idx + 1;
            let line = raw_line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }

            if merge_base.is_none() {
                let Some(rest) = line.strip_prefix("merge-base ") else {
                    bail!(
                        "Line {line_no}: expected first non-comment line to be 'merge-base <sha>'"
                    );
                };
                merge_base = Some(parse_object_id(rest.trim(), line_no)?);
                continue;
            }

            steps.push(parse_integration_step(line, line_no)?);
        }

        let Some(merge_base) = merge_base else {
            bail!("Missing required 'merge-base <sha>' line");
        };
        if steps.is_empty() {
            bail!("Integration steps cannot be empty");
        }

        Ok(Self { merge_base, steps })
    }
}

fn parse_integration_step(line: &str, line_no: usize) -> Result<InteractiveIntegrationStep> {
    let mut parts = line.splitn(2, ' ');
    let command = parts
        .next()
        .expect("splitn always yields at least one part for non-empty input");
    let rest = parts
        .next()
        .ok_or_else(|| anyhow::anyhow!("Line {line_no}: missing arguments for '{command}'"))?
        .trim();

    match command {
        "pick" => Ok(InteractiveIntegrationStep::Pick {
            commit_id: parse_object_id(rest, line_no)?,
        }),
        "merge" => Ok(InteractiveIntegrationStep::Merge {
            commit_id: parse_object_id(rest, line_no)?,
        }),
        "squash" => parse_squash_step(rest, line_no),
        _ => bail!("Line {line_no}: unsupported integration command '{command}'"),
    }
}

fn parse_squash_step(rest: &str, line_no: usize) -> Result<InteractiveIntegrationStep> {
    let (commit_part, message) = if let Some((commits, suffix)) = rest.split_once('|') {
        let suffix = suffix.trim();
        let Some(message) = suffix.strip_prefix("message=") else {
            bail!("Line {line_no}: expected squash metadata suffix 'message=\"...\"'");
        };
        let message = parse_quoted_string(message, line_no)?;
        (commits.trim(), Some(message))
    } else {
        (rest, None)
    };

    let commits = commit_part
        .split_whitespace()
        .map(|token| parse_object_id(token, line_no))
        .collect::<Result<Vec<_>>>()?;
    if commits.len() < 2 {
        bail!("Line {line_no}: squash step must list at least two commits");
    }

    Ok(InteractiveIntegrationStep::Squash { commits, message })
}

fn parse_object_id(input: &str, line_no: usize) -> Result<gix::ObjectId> {
    gix::ObjectId::from_hex(input.as_bytes())
        .with_context(|| format!("Line {line_no}: '{input}' is not a valid full object ID"))
}

fn parse_quoted_string(input: &str, line_no: usize) -> Result<String> {
    let Some(content) = input
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
    else {
        bail!("Line {line_no}: invalid squash message string");
    };

    let mut out = String::new();
    let mut chars = content.chars();
    while let Some(ch) = chars.next() {
        if ch != '\\' {
            out.push(ch);
            continue;
        }

        let Some(escaped) = chars.next() else {
            bail!("Line {line_no}: invalid squash message string");
        };
        match escaped {
            '\\' => out.push('\\'),
            '"' => out.push('"'),
            'n' => out.push('\n'),
            'r' => out.push('\r'),
            't' => out.push('\t'),
            _ => bail!("Line {line_no}: invalid squash message string"),
        }
    }
    Ok(out)
}
