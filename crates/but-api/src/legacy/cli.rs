//! In place of commands.rs

use anyhow::Result;
use but_action::cli::{InstallMode, do_install_cli, get_cli_install_target_path, get_cli_path};
use but_api_macros::but_api;
use tracing::instrument;

#[but_api]
#[instrument(err(Debug))]
pub fn install_cli() -> Result<()> {
    do_install_cli(InstallMode::AllowPrivilegeElevation)
}

#[but_api]
#[instrument(err(Debug))]
pub fn cli_path() -> Result<String> {
    let cli_path = get_cli_path()?;
    Ok(cli_path.to_string_lossy().to_string())
}

/// Returns the recommended absolute destination path for installing the `but` CLI,
/// resolved at runtime so shell-side environment-variable expansion is not required.
///
/// - **Windows**: `$env:LOCALAPPDATA\Microsoft\WindowsApps\but.exe` (resolved)
/// - **Unix**: `/usr/local/bin/but`
#[but_api]
#[instrument(err(Debug))]
pub fn cli_install_target_path() -> Result<String> {
    let path = get_cli_install_target_path()?;
    Ok(path.to_string_lossy().to_string())
}
