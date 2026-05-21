import {
	clickByTestId,
	fillByTestId,
	getByTestId,
	textEditorFillByTestId,
	waitForElementToStabilize,
	waitForTestId,
} from "./util.ts";
import { expect, Locator, Page } from "@playwright/test";

/**
 * Open a commit drawer by clicking on the commit row.
 */
export async function openCommitDrawer(page: Page, commitTitle: string) {
	const commitRow = getByTestId(page, "commit-row").filter({ hasText: commitTitle });
	await expect(commitRow).toHaveCount(1);
	await expect(commitRow).toBeVisible();
	await commitRow.click();

	const commitDrawer = getByTestId(page, "commit-drawer");
	await expect(commitDrawer).toBeVisible();
	return commitDrawer;
}

/**
 * Verify the commit drawer shows the expected title and description.
 */
export async function verifyCommitDrawerContent(
	commitDrawer: Locator,
	expectedTitle: string,
	expectedDescription: string,
) {
	const commitDrawerTitle = commitDrawer.getByTestId("commit-drawer-title");
	await expect(commitDrawerTitle).toBeVisible();
	await expect(commitDrawerTitle).toContainText(expectedTitle);
	const commitDrawerDescription = commitDrawer.getByTestId("commit-drawer-description");
	await expect(commitDrawerDescription).toBeVisible();
	await expect(commitDrawerDescription).toContainText(expectedDescription);
}

/**
 * Open the kebab menu and start editing the commit message.
 */
export async function startEditingCommitMessage(page: Page, commitDrawer: Locator) {
	const commitKebabMenuButton = commitDrawer.getByTestId("kebab-menu-btn");
	await expect(commitKebabMenuButton).toBeVisible();
	await commitKebabMenuButton.click();
	// Wait for the context menu popup to finish positioning (Floating UI takes
	// a few frames to measure and place the popup). We wait until the menu item's
	// bounding box stops moving before clicking.
	const menuItem = await waitForTestId(page, "commit-row-context-menu-edit-message-menu-btn");
	await expect(menuItem).toBeVisible();
	await waitForElementToStabilize(page, menuItem);
	await menuItem.click();
}

/**
 * Verify the commit message editor contains the expected values.
 */
export async function verifyCommitMessageEditor(
	page: Page,
	expectedTitle: string,
	expectedMessage: string,
) {
	const commitTitleInput = getByTestId(page, "commit-drawer-title-input");
	await expect(commitTitleInput).toBeVisible();
	await expect(commitTitleInput).toHaveValue(expectedTitle);
	const commitBodyInput = getByTestId(page, "commit-drawer-description-input");
	await expect(commitBodyInput).toBeVisible();
	await expect(commitBodyInput).toContainText(expectedMessage);
}

/**
 * Update the commit title and description in the editor.
 */
export async function updateCommitMessage(page: Page, newTitle: string, newMessage: string) {
	await fillByTestId(page, "commit-drawer-title-input", newTitle);
	await textEditorFillByTestId(page, "commit-drawer-description-input", newMessage);
}

/**
 * Create a new workspace commit through the commit drawer UI and verify it appears in the stack.
 */
export async function createWorkspaceCommit(page: Page, title: string, description: string) {
	await clickByTestId(page, "start-commit-button");
	await waitForTestId(page, "new-commit-view");
	await fillByTestId(page, "commit-drawer-title-input", title);
	await textEditorFillByTestId(page, "commit-drawer-description-input", description);
	await clickByTestId(page, "commit-drawer-action-button");

	const createdCommit = getByTestId(page, "commit-row").filter({ hasText: title });
	await expect(createdCommit).toHaveCount(1);
	await expect(createdCommit).toBeVisible();
}

/**
 * Verify the 'Your commit goes here' placeholder is visible and in the correct position.
 */
export async function verifyCommitPlaceholderPosition(page: Page) {
	const commitTargetPosition = getByTestId(page, "your-commit-goes-here");
	await expect(commitTargetPosition).toBeVisible();
	await expect(commitTargetPosition).toHaveCount(1);
	await expect(commitTargetPosition).toContainClass("first");
}
