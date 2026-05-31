import type { Commit } from "@gitbutler/but-sdk";

export const shortCommitId = (commitId: string): string => commitId.slice(0, 7);

export const commitTitle = (message: string): string => {
	const _title = message.trim().split("\n")[0];
	const title = _title === "" ? undefined : _title;
	return title ?? "(no message)";
};

export const commitBody = (message: string): string | undefined => {
	const _body = message.slice(message.indexOf("\n") + 1).trim();
	const body = _body === "" ? undefined : _body;
	return body;
};

export const commitIsDiverged = (commit: Commit): boolean =>
	commit.state.type === "LocalAndRemote" && commit.state.subject !== commit.id;
