import { createNewBranch } from "../src/branch.ts";
import {
	addBranchIntegrationStep,
	applyBranchIntegration,
	deleteBranchIntegrationStep,
	getBranchIntegrationPreviewCommitTitles,
	getWorkspaceCommitTitles,
	previewBranchIntegration,
	setBranchIntegrationStepKind,
	setBranchIntegrationStepCommitByTitle,
} from "../src/branchIntegration.ts";
import { createWorkspaceCommit } from "../src/commit.ts";
import {
	addCommitToRemoteBranch,
	applyUpstream,
	type GitButler,
	openInteractiveIntegrationModal,
	openWorkspace,
} from "../src/setup.ts";
import { test } from "../src/test.ts";
import {
	clickByTestId,
	commitRow,
	getByTestId,
	stack,
	waitForTestId,
	waitForTestIdToNotExist,
} from "../src/util.ts";
import { expect, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";

async function syncAndIntegrate(page: Page) {
	await clickByTestId(page, "sync-button");
	await clickByTestId(page, "integrate-upstream-commits-button");
	await clickByTestId(page, "integrate-upstream-action-button");
}

test("should handle the update of workspace with one conflicting branch gracefully", async ({
	page,
	gitbutler,
}) => {
	await gitbutler.runScript("project-with-remote-branches.sh");
	await applyUpstream(gitbutler, "branch1");
	await openWorkspace(page);

	await gitbutler.runScript("project-with-remote-branches__add-commit-to-base.sh");
	await syncAndIntegrate(page);

	await expect(stack(page)).toHaveCount(1);
});

const LOCAL_COMMIT_MESSAGE = "branch1: local diverged commit";
const REMOTE_COMMIT_MESSAGE = "branch1: third commit";
const BRANCH_BASE_TITLES = ["branch1: second commit", "branch1: first commit"] as const;

async function setupDivergedBranchIntegrationScenario(page: Page, gitbutler: GitButler) {
	const filePath = gitbutler.pathInWorkdir("local-clone/c_file");

	await gitbutler.runScript("project-with-remote-branches.sh");
	await applyUpstream(gitbutler, "branch1");
	await openWorkspace(page);

	await expect(stack(page, "branch1")).toHaveCount(1);
	await expect(commitRow(page)).toHaveCount(2);

	writeFileSync(filePath, "local diverged change\n");
	await createWorkspaceCommit(page, LOCAL_COMMIT_MESSAGE, "Divergence for modal e2e");
	await expect(commitRow(page)).toHaveCount(3);

	await addCommitToRemoteBranch(gitbutler, "branch1");
	await openInteractiveIntegrationModal(page, "branch1");

	const currentLocalRows = page.locator(
		'[data-testid="branch-integration-current-state-row"][data-branch-integration-row-kind="local"]',
	);
	const currentRemoteRows = page.locator(
		'[data-testid="branch-integration-current-state-row"][data-branch-integration-row-kind="remote"]',
	);
	await expect(currentLocalRows).toHaveCount(1);
	await expect(currentRemoteRows).toHaveCount(1);
	await expect(getByTestId(page, "branch-integration-step")).toHaveCount(2);
}

async function expectPreviewTitles(page: Page, expectedTitles: string[]) {
	await previewBranchIntegration(page);
	await expect
		.poll(async () => await getBranchIntegrationPreviewCommitTitles(page))
		.toEqual([...expectedTitles, "(base commit)"]);
}

async function expectWorkspaceTitles(page: Page, expectedTitles: string[]) {
	await expect
		.poll(async () => await getWorkspaceCommitTitles(page, "branch1"))
		.toEqual(expectedTitles);
}

test("should preview and apply interactive integration for a diverged local branch", async ({
	page,
	gitbutler,
}) => {
	await setupDivergedBranchIntegrationScenario(page, gitbutler);
	await expectPreviewTitles(page, [
		LOCAL_COMMIT_MESSAGE,
		REMOTE_COMMIT_MESSAGE,
		...BRANCH_BASE_TITLES,
	]);
	await applyBranchIntegration(page);
	await waitForTestIdToNotExist(page, "upstream-commits-integrate-button");
	await expect(stack(page, "branch1")).toHaveCount(1);
	await expectWorkspaceTitles(page, [
		LOCAL_COMMIT_MESSAGE,
		REMOTE_COMMIT_MESSAGE,
		...BRANCH_BASE_TITLES,
	]);
});

test("should allow applying only the local commits from the integration modal", async ({
	page,
	gitbutler,
}) => {
	await setupDivergedBranchIntegrationScenario(page, gitbutler);
	await deleteBranchIntegrationStep(page, 0);

	await expectPreviewTitles(page, [LOCAL_COMMIT_MESSAGE, ...BRANCH_BASE_TITLES]);
	await applyBranchIntegration(page);

	await expect(stack(page, "branch1")).toHaveCount(1);
	await expectWorkspaceTitles(page, [
		REMOTE_COMMIT_MESSAGE,
		LOCAL_COMMIT_MESSAGE,
		...BRANCH_BASE_TITLES,
	]);
});

test("should allow applying only the remote commits from the integration modal", async ({
	page,
	gitbutler,
}) => {
	await setupDivergedBranchIntegrationScenario(page, gitbutler);
	await deleteBranchIntegrationStep(page, 1);

	await expectPreviewTitles(page, [REMOTE_COMMIT_MESSAGE, ...BRANCH_BASE_TITLES]);
	await applyBranchIntegration(page);
	await waitForTestIdToNotExist(page, "upstream-commits-integrate-button");

	await expect(stack(page, "branch1")).toHaveCount(1);
	await expectWorkspaceTitles(page, [REMOTE_COMMIT_MESSAGE, ...BRANCH_BASE_TITLES]);
});

test("should allow picking the local commit and then merging the remote tip", async ({
	page,
	gitbutler,
}) => {
	await setupDivergedBranchIntegrationScenario(page, gitbutler);
	await deleteBranchIntegrationStep(page, 0);
	await addBranchIntegrationStep(page);
	await setBranchIntegrationStepKind(page, 1, "merge");
	await setBranchIntegrationStepCommitByTitle(page, 1, REMOTE_COMMIT_MESSAGE);

	await previewBranchIntegration(page);
	const previewTitles = await getBranchIntegrationPreviewCommitTitles(page);
	expect(previewTitles).toHaveLength(5);
	expect(previewTitles[0]?.startsWith("Merge")).toBe(true);
	expect(previewTitles[1]).toBe(LOCAL_COMMIT_MESSAGE);
	expect(previewTitles[2]).toBe(BRANCH_BASE_TITLES[0]);
	expect(previewTitles[3]).toBe(BRANCH_BASE_TITLES[1]);
	expect(previewTitles[4]).toBe("(base commit)");

	await applyBranchIntegration(page);

	await expect(stack(page, "branch1")).toHaveCount(1);
	const workspaceTitles = await getWorkspaceCommitTitles(page, "branch1");
	expect(workspaceTitles).toHaveLength(4);
	expect(workspaceTitles[0]?.startsWith("Merge")).toBe(true);
	expect(workspaceTitles[1]).toBe(LOCAL_COMMIT_MESSAGE);
	expect(workspaceTitles[2]).toBe(BRANCH_BASE_TITLES[0]);
	expect(workspaceTitles[3]).toBe(BRANCH_BASE_TITLES[1]);
});

test("should handle the update of workspace with integrated branch gracefully", async ({
	page,
	gitbutler,
}) => {
	await gitbutler.runScript("project-with-remote-branches.sh");
	await applyUpstream(gitbutler, "branch1");
	await openWorkspace(page);

	await expect(stack(page)).toHaveCount(1);

	await gitbutler.runScript("merge-upstream-branch-to-base.sh", ["branch1"]);
	await syncAndIntegrate(page);

	await waitForTestIdToNotExist(page, "stack");
});

test("should handle the update of workspace with integrated parent branch in stack gracefully", async ({
	page,
	gitbutler,
}) => {
	await gitbutler.runScript("project-with-remote-branches.sh");
	await applyUpstream(gitbutler, "branch1", "branch3");
	await gitbutler.runScript("move-branch.sh", ["branch3", "branch1", "local-clone"]);
	await openWorkspace(page);

	await expect(stack(page)).toHaveCount(1);
	await expect(getByTestId(page, "branch-card")).toHaveCount(2);

	await gitbutler.runScript("merge-upstream-branch-to-base.sh", ["branch1"]);
	await clickByTestId(page, "sync-button");
	await clickByTestId(page, "integrate-upstream-commits-button");

	const branch1Row = page.locator('[data-integration-row-branch-name="branch1"]').first();
	const statusBadge = branch1Row.getByTestId("integrate-upstream-series-row-status-badge");
	await expect(statusBadge).toHaveText("Integrated");

	await clickByTestId(page, "integrate-upstream-action-button");

	await expect(stack(page)).toHaveCount(1);
	await expect(getByTestId(page, "branch-card")).toHaveCount(1);
});

test("should handle the update of the workspace with multiple stacks gracefully", async ({
	page,
	gitbutler,
}) => {
	await gitbutler.runScript("project-with-stacks.sh");
	await applyUpstream(gitbutler, "branch1", "branch2");
	await openWorkspace(page);

	await expect(stack(page)).toHaveCount(2);

	await gitbutler.runScript("merge-upstream-branch-to-base.sh", ["branch1"]);
	await syncAndIntegrate(page);

	await expect(stack(page)).toHaveCount(1);
});

test("should handle the update of an empty branch gracefully", async ({ page, gitbutler }) => {
	await gitbutler.runScript("project-with-stacks.sh");
	await openWorkspace(page);

	await expect(stack(page)).toHaveCount(0);
	await createNewBranch(page, "new-branch");
	await expect(stack(page)).toHaveCount(1);

	await gitbutler.runScript("merge-upstream-branch-to-base.sh", ["branch1"]);
	await syncAndIntegrate(page);

	await expect(stack(page)).toHaveCount(1);
});

test("should handle the update of a branch with an empty commit", async ({ page, gitbutler }) => {
	await gitbutler.runScript("project-with-stacks.sh");
	await openWorkspace(page);

	await expect(stack(page)).toHaveCount(0);

	// Create a new branch
	await clickByTestId(page, "chrome-header-create-branch-button");
	const modal = await waitForTestId(page, "create-new-branch-modal");
	await modal.locator("#new-branch-name-input").fill("new-branch");
	await clickByTestId(page, "confirm-submit");
	await expect(stack(page)).toHaveCount(1);

	// Add an empty commit via the branch context menu.
	const branchCard = getByTestId(page, "branch-card");
	await branchCard.click({ button: "right" });
	await waitForTestId(page, "branch-header-context-menu");
	await clickByTestId(page, "branch-header-context-menu-add-empty-commit");
	await expect(commitRow(page)).toHaveCount(1);

	await gitbutler.runScript("merge-upstream-branch-to-base.sh", ["branch1"]);
	await syncAndIntegrate(page);
	await waitForTestIdToNotExist(page, "integrate-upstream-action-button");

	await expect(stack(page)).toHaveCount(1);
	await expect(commitRow(page)).toHaveCount(1);
});
